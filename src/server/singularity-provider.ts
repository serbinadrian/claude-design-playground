import type { ChatMessage, Usage } from '@shared/chat-contracts';
import {
  type ChatProvider,
  type ProviderEvent,
  ProviderError,
} from '@server/provider';

const ENDPOINT = 'https://llm.a.singularitycompute.com/v1/chat/completions';
const MODEL = 'asi1-mini';
const DEFAULT_TIMEOUT_MS = 60_000;

interface OpenAiChunk {
  choices?: Array<{
    delta?: { content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

const extractData = (block: string): string | undefined => {
  const data = block
    .split('\n')
    .filter((line) => !line.startsWith(':'))
    .filter((line) => line === 'data' || line.startsWith('data:'))
    .map((line) => {
      const value = line.slice(5);
      return value.startsWith(' ') ? value.slice(1) : value;
    });

  return data.length > 0 ? data.join('\n') : undefined;
};

async function* readSseData(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replaceAll('\r\n', '\n');

      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = extractData(block);
        if (data !== undefined) {
          yield data;
        }
        boundary = buffer.indexOf('\n\n');
      }

      if (done) {
        const data = extractData(buffer);
        if (data !== undefined) {
          yield data;
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const normalizeUsage = (chunk: OpenAiChunk): Usage | undefined => {
  if (!chunk.usage) {
    return undefined;
  }

  const usage: Usage = {
    promptTokens: asNumber(chunk.usage.prompt_tokens),
    completionTokens: asNumber(chunk.usage.completion_tokens),
    totalTokens: asNumber(chunk.usage.total_tokens),
  };

  return Object.values(usage).some((value) => value !== undefined)
    ? usage
    : undefined;
};

const classifyAbort = (
  callerSignal: AbortSignal,
  timedOut: boolean,
): ProviderError => {
  if (callerSignal.aborted) {
    return new ProviderError('aborted', 'The request was cancelled.', false);
  }

  if (timedOut) {
    return new ProviderError('timeout', 'The model request timed out.', true);
  }

  return new ProviderError(
    'upstream_stream',
    'The model response stream was interrupted.',
    true,
  );
};

export const createSingularityProvider = ({
  token,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): ChatProvider => ({
  async *stream(
    messages: ChatMessage[],
    callerSignal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const requestController = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => requestController.abort(callerSignal.reason);
    const timeout = setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, timeoutMs);

    if (callerSignal.aborted) {
      abortFromCaller();
    } else {
      callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    }

    try {
      let response: Response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: MODEL, messages, stream: true }),
          signal: requestController.signal,
        });
      } catch {
        if (requestController.signal.aborted) {
          throw classifyAbort(callerSignal, timedOut);
        }
        throw new ProviderError(
          'upstream_http',
          'The model service could not be reached.',
          true,
        );
      }

      if (!response.ok) {
        throw new ProviderError(
          'upstream_http',
          `The model service returned HTTP ${response.status}.`,
          response.status === 429 || response.status >= 500,
        );
      }

      if (!response.body) {
        throw new ProviderError(
          'upstream_stream',
          'The model service returned an empty stream.',
          true,
        );
      }

      let finishReason: string | null = null;
      let usage: Usage | undefined;

      try {
        for await (const data of readSseData(response.body)) {
          if (data === '[DONE]') {
            yield {
              type: 'complete',
              finishReason,
              ...(usage ? { usage } : {}),
            };
            return;
          }

          let chunk: OpenAiChunk;
          try {
            chunk = JSON.parse(data) as OpenAiChunk;
          } catch {
            throw new ProviderError(
              'upstream_stream',
              'The model service returned malformed stream data.',
              true,
            );
          }

          const choice = chunk.choices?.[0];
          const content = choice?.delta?.content;
          if (typeof content === 'string' && content.length > 0) {
            yield { type: 'delta', text: content };
          }

          if (typeof choice?.finish_reason === 'string') {
            finishReason = choice.finish_reason;
          }

          usage = normalizeUsage(chunk) ?? usage;
        }
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }
        if (requestController.signal.aborted) {
          throw classifyAbort(callerSignal, timedOut);
        }
        throw new ProviderError(
          'upstream_stream',
          'The model response stream was interrupted.',
          true,
        );
      }

      throw new ProviderError(
        'upstream_stream',
        'The model response ended unexpectedly.',
        true,
      );
    } finally {
      clearTimeout(timeout);
      callerSignal.removeEventListener('abort', abortFromCaller);
    }
  },
});
