import type {
  ApiErrorResponse,
  ChatRequest,
  ChatStreamEvent,
  Usage,
} from '@shared/chat-contracts';

export class ChatTransportError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'ChatTransportError';
    this.code = code;
    this.retryable = retryable;
  }
}

interface StreamChatOptions {
  request: ChatRequest;
  signal: AbortSignal;
  onEvent(event: ChatStreamEvent): void;
  fetchImpl?: typeof fetch;
}

const malformedStream = () =>
  new ChatTransportError(
    'malformed_stream',
    'The server returned an invalid event stream.',
    true,
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readUsage = (value: unknown): Usage | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage: Usage = {};
  if (typeof value.promptTokens === 'number') {
    usage.promptTokens = value.promptTokens;
  }
  if (typeof value.completionTokens === 'number') {
    usage.completionTokens = value.completionTokens;
  }
  if (typeof value.totalTokens === 'number') {
    usage.totalTokens = value.totalTokens;
  }
  return usage;
};

const parseEvent = (data: string): ChatStreamEvent => {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw malformedStream();
  }

  if (!isRecord(value) || typeof value.type !== 'string') {
    throw malformedStream();
  }

  if (
    value.type === 'start' &&
    typeof value.requestId === 'string' &&
    typeof value.model === 'string' &&
    value.httpStatus === 200
  ) {
    return {
      type: 'start',
      requestId: value.requestId,
      model: value.model,
      httpStatus: 200,
    };
  }

  if (value.type === 'delta' && typeof value.text === 'string') {
    return { type: 'delta', text: value.text };
  }

  if (
    value.type === 'complete' &&
    (typeof value.finishReason === 'string' || value.finishReason === null)
  ) {
    const usage = readUsage(value.usage);
    return {
      type: 'complete',
      finishReason: value.finishReason,
      ...(usage ? { usage } : {}),
    };
  }

  if (
    value.type === 'error' &&
    typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.retryable === 'boolean'
  ) {
    return {
      type: 'error',
      code: value.code,
      message: value.message,
      retryable: value.retryable,
    };
  }

  throw malformedStream();
};

const readApiError = async (response: Response): Promise<ChatTransportError> => {
  try {
    const body = (await response.json()) as Partial<ApiErrorResponse>;
    if (
      body.error &&
      typeof body.error.code === 'string' &&
      typeof body.error.message === 'string'
    ) {
      return new ChatTransportError(
        body.error.code,
        body.error.message,
        response.status === 429 || response.status >= 500,
      );
    }
  } catch {
    // Fall through to a stable client-owned error.
  }

  return new ChatTransportError(
    'http_error',
    `The chat request failed with HTTP ${response.status}.`,
    response.status === 429 || response.status >= 500,
  );
};

const consumeBlock = (
  block: string,
  onEvent: (event: ChatStreamEvent) => void,
): ChatStreamEvent | undefined => {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data) {
    return undefined;
  }

  const event = parseEvent(data);
  onEvent(event);
  return event;
};

export const streamChat = async ({
  request,
  signal,
  onEvent,
  fetchImpl = fetch,
}: StreamChatOptions): Promise<void> => {
  try {
    const response = await fetchImpl('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      throw await readApiError(response);
    }
    if (!response.body) {
      throw malformedStream();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminalEvent = false;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const event = consumeBlock(buffer.slice(0, boundary), onEvent);
        terminalEvent ||= event?.type === 'complete' || event?.type === 'error';
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
      if (done) {
        break;
      }
    }

    if (buffer.trim()) {
      const event = consumeBlock(buffer, onEvent);
      terminalEvent ||= event?.type === 'complete' || event?.type === 'error';
    }
    if (!terminalEvent) {
      throw malformedStream();
    }
  } catch (error) {
    if (
      signal.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw error;
    }
    if (error instanceof ChatTransportError) {
      throw error;
    }
    throw new ChatTransportError(
      'network_error',
      'The chat service could not be reached.',
      true,
    );
  }
};
