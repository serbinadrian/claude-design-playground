import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Conversation } from '@client/chat-domain';
import type { ConversationRepository } from '@client/conversation-storage';
import type { streamChat } from '@client/chat-transport';
import { ChatTransportError } from '@client/chat-transport';
import { useChatController } from '@client/use-chat-controller';

type Transport = typeof streamChat;
type TransportOptions = Parameters<Transport>[0];

const storedConversation: Conversation = {
  id: 'stored',
  title: 'Stored thread',
  messages: [{
    id: 'stored-user',
    role: 'user',
    content: 'Earlier question',
    status: 'complete',
    createdAt: 1,
  }, {
    id: 'stored-assistant',
    role: 'assistant',
    content: 'Earlier answer',
    status: 'complete',
    createdAt: 2,
  }],
  createdAt: 1,
  updatedAt: 2,
};

const repository = (initial: Conversation[] = []) => {
  let values = [...initial];
  const repo: ConversationRepository = {
    list: vi.fn(() => [...values]),
    save: vi.fn((conversation) => {
      values = [conversation, ...values.filter(({ id }) => id !== conversation.id)];
    }),
    remove: vi.fn((id) => {
      values = values.filter((conversation) => conversation.id !== id);
    }),
  };
  return repo;
};

const ids = (...values: string[]) => {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
};

