import { describe, expect, it, vi } from 'vitest';

import type { ChatMessage } from '@shared/chat-contracts';
import { ProviderError } from '@server/provider';
import { createSingularityProvider } from '@server/singularity-provider';

const messages: ChatMessage[] = [{ role: 'user', content: 'What is fish?' }];

const streamResponse = (chunks: Uint8Array[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const collect = async (provider: ReturnType<typeof createSingularityProvider>) => {
  const events = [];
  for await (const event of provider.stream(messages, new AbortController().signal)) {
    events.push(event);
  }
  return events;
};

describe('createSingularityProvider', () => {
  it('sends the exact OpenAI-compatible streaming request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([new TextEncoder().encode('data: [DONE]\n\n')]),
    );
    const provider = createSingularityProvider({
      token: 'server-secret',
      fetchImpl,
    });

    await collect(provider);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      'https://llm.a.singularitycompute.com/v1/chat/completions',
    );
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer server-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'asi1-mini', messages, stream: true }),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reassembles fragmented UTF-8 and SSE boundaries in order', async () => {
    const payload = [
      ': heartbeat\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"café"},"finish_reason":null}]}\r\n\r\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],',
      '"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\r\n\r\n',
      'data: [DONE]\r\n\r\n',
    ].join('');
    const bytes = new TextEncoder().encode(payload);
    const accentByte = bytes.findIndex((byte) => byte === 0xc3);
    const chunks = [
      bytes.slice(0, 7),
      bytes.slice(7, accentByte + 1),
      bytes.slice(accentByte + 1, accentByte + 19),
      bytes.slice(accentByte + 19),
    ];
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(streamResponse(chunks));
    const provider = createSingularityProvider({ token: 'token', fetchImpl });

    await expect(collect(provider)).resolves.toEqual([
      { type: 'delta', text: 'café' },
      {
        type: 'complete',
        finishReason: 'stop',
        usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
      },
    ]);
  });

  it('completes without usage when the provider omits it', async () => {
    const body = [
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(streamResponse([new TextEncoder().encode(body)]));
    const provider = createSingularityProvider({ token: 'token', fetchImpl });

    await expect(collect(provider)).resolves.toEqual([
      { type: 'complete', finishReason: 'length' },
    ]);
  });

  it('turns non-2xx responses into a safe upstream error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('sensitive provider body', { status: 503 }));
    const provider = createSingularityProvider({
      token: 'server-secret',
      fetchImpl,
    });

    await expect(collect(provider)).rejects.toMatchObject({
      code: 'upstream_http',
      retryable: true,
    });
    await expect(collect(provider)).rejects.not.toThrow(/sensitive|server-secret/);
  });

  it('turns malformed event JSON into a safe stream error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([new TextEncoder().encode('data: {not-json}\n\n')]),
    );
    const provider = createSingularityProvider({ token: 'token', fetchImpl });

    await expect(collect(provider)).rejects.toMatchObject({
      code: 'upstream_stream',
      retryable: true,
    });
  });

  it('aborts a stalled request at the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    );
    const provider = createSingularityProvider({
      token: 'token',
      fetchImpl,
      timeoutMs: 60_000,
    });

    const result = collect(provider);
    const assertion = expect(result).rejects.toEqual(
      expect.objectContaining<Partial<ProviderError>>({
        code: 'timeout',
        retryable: true,
      }),
    );
    await vi.advanceTimersByTimeAsync(60_000);

    await assertion;
    vi.useRealTimers();
  });

  it('preserves caller cancellation as an aborted error', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    );
    const provider = createSingularityProvider({ token: 'token', fetchImpl });
    const result = (async () => {
      const events = [];
      for await (const event of provider.stream(messages, controller.signal)) {
        events.push(event);
      }
      return events;
    })();

    controller.abort();

    await expect(result).rejects.toMatchObject({
      code: 'aborted',
      retryable: false,
    });
  });
});
