import type { ChatMessage, Usage } from '@shared/chat-contracts';
import {
  type ChatProvider,
  type ProviderEvent,
  ProviderError,
} from '@server/provider';
import {
  normalizeUsage,
  type OpenAiChunk,
} from '@server/singularity-provider/openai-chunk';
import { readSseData } from '@server/singularity-provider/sse-reader';

const ENDPOINT = 'https://llm.a.singularitycompute.com/v1/chat/completions';
const MODEL = 'asi1-mini';
const DEFAULT_TIMEOUT_MS = 60_000;

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
