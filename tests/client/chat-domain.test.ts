import { describe, expect, it } from 'vitest';

import {
  appendUserTurn,
  applyStreamEvent,
  type Conversation,
  type ConversationMessage,
  createConversation,
  markConversationAborted,
  prepareRetry,
  toChatRequest,
} from '@client/chat-domain';

describe('conversation domain', () => {
  it('derives the title from the first user turn without mutating the input', () => {
    const empty = createConversation('conversation-1', 100);

    const updated = appendUserTurn(
      empty,
      '  What   is fish and where does it live?  ',
      'message-1',
      200,
    );

    expect(empty.messages).toEqual([]);
    expect(updated).toMatchObject({
      id: 'conversation-1',
      title: 'What is fish and where does it live?',
      createdAt: 100,
      updatedAt: 200,
      messages: [
        {
          id: 'message-1',
          role: 'user',
          content: 'What   is fish and where does it live?',
          status: 'complete',
          createdAt: 200,
        },
      ],
    });
  });

  it('appends multiple turns to the same conversation', () => {
    let conversation = appendUserTurn(
      createConversation('conversation-1', 0),
      'First question',
      'user-1',
      1,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'start', requestId: 'assistant-1', model: 'asi1-mini', httpStatus: 200 },
      2,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'complete', finishReason: 'stop' },
      3,
    );

    const updated = appendUserTurn(
      conversation,
      'Follow-up question',
      'user-2',
      4,
    );

    expect(updated.messages.map(({ role }) => role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(updated.messages.at(-1)?.content).toBe('Follow-up question');
  });

  it('accumulates deltas and completion telemetry on the pending assistant turn', () => {
    let conversation = appendUserTurn(
      createConversation('conversation-1', 0),
      'Question',
      'user-1',
      10,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'start', requestId: 'request-1', model: 'asi1-mini', httpStatus: 200 },
      20,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'delta', text: 'A fish' },
      21,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'delta', text: ' lives in water.' },
      22,
    );
    conversation = applyStreamEvent(
      conversation,
      {
        type: 'complete',
        finishReason: 'stop',
        usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      },
      70,
    );

    expect(conversation.messages.at(-1)).toEqual({
      id: 'request-1',
      role: 'assistant',
      content: 'A fish lives in water.',
      status: 'complete',
      createdAt: 20,
      metadata: {
        requestId: 'request-1',
        model: 'asi1-mini',
        httpStatus: 200,
        startedAt: 20,
        completedAt: 70,
        elapsedMs: 50,
        finishReason: 'stop',
        usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      },
    });
  });

  it('records a safe stream error on the assistant turn', () => {
    let conversation = appendUserTurn(
      createConversation('conversation-1', 0),
      'Question',
      'user-1',
      1,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'start', requestId: 'request-1', model: 'asi1-mini', httpStatus: 200 },
      2,
    );

    conversation = applyStreamEvent(
      conversation,
      {
        type: 'error',
        code: 'timeout',
        message: 'The model request timed out.',
        retryable: true,
      },
      62,
    );

    expect(conversation.messages.at(-1)).toMatchObject({
      status: 'error',
      metadata: {
        error: {
          code: 'timeout',
          message: 'The model request timed out.',
          retryable: true,
        },
        elapsedMs: 60,
      },
    });
  });

  it('marks a partial assistant response as aborted', () => {
    let conversation = appendUserTurn(
      createConversation('conversation-1', 0),
      'Question',
      'user-1',
      1,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'start', requestId: 'request-1', model: 'asi1-mini', httpStatus: 200 },
      2,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'delta', text: 'Partial answer' },
      3,
    );

    const aborted = markConversationAborted(conversation, 12);

    expect(aborted.messages.at(-1)).toMatchObject({
      content: 'Partial answer',
      status: 'aborted',
      metadata: { completedAt: 12, elapsedMs: 10 },
    });
  });

  it('prepares retry by removing only the latest failed partial assistant turn', () => {
    let conversation = appendUserTurn(
      createConversation('conversation-1', 0),
      'Question',
      'user-1',
      1,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'start', requestId: 'request-1', model: 'asi1-mini', httpStatus: 200 },
      2,
    );
    conversation = applyStreamEvent(
      conversation,
      { type: 'delta', text: 'Partial answer' },
      3,
    );
    conversation = applyStreamEvent(
      conversation,
      {
        type: 'error',
        code: 'upstream_stream',
        message: 'Interrupted.',
        retryable: true,
      },
      4,
    );

    const retried = prepareRetry(conversation);

    expect(retried.messages).toHaveLength(1);
    expect(retried.messages[0]).toMatchObject({ role: 'user', content: 'Question' });
  });

  it('excludes incomplete assistant placeholders from API context', () => {
    const conversation: Conversation = {
      id: 'conversation-1',
      title: 'Question',
      createdAt: 0,
      updatedAt: 3,
      messages: [
        message('user-1', 'user', 'Question', 'complete', 1),
        message('assistant-1', 'assistant', '', 'streaming', 2),
      ],
    };

    expect(toChatRequest(conversation)).toEqual({
      messages: [{ role: 'user', content: 'Question' }],
    });
  });

  it('does not silently truncate a thread that exceeds server limits', () => {
    const messages = Array.from({ length: 41 }, (_, index) =>
      message(
        `message-${index}`,
        index % 2 === 0 ? 'user' : 'assistant',
        `message ${index}`,
        'complete',
        index,
      ),
    );
    const conversation: Conversation = {
      id: 'conversation-1',
      title: 'Long thread',
      createdAt: 0,
      updatedAt: 40,
      messages,
    };

    expect(toChatRequest(conversation).messages).toHaveLength(41);
  });
});

const message = (
  id: string,
  role: ConversationMessage['role'],
  content: string,
  status: ConversationMessage['status'],
  createdAt: number,
): ConversationMessage => ({ id, role, content, status, createdAt });