const clock = () => {
  let value = 10;
  return () => value++;
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

describe('useChatController', () => {
  it('initializes from history and supports selection, creation, and deletion', () => {
    const repo = repository([storedConversation]);
    const { result } = renderHook(() =>
      useChatController({
        repository: repo,
        transport: vi.fn<Transport>(),
        idFactory: ids('new-thread', 'replacement'),
        now: clock(),
      }),
    );

    expect(result.current.activeConversation).toEqual(storedConversation);

    act(() => result.current.newConversation());
    expect(result.current.activeConversation).toMatchObject({
      id: 'new-thread',
      messages: [],
    });

    act(() => result.current.selectConversation('stored'));
    expect(result.current.activeConversation.id).toBe('stored');

    act(() => result.current.deleteConversation('stored'));
    expect(repo.remove).toHaveBeenCalledWith('stored');
    expect(result.current.activeConversation.id).toBe('new-thread');
  });

  it('streams one request at a time, persists updates, and submits multi-turn history', async () => {
    const repo = repository();
    const first = deferred();
    let firstOptions: TransportOptions | undefined;
    const transport = vi.fn<Transport>((options) => {
      firstOptions = options;
      return first.promise;
    });
    const { result } = renderHook(() =>
      useChatController({
        repository: repo,
        transport,
        idFactory: ids('thread', 'user-1', 'user-2'),
        now: clock(),
      }),
    );

    act(() => result.current.setDraft('First question'));
    act(() => {
      void result.current.submit();
      void result.current.submit();
    });

    expect(transport).toHaveBeenCalledOnce();
    expect(result.current.requestState).toBe('streaming');
    expect(result.current.activeConversation.messages).toHaveLength(1);

    act(() => {
      firstOptions?.onEvent({
        type: 'start', requestId: 'request-1', model: 'asi1-mini', httpStatus: 200,
      });
      firstOptions?.onEvent({ type: 'delta', text: 'First answer' });
      firstOptions?.onEvent({ type: 'complete', finishReason: 'stop' });
      first.resolve();
    });

    await waitFor(() => expect(result.current.requestState).toBe('idle'));
    expect(result.current.activeConversation.messages).toMatchObject([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer', status: 'complete' },
    ]);
    expect(repo.save).toHaveBeenCalled();

    transport.mockImplementationOnce(async (options) => {
      expect(options.request.messages).toEqual([
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Follow up' },
      ]);
      options.onEvent({
        type: 'start', requestId: 'request-2', model: 'asi1-mini', httpStatus: 200,
      });
      options.onEvent({ type: 'complete', finishReason: 'stop' });
    });
    act(() => result.current.setDraft('Follow up'));
    await act(async () => result.current.submit());
    expect(result.current.activeConversation.messages).toHaveLength(4);
  });

  it('stops an active request, blocks follow-ups, and retries without duplicating the user turn', async () => {
    let firstOptions: TransportOptions | undefined;
    const transport = vi.fn<Transport>((options) => {
      firstOptions = options;
      return new Promise<void>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const { result } = renderHook(() =>
      useChatController({
        repository: repository(),
        transport,
        idFactory: ids('thread', 'user'),
        now: clock(),
      }),
    );

    act(() => result.current.setDraft('Question'));
    act(() => void result.current.submit());
    act(() => firstOptions?.onEvent({
      type: 'start', requestId: 'request', model: 'asi1-mini', httpStatus: 200,
    }));
    act(() => firstOptions?.onEvent({ type: 'delta', text: 'Partial answer' }));
    act(() => result.current.stop());

    await waitFor(() => expect(result.current.requestState).toBe('idle'));
    expect(result.current.activeConversation.messages.at(-1)?.status).toBe('aborted');
    expect(result.current.activeConversation.messages.at(-1)?.content).toBe('Partial answer');

    act(() => result.current.setDraft('Not allowed yet'));
    await act(async () => result.current.submit());
    expect(transport).toHaveBeenCalledOnce();

    transport.mockImplementationOnce(async (options) => {
      expect(options.request.messages).toEqual([{ role: 'user', content: 'Question' }]);
      options.onEvent({
        type: 'start', requestId: 'retry', model: 'asi1-mini', httpStatus: 200,
      });
      options.onEvent({ type: 'complete', finishReason: 'stop' });
    });
    await act(async () => result.current.retry());

    expect(result.current.activeConversation.messages).toHaveLength(2);
    expect(result.current.activeConversation.messages[0].content).toBe('Question');
    expect(result.current.error).toBeNull();
  });

  it('shows pre-stream validation errors without truncating history and retries the same turn', async () => {
    const longThread = { ...storedConversation, messages: [...storedConversation.messages] };
    const transport = vi
      .fn<Transport>()
      .mockRejectedValueOnce(
        new ChatTransportError('too_many_messages', 'Keep the full visible history.', false),
      )
      .mockImplementationOnce(async (options) => {
        options.onEvent({
          type: 'start', requestId: 'retry', model: 'asi1-mini', httpStatus: 200,
        });
        options.onEvent({ type: 'complete', finishReason: 'stop' });
      });
    const { result } = renderHook(() =>
      useChatController({
        repository: repository([longThread]),
        transport,
        idFactory: ids('new-user'),
        now: clock(),
      }),
    );

    act(() => result.current.setDraft('Latest question'));
    await act(async () => result.current.submit());

    expect(result.current.error).toMatchObject({
      code: 'too_many_messages',
      message: 'Keep the full visible history.',
    });
    expect(result.current.activeConversation.messages).toHaveLength(4);

    await act(async () => result.current.retry());
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.current.activeConversation.messages).toHaveLength(4);
  });

  it('aborts active work on unmount', () => {
    let signal: AbortSignal | undefined;
    const transport = vi.fn<Transport>((options) => {
      signal = options.signal;
      return new Promise(() => undefined);
    });
    const { result, unmount } = renderHook(() =>
      useChatController({
        repository: repository(),
        transport,
        idFactory: ids('thread', 'user'),
        now: clock(),
      }),
    );

    act(() => result.current.setDraft('Question'));
    act(() => void result.current.submit());
    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('survives the StrictMode setup and cleanup replay', async () => {
    const transport = vi.fn<Transport>(async (options) => {
      options.onEvent({
        type: 'start', requestId: 'request', model: 'asi1-mini', httpStatus: 200,
      });
      options.onEvent({ type: 'delta', text: 'Answer' });
      options.onEvent({ type: 'complete', finishReason: 'stop' });
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <StrictMode>{children}</StrictMode>
    );
    const { result } = renderHook(() =>
      useChatController({
        repository: repository(),
        transport,
        idFactory: ids('thread', 'user'),
        now: clock(),
      }),
    { wrapper });

    act(() => result.current.setDraft('Question'));
    await act(async () => result.current.submit());

    expect(result.current.requestState).toBe('idle');
    expect(result.current.activeConversation.messages).toMatchObject([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer', status: 'complete' },
    ]);
  });

  it('does not resurrect a deleted active conversation from late stream events', async () => {
    let options: TransportOptions | undefined;
    const pending = deferred();
    const transport = vi.fn<Transport>((value) => {
      options = value;
      return pending.promise;
    });
    const { result } = renderHook(() =>
      useChatController({
        repository: repository(),
        transport,
        idFactory: ids('thread', 'user', 'replacement'),
        now: clock(),
      }),
    );

    act(() => result.current.setDraft('Question'));
    act(() => void result.current.submit());
    act(() => options?.onEvent({
      type: 'start', requestId: 'request', model: 'asi1-mini', httpStatus: 200,
    }));
    act(() => result.current.deleteConversation('thread'));
    act(() => {
      options?.onEvent({ type: 'delta', text: 'Late answer' });
      options?.onEvent({ type: 'complete', finishReason: 'stop' });
      pending.resolve();
    });

    await waitFor(() => expect(result.current.requestState).toBe('idle'));
    expect(result.current.conversations.map(({ id }) => id)).toEqual(['replacement']);
  });

  it('marks an in-flight thread aborted before opening a new conversation', async () => {
    let options: TransportOptions | undefined;
    const transport = vi.fn<Transport>((value) => {
      options = value;
      return new Promise(() => undefined);
    });
    const { result } = renderHook(() =>
      useChatController({
        repository: repository(),
        transport,
        idFactory: ids('thread', 'user', 'next'),
        now: clock(),
      }),
    );

    act(() => result.current.setDraft('Question'));
    act(() => void result.current.submit());
    act(() => options?.onEvent({
      type: 'start', requestId: 'request', model: 'asi1-mini', httpStatus: 200,
    }));
    act(() => result.current.newConversation());

    expect(result.current.activeConversation.id).toBe('next');
    expect(
      result.current.conversations.find(({ id }) => id === 'thread')?.messages.at(-1)?.status,
    ).toBe('aborted');
  });
});
