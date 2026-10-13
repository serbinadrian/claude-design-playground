import { describe, expect, it, vi } from 'vitest';

import {
  ChatTransportError,
  streamChat,
} from '@client/chat-transport';
import type { ChatStreamEvent } from '@shared/chat-contracts';

const request = {
  messages: [{ role: 'user' as const, content: 'What is fish?' }],
};

const streamResponse = (
  chunks: string[],
  lineEnding = '\n',
): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk.replaceAll('\n', lineEnding)));
        }
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

const run = async (response: Response) => {
  const events: ChatStreamEvent[] = [];
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
  await streamChat({
    request,
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    fetchImpl,
  });
  return { events, fetchImpl };
};

describe('streamChat', () => {
  it('posts the request and decodes fragmented CRLF SSE events in order', async () => {
    const start = JSON.stringify({
      type: 'start',
      requestId: 'request-1',
      model: 'asi1-mini',
      httpStatus: 200,
    });
    const delta = JSON.stringify({ type: 'delta', text: 'hello' });
    const complete = JSON.stringify({ type: 'complete', finishReason: 'stop' });
    const payload = `event: start\ndata: ${start}\n\nevent: delta\ndata: ${delta}\n\nevent: complete\ndata: ${complete}\n\n`;
    const { events, fetchImpl } = await run(
      streamResponse(
        [payload.slice(0, 17), payload.slice(17, 63), payload.slice(63)],
        '\r\n',
      ),
    );

    expect(fetchImpl).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: expect.any(AbortSignal),
    });
    expect(events).toEqual([
      {
        type: 'start',
        requestId: 'request-1',
        model: 'asi1-mini',
        httpStatus: 200,
      },
      { type: 'delta', text: 'hello' },
      { type: 'complete', finishReason: 'stop' },
    ]);
  });

  it('parses multiple data-only events from one chunk', async () => {
    const body = [
      'data: {"type":"delta","text":"one"}\n\n',
      'data: {"type":"delta","text":"two"}\n\n',
      'data: {"type":"complete","finishReason":null}\n\n',
    ].join('');

    await expect(run(streamResponse([body]))).resolves.toMatchObject({
      events: [
        { type: 'delta', text: 'one' },
        { type: 'delta', text: 'two' },
        { type: 'complete', finishReason: null },
      ],
    });
  });

  it('delivers a normalized stream error event', async () => {
    const event = {
      type: 'error',
      code: 'upstream_http',
      message: 'The model service rejected the request.',
      retryable: true,
    };

    await expect(
      run(streamResponse([`event: error\ndata: ${JSON.stringify(event)}\n\n`])),
    ).resolves.toMatchObject({ events: [event] });
  });

  it('throws a typed error for malformed event JSON', async () => {
    await expect(
      run(streamResponse(['event: delta\ndata: {nope}\n\n'])),
    ).rejects.toMatchObject({
      name: 'ChatTransportError',
      code: 'malformed_stream',
      retryable: true,
    });
  });

  it('surfaces a safe pre-stream API error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { error: { code: 'conversation_too_long', message: 'Keep all history.' } },
        { status: 400 },
      ),
    );

    await expect(
      streamChat({
        request,
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        fetchImpl,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'conversation_too_long',
        message: 'Keep all history.',
        retryable: false,
      }),
    );
  });

  it('wraps a network failure in a typed retryable error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Network unavailable'));

    await expect(
      streamChat({
        request,
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        fetchImpl,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'network_error',
        retryable: true,
      }),
    );
  });

  it('preserves caller aborts instead of converting them to generic errors', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Aborted', 'AbortError');
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      throw abortError;
    });

    const promise = streamChat({
      request,
      signal: controller.signal,
      onEvent: vi.fn(),
      fetchImpl,
    });

    await expect(promise).rejects.toBe(abortError);
    await promise.catch((error: unknown) => {
      expect(error).not.toBeInstanceOf(ChatTransportError);
    });
  });
});
