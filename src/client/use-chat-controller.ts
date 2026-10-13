import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  appendUserTurn,
  applyStreamEvent,
  createConversation,
  markConversationAborted,
  prepareRetry,
  toChatRequest,
  type Conversation,
  type ConversationError,
} from '@client/chat-domain';
import {
  createConversationRepository,
  type ConversationRepository,
} from '@client/conversation-storage';
import {
  ChatTransportError,
  streamChat,
} from '@client/chat-transport';
import type { ChatStreamEvent } from '@shared/chat-contracts';

export type RequestState = 'idle' | 'streaming';

export interface ChatController {
  conversations: Conversation[];
  activeConversation: Conversation;
  draft: string;
  requestState: RequestState;
  error: ConversationError | null;
  setDraft(value: string): void;
  submit(): Promise<void>;
  stop(): void;
  retry(): Promise<void>;
  newConversation(): void;
  selectConversation(id: string): void;
  deleteConversation(id: string): void;
}

interface UseChatControllerOptions {
  repository?: ConversationRepository;
  transport?: typeof streamChat;
  idFactory?: () => string;
  now?: () => number;
}

const defaultIdFactory = () => crypto.randomUUID();

const fallbackError: ConversationError = {
  code: 'request_failed',
  message: 'The request could not be completed.',
  retryable: true,
};

