import type { ChatMessage, Usage } from '@shared/chat-contracts';

export type ProviderEvent =
  | { type: 'delta'; text: string }
  | { type: 'complete'; finishReason: string | null; usage?: Usage };

export interface ChatProvider {
  stream(
    messages: ChatMessage[],
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
}

export type ProviderErrorCode =
  | 'upstream_http'
  | 'upstream_stream'
  | 'timeout'
  | 'aborted';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: ProviderErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}
