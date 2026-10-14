export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type ChatStreamEvent =
  | {
      type: 'start';
      requestId: string;
      model: string;
      httpStatus: 200;
    }
  | {
      type: 'delta';
      text: string;
    }
  | {
      type: 'complete';
      finishReason: string | null;
      usage?: Usage;
    }
  | {
      type: 'error';
      code: string;
      message: string;
      retryable: boolean;
    };

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export interface HealthResponse {
  status: 'ready' | 'unconfigured';
  model: string;
}

export const CHAT_LIMITS = {
  maxMessages: 40,
  maxMessageCharacters: 8_000,
  maxConversationCharacters: 32_000,
} as const;

export interface ValidationError {
  code: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ValidationError };

const invalid = (code: string, message: string): ValidationResult<never> => ({
  ok: false,
  error: { code, message },
});

export const validateChatRequest = (
  input: unknown,
): ValidationResult<ChatRequest> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalid('invalid_body', 'Request body must be a JSON object.');
  }

  const messages = (input as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return invalid(
      'messages_required',
      'At least one conversation message is required.',
    );
  }

  if (messages.length > CHAT_LIMITS.maxMessages) {
    return invalid(
      'too_many_messages',
      `A conversation may contain at most ${CHAT_LIMITS.maxMessages} messages.`,
    );
  }

  let totalCharacters = 0;
  const validatedMessages: ChatMessage[] = [];

  for (const [index, candidate] of messages.entries()) {
    if (typeof candidate !== 'object' || candidate === null) {
      return invalid('invalid_message', `Message ${index + 1} is invalid.`);
    }

    const { role, content } = candidate as {
      role?: unknown;
      content?: unknown;
    };

    if (role !== 'user' && role !== 'assistant') {
      return invalid(
        'invalid_role',
        `Message ${index + 1} must use the user or assistant role.`,
      );
    }

    const expectedRole: ChatRole = index % 2 === 0 ? 'user' : 'assistant';
    if (role !== expectedRole) {
      return invalid(
        'invalid_sequence',
        'Conversation messages must alternate user and assistant roles.',
      );
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      return invalid(
        'content_required',
        `Message ${index + 1} must contain text.`,
      );
    }

    if (content.length > CHAT_LIMITS.maxMessageCharacters) {
      return invalid(
        'message_too_long',
        `Each message is limited to ${CHAT_LIMITS.maxMessageCharacters} characters.`,
      );
    }

    totalCharacters += content.length;
    if (totalCharacters > CHAT_LIMITS.maxConversationCharacters) {
      return invalid(
        'conversation_too_long',
        `Conversation content is limited to ${CHAT_LIMITS.maxConversationCharacters} characters.`,
      );
    }

    validatedMessages.push({ role, content });
  }

  if (validatedMessages.at(-1)?.role !== 'user') {
    return invalid(
      'invalid_sequence',
      'The final conversation message must use the user role.',
    );
  }

  return { ok: true, value: { messages: validatedMessages } };
};