export const useChatController = (
  options: UseChatControllerOptions = {},
): ChatController => {
  const repository = useMemo(
    () => options.repository ?? createConversationRepository(),
    [options.repository],
  );
  const transport = options.transport ?? streamChat;
  const idFactory = options.idFactory ?? defaultIdFactory;
  const now = options.now ?? Date.now;

  const [initialState] = useState(() => {
    const stored = repository.list();
    const initial = stored[0] ?? createConversation(idFactory(), now());
    return {
      conversations: stored.length ? stored : [initial],
      activeId: initial.id,
    };
  });

  const [conversations, setConversations] = useState(
    initialState.conversations,
  );
  const [activeId, setActiveId] = useState(initialState.activeId);
  const [draft, setDraft] = useState('');
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [error, setError] = useState<ConversationError | null>(null);
  const conversationsRef = useRef(conversations);
  const activeIdRef = useRef(activeId);
  const activeRequestRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const pendingDeltaRef = useRef('');
  const frameRef = useRef<number | null>(null);

  const replaceConversation = useCallback(
    (conversation: Conversation, persist = true) => {
      const next = conversationsRef.current.some(({ id }) => id === conversation.id)
        ? conversationsRef.current.map((candidate) =>
            candidate.id === conversation.id ? conversation : candidate,
          )
        : [conversation, ...conversationsRef.current];
      conversationsRef.current = next;
      if (mountedRef.current) {
        setConversations(next);
      }
      if (persist && conversation.messages.length > 0) {
        repository.save(conversation);
      }
    },
    [repository],
  );

  const cancelFrame = useCallback(() => {
    if (frameRef.current === null) {
      return;
    }
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameRef.current);
    } else {
      clearTimeout(frameRef.current);
    }
    frameRef.current = null;
  }, []);

  const runRequest = useCallback(
    async (startingConversation: Conversation) => {
      if (activeRequestRef.current) {
        return;
      }

      activeRequestRef.current = true;
      setRequestState('streaming');
      const controller = new AbortController();
      abortControllerRef.current = controller;
      let current = startingConversation;

      const apply = (event: ChatStreamEvent) => {
        current = applyStreamEvent(current, event, now());
        replaceConversation(current);
      };
      const flushDelta = () => {
        cancelFrame();
        if (!pendingDeltaRef.current) {
          return;
        }
        const text = pendingDeltaRef.current;
        pendingDeltaRef.current = '';
        apply({ type: 'delta', text });
      };
      const scheduleDelta = () => {
        if (frameRef.current !== null) {
          return;
        }
        const callback = () => {
          frameRef.current = null;
          flushDelta();
        };
        frameRef.current = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(callback)
          : window.setTimeout(callback, 16);
      };

      try {
        await transport({
          request: toChatRequest(startingConversation),
          signal: controller.signal,
          onEvent(event) {
            if (event.type === 'delta') {
              pendingDeltaRef.current += event.text;
              scheduleDelta();
              return;
            }
            flushDelta();
            apply(event);
            if (event.type === 'error') {
              setError({
                code: event.code,
                message: event.message,
                retryable: event.retryable,
              });
            }
          },
        });
      } catch (caught) {
        flushDelta();
        if (!controller.signal.aborted) {
          const nextError = caught instanceof ChatTransportError
            ? {
                code: caught.code,
                message: caught.message,
                retryable: caught.retryable,
              }
            : fallbackError;
          setError(nextError);
          const last = current.messages.at(-1);
          if (last?.role === 'assistant' && last.status === 'streaming') {
            apply({ type: 'error', ...nextError });
          }
        }
      } finally {
        cancelFrame();
        pendingDeltaRef.current = '';
        activeRequestRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (mountedRef.current) {
          setRequestState('idle');
        }
      }
    },
    [cancelFrame, now, replaceConversation, transport],
  );

  const activeConversation =
    conversations.find(({ id }) => id === activeId) ?? conversations[0];

  const submit = useCallback(async () => {
    const conversation = conversationsRef.current.find(
      ({ id }) => id === activeIdRef.current,
    );
    const content = draft.trim();
    const last = conversation?.messages.at(-1);
    if (
      !conversation ||
      !content ||
      activeRequestRef.current ||
      error ||
      (last?.role === 'assistant' &&
        (last.status === 'error' || last.status === 'aborted'))
    ) {
      return;
    }

    const updated = appendUserTurn(conversation, content, idFactory(), now());
    setDraft('');
    setError(null);
    replaceConversation(updated);
    await runRequest(updated);
  }, [draft, error, idFactory, now, replaceConversation, runRequest]);

  const stop = useCallback(() => {
    if (!activeRequestRef.current) {
      return;
    }
    abortControllerRef.current?.abort();
    const conversation = conversationsRef.current.find(
      ({ id }) => id === activeIdRef.current,
    );
    if (conversation) {
      const stopped = markConversationAborted(conversation, now());
      replaceConversation(stopped);
      setError({
        code: 'aborted',
        message: 'Response stopped. Retry to continue this turn.',
        retryable: true,
      });
    }
  }, [now, replaceConversation]);

  const retry = useCallback(async () => {
    const conversation = conversationsRef.current.find(
      ({ id }) => id === activeIdRef.current,
    );
    if (!conversation || activeRequestRef.current) {
      return;
    }
    const prepared = prepareRetry(conversation);
    if (prepared.messages.at(-1)?.role !== 'user') {
      return;
    }
    setError(null);
    replaceConversation(prepared);
    await runRequest(prepared);
  }, [replaceConversation, runRequest]);

  const newConversation = useCallback(() => {
    abortControllerRef.current?.abort();
    const conversation = createConversation(idFactory(), now());
    const next = [conversation, ...conversationsRef.current];
    conversationsRef.current = next;
    activeIdRef.current = conversation.id;
    setConversations(next);
    setActiveId(conversation.id);
    setDraft('');
    setError(null);
  }, [idFactory, now]);

  const selectConversation = useCallback((id: string) => {
    if (!conversationsRef.current.some((conversation) => conversation.id === id)) {
      return;
    }
    abortControllerRef.current?.abort();
    activeIdRef.current = id;
    setActiveId(id);
    setDraft('');
    setError(null);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    repository.remove(id);
    let next = conversationsRef.current.filter(
      (conversation) => conversation.id !== id,
    );
    if (next.length === 0) {
      next = [createConversation(idFactory(), now())];
    }
    conversationsRef.current = next;
    setConversations(next);
    if (activeIdRef.current === id) {
      activeIdRef.current = next[0].id;
      setActiveId(next[0].id);
      setDraft('');
      setError(null);
    }
  }, [idFactory, now, repository]);

  useEffect(() => () => {
    mountedRef.current = false;
    abortControllerRef.current?.abort();
    cancelFrame();
  }, [cancelFrame]);

  return {
    conversations,
    activeConversation,
    draft,
    requestState,
    error,
    setDraft,
    submit,
    stop,
    retry,
    newConversation,
    selectConversation,
    deleteConversation,
  };
};
