import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  appendAssistantFailure,
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

interface RequestSession {
  controller: AbortController;
  conversation: Conversation;
  pendingDelta: string;
  frame: number | null;
  cancelled: boolean;
  removed: boolean;
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
  const [transport] = useState(() => options.transport ?? streamChat);
  const [idFactory] = useState(() => options.idFactory ?? defaultIdFactory);
  const [now] = useState(() => options.now ?? Date.now);
  const [initialState] = useState(() => {
    const stored = repository.list();
    const initial = stored[0] ?? createConversation(idFactory(), now());
    return {
      conversations: stored.length ? stored : [initial],
      activeId: initial.id,
    };
  });

  const [conversations, setConversations] = useState(initialState.conversations);
  const [activeId, setActiveId] = useState(initialState.activeId);
  const [draft, setDraft] = useState('');
  const [requestState, setRequestState] = useState<RequestState>('idle');
  const [error, setError] = useState<ConversationError | null>(null);
  const conversationsRef = useRef(conversations);
  const activeIdRef = useRef(activeId);
  const sessionRef = useRef<RequestSession | null>(null);
  const mountedRef = useRef(true);

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

  const cancelFrame = useCallback((session: RequestSession) => {
    if (session.frame === null) {
      return;
    }
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(session.frame);
    } else {
      clearTimeout(session.frame);
    }
    session.frame = null;
  }, []);

  const applyToSession = useCallback((session: RequestSession, event: ChatStreamEvent) => {
    session.conversation = applyStreamEvent(session.conversation, event, now());
    if (!session.removed) {
      replaceConversation(session.conversation);
    }
  }, [now, replaceConversation]);

  const flushDelta = useCallback((session: RequestSession) => {
    cancelFrame(session);
    if (!session.pendingDelta || session.removed) {
      session.pendingDelta = '';
      return;
    }
    const text = session.pendingDelta;
    session.pendingDelta = '';
    applyToSession(session, { type: 'delta', text });
  }, [applyToSession, cancelFrame]);

  const cancelActive = useCallback((remove: boolean, showStoppedError: boolean) => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    session.cancelled = true;
    session.removed = remove;
    if (remove) {
      cancelFrame(session);
      session.pendingDelta = '';
    } else {
      flushDelta(session);
      session.conversation = markConversationAborted(session.conversation, now());
      replaceConversation(session.conversation);
    }
    session.controller.abort();
    if (sessionRef.current === session) {
      sessionRef.current = null;
      setRequestState('idle');
    }
    if (showStoppedError) {
      setError({
        code: 'aborted',
        message: 'Response stopped. Retry to continue this turn.',
        retryable: true,
      });
    }
  }, [cancelFrame, flushDelta, now, replaceConversation]);

  const runRequest = useCallback(async (startingConversation: Conversation) => {
    if (sessionRef.current) {
      return;
    }
    const session: RequestSession = {
      controller: new AbortController(),
      conversation: startingConversation,
      pendingDelta: '',
      frame: null,
      cancelled: false,
      removed: false,
    };
    sessionRef.current = session;
    setRequestState('streaming');

    const scheduleDelta = () => {
      if (session.frame !== null || session.cancelled) {
        return;
      }
      const callback = () => {
        session.frame = null;
        if (!session.cancelled) {
          flushDelta(session);
        }
      };
      session.frame = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(callback)
        : window.setTimeout(callback, 16);
    };

    try {
      await transport({
        request: toChatRequest(startingConversation),
        signal: session.controller.signal,
        onEvent(event) {
          if (session.cancelled) {
            return;
          }
          if (event.type === 'delta') {
            session.pendingDelta += event.text;
            scheduleDelta();
            return;
          }
          flushDelta(session);
          applyToSession(session, event);
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
      if (!session.cancelled && !session.controller.signal.aborted) {
        flushDelta(session);
        const nextError = caught instanceof ChatTransportError
          ? { code: caught.code, message: caught.message, retryable: caught.retryable }
          : fallbackError;
        setError(nextError);
        const last = session.conversation.messages.at(-1);
        if (last?.role === 'assistant' && last.status === 'streaming') {
          applyToSession(session, { type: 'error', ...nextError });
        } else if (last?.role === 'user') {
          session.conversation = appendAssistantFailure(
            session.conversation,
            nextError,
            idFactory(),
            now(),
          );
          replaceConversation(session.conversation);
        }
      }
    } finally {
      cancelFrame(session);
      session.pendingDelta = '';
      if (sessionRef.current === session) {
        sessionRef.current = null;
        if (mountedRef.current) {
          setRequestState('idle');
        }
      }
    }
  }, [applyToSession, cancelFrame, flushDelta, idFactory, now, replaceConversation, transport]);

  const activeConversation =
    conversations.find(({ id }) => id === activeId) ?? conversations[0];

  const submit = useCallback(async () => {
    const conversation = conversationsRef.current.find(
      ({ id }) => id === activeIdRef.current,
    );
    const content = draft.trim();
    const last = conversation?.messages.at(-1);
    if (
      !conversation || !content || sessionRef.current || error ||
      last?.role === 'user' ||
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
    cancelActive(false, true);
  }, [cancelActive]);

  const retry = useCallback(async () => {
    const conversation = conversationsRef.current.find(
      ({ id }) => id === activeIdRef.current,
    );
    if (!conversation || sessionRef.current) {
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
    cancelActive(false, false);
    const conversation = createConversation(idFactory(), now());
    const next = [conversation, ...conversationsRef.current];
    conversationsRef.current = next;
    activeIdRef.current = conversation.id;
    setConversations(next);
    setActiveId(conversation.id);
    setDraft('');
    setError(null);
  }, [cancelActive, idFactory, now]);

  const selectConversation = useCallback((id: string) => {
    if (!conversationsRef.current.some((conversation) => conversation.id === id)) {
      return;
    }
    cancelActive(false, false);
    activeIdRef.current = id;
    setActiveId(id);
    setDraft('');
    setError(null);
  }, [cancelActive]);

  const deleteConversation = useCallback((id: string) => {
    if (sessionRef.current?.conversation.id === id) {
      cancelActive(true, false);
    }
    repository.remove(id);
    let next = conversationsRef.current.filter((conversation) => conversation.id !== id);
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
  }, [cancelActive, idFactory, now, repository]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (session) {
        session.cancelled = true;
        cancelFrame(session);
        session.controller.abort();
      }
    };
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
