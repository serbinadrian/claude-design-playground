import type {
  ChatRequest,
  ChatRole,
  ChatStreamEvent,
  Usage,
} from '@shared/chat-contracts';

export type MessageStatus = 'complete' | 'streaming' | 'error' | 'aborted';

export interface ConversationError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ResponseMetadata {
  requestId?: string;
  model?: string;
  httpStatus?: number;
  startedAt?: number;
  completedAt?: number;
  elapsedMs?: number;
  finishReason?: string | null;
  usage?: Usage;
  error?: ConversationError;
}

export interface ConversationMessage {
  id: string;
  role: ChatRole;
  content: string;
  status: MessageStatus;
  createdAt: number;
  metadata?: ResponseMetadata;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
}

const NEW_CONVERSATION_TITLE = 'New request';
const TITLE_LIMIT = 48;

const deriveTitle = (content: string): string => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length <= TITLE_LIMIT
    ? normalized
    : `${normalized.slice(0, TITLE_LIMIT - 1)}…`;
};

export const createConversation = (id: string, now: number): Conversation => ({
  id,
  title: NEW_CONVERSATION_TITLE,
  messages: [],
  createdAt: now,
  updatedAt: now,
});

export const appendUserTurn = (
  conversation: Conversation,
  content: string,
  id: string,
  now: number,
): Conversation => {
  const trimmedContent = content.trim();
  const message: ConversationMessage = {
    id,
    role: 'user',
    content: trimmedContent,
    status: 'complete',
    createdAt: now,
  };

  return {
    ...conversation,
    title:
      conversation.messages.length === 0
        ? deriveTitle(trimmedContent)
        : conversation.title,
    messages: [...conversation.messages, message],
    updatedAt: now,
  };
};

const updateLastAssistant = (
  conversation: Conversation,
  now: number,
  update: (message: ConversationMessage) => ConversationMessage,
): Conversation => {
  let index = -1;
  for (let candidate = conversation.messages.length - 1; candidate >= 0; candidate -= 1) {
    if (conversation.messages[candidate].role === 'assistant') {
      index = candidate;
      break;
    }
  }
  if (index < 0) {
    return conversation;
  }

  return {
    ...conversation,
    messages: conversation.messages.map((message, messageIndex) =>
      messageIndex === index ? update(message) : message,
    ),
    updatedAt: now,
  };
};

const completionTiming = (
  metadata: ResponseMetadata | undefined,
  now: number,
) => ({
  completedAt: now,
  ...(metadata?.startedAt !== undefined
    ? { elapsedMs: Math.max(0, now - metadata.startedAt) }
    : {}),
});

export const applyStreamEvent = (
  conversation: Conversation,
  event: ChatStreamEvent,
  now: number,
): Conversation => {
  if (event.type === 'start') {
    return {
      ...conversation,
      messages: [
        ...conversation.messages,
        {
          id: event.requestId,
          role: 'assistant',
          content: '',
          status: 'streaming',
          createdAt: now,
          metadata: {
            requestId: event.requestId,
            model: event.model,
            httpStatus: event.httpStatus,
            startedAt: now,
          },
        },
      ],
      updatedAt: now,
    };
  }

  if (event.type === 'delta') {
    return updateLastAssistant(conversation, now, (message) => ({
      ...message,
      content: `${message.content}${event.text}`,
    }));
  }

  if (event.type === 'complete') {
    return updateLastAssistant(conversation, now, (message) => ({
      ...message,
      status: 'complete',
      metadata: {
        ...message.metadata,
        ...completionTiming(message.metadata, now),
        finishReason: event.finishReason,
        ...(event.usage ? { usage: event.usage } : {}),
      },
    }));
  }

  return updateLastAssistant(conversation, now, (message) => ({
    ...message,
    status: 'error',
    metadata: {
      ...message.metadata,
      ...completionTiming(message.metadata, now),
      error: {
        code: event.code,
        message: event.message,
        retryable: event.retryable,
      },
    },
  }));
};

export const markConversationAborted = (
  conversation: Conversation,
  now: number,
): Conversation =>
  updateLastAssistant(conversation, now, (message) => {
    if (message.status !== 'streaming') {
      return message;
    }

    return {
      ...message,
      status: 'aborted',
      metadata: {
        ...message.metadata,
        ...completionTiming(message.metadata, now),
      },
    };
  });

export const appendAssistantFailure = (
  conversation: Conversation,
  error: ConversationError,
  id: string,
  now: number,
): Conversation => ({
  ...conversation,
  messages: [
    ...conversation.messages,
    {
      id,
      role: 'assistant',
      content: '',
      status: 'error',
      createdAt: now,
      metadata: {
        completedAt: now,
        error,
      },
    },
  ],
  updatedAt: now,
});

export const appendAbortedAssistant = (
  conversation: Conversation,
  id: string,
  now: number,
): Conversation => ({
  ...conversation,
  messages: [
    ...conversation.messages,
    {
      id,
      role: 'assistant',
      content: '',
      status: 'aborted',
      createdAt: now,
      metadata: { completedAt: now },
    },
  ],
  updatedAt: now,
});

export const prepareRetry = (conversation: Conversation): Conversation => {
  const lastMessage = conversation.messages.at(-1);
  if (
    lastMessage?.role !== 'assistant' ||
    (lastMessage.status !== 'error' && lastMessage.status !== 'aborted')
  ) {
    return conversation;
  }

  return {
    ...conversation,
    messages: conversation.messages.slice(0, -1),
  };
};

export const toChatRequest = (conversation: Conversation): ChatRequest => ({
  messages: conversation.messages
    .filter(
      (message) => message.role === 'user' || message.status === 'complete',
    )
    .map(({ role, content }) => ({ role, content })),
});
