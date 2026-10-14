import { describe, expect, it } from 'vitest';

import { validateChatRequest } from '@shared/chat-contracts';

const expectErrorCode = (input: unknown, code: string) => {
  const result = validateChatRequest(input);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
    expect(result.error.message.length).toBeGreaterThan(0);
  }
};

describe('validateChatRequest', () => {
  it('accepts a valid multi-turn conversation without changing it', () => {
    const input = {
      messages: [
        { role: 'user', content: 'What is fish?' },
        { role: 'assistant', content: 'An aquatic vertebrate.' },
        { role: 'user', content: 'How do they breathe?' },
      ],
    };

    expect(validateChatRequest(input)).toEqual({ ok: true, value: input });
  });

  it('rejects a non-object request body', () => {
    expectErrorCode(null, 'invalid_body');
  });

  it('rejects an empty messages array', () => {
    expectErrorCode({ messages: [] }, 'messages_required');
  });

  it('rejects more than 40 messages', () => {
    const messages = Array.from({ length: 41 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index}`,
    }));

    expectErrorCode({ messages }, 'too_many_messages');
  });

  it('rejects an unsupported message role', () => {
    expectErrorCode(
      { messages: [{ role: 'system', content: 'Be concise.' }] },
      'invalid_role',
    );
  });

  it('rejects non-alternating roles', () => {
    expectErrorCode(
      {
        messages: [
          { role: 'user', content: 'First' },
          { role: 'user', content: 'Second' },
        ],
      },
      'invalid_sequence',
    );
  });

  it('rejects a conversation ending with an assistant message', () => {
    expectErrorCode(
      {
        messages: [
          { role: 'user', content: 'Question' },
          { role: 'assistant', content: 'Answer' },
        ],
      },
      'invalid_sequence',
    );
  });

  it('rejects empty message content', () => {
    expectErrorCode(
      { messages: [{ role: 'user', content: '   ' }] },
      'content_required',
    );
  });

  it('rejects message content over 8,000 characters', () => {
    expectErrorCode(
      { messages: [{ role: 'user', content: 'x'.repeat(8_001) }] },
      'message_too_long',
    );
  });

  it('rejects total conversation content over 32,000 characters', () => {
    const messages = Array.from({ length: 5 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: 'x'.repeat(6_500),
    }));

    expectErrorCode({ messages }, 'conversation_too_long');
  });
});
