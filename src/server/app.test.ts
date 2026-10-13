import { createServer, request as httpRequest } from 'node:http';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '@server/app';
import type { ServerConfig } from '@server/config';
import type { ChatProvider, ProviderEvent } from '@server/provider';
import { ProviderError } from '@server/provider';
import type { ChatStreamEvent } from '@shared/chat-contracts';

const readyConfig: ServerConfig = {
  port: 8787,
  token: 'server-token',
  model: 'asi1-mini',
  timeoutMs: 60_000,
};

const validBody = {
  messages: [{ role: 'user' as const, content: 'What is fish?' }],
};

const providerFrom = (
  factory: (signal: AbortSignal) => AsyncGenerator<ProviderEvent>,
): ChatProvider => ({
  stream(_messages, signal) {
    return factory(signal);
  },
});

const parseEvents = (body: string): ChatStreamEvent[] =>
  body
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const data = block
        .split(/\r?\n/)
        .find((line) => line.startsWith('data: '));
      if (!data) {
        throw new Error(`Missing SSE data in ${block}`);
      }
      return JSON.parse(data.slice(6)) as ChatStreamEvent;
    });

describe('createApp', () => {
  it('reports ready health without exposing the token', async () => {
    const app = createApp({
      config: readyConfig,
      provider: providerFrom(async function* () {}),
    });

    const response = await request(app).get('/api/health').expect(200);

    expect(response.body).toEqual({ status: 'ready', model: 'asi1-mini' });
    expect(response.text).not.toContain('server-token');
  });

  it('reports unconfigured health and blocks chat when the token is missing', async () => {
    const app = createApp({
      config: { ...readyConfig, token: undefined },
    });

    await request(app)
      .get('/api/health')
      .expect(200, { status: 'unconfigured', model: 'asi1-mini' });
    await request(app).post('/api/chat').send(validBody).expect(503, {
      error: {
        code: 'server_unconfigured',
        message: 'SC_TOKEN is not configured on the server.',
      },
    });
  });

  it('returns the shared validation error shape before opening a stream', async () => {
    const app = createApp({
      config: readyConfig,
      provider: providerFrom(async function* () {}),
    });

    await request(app).post('/api/chat').send({ messages: [] }).expect(400, {
      error: {
        code: 'messages_required',
        message: 'At least one conversation message is required.',
      },
    });
  });

  it('streams normalized start, delta, and completion events in order', async () => {
    const provider = providerFrom(async function* () {
      yield { type: 'delta', text: 'A fish' };
      yield { type: 'delta', text: ' lives in water.' };
      yield {
        type: 'complete',
        finishReason: 'stop',
        usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      };
    });
    const app = createApp({ config: readyConfig, provider });

    const response = await request(app)
      .post('/api/chat')
      .send(validBody)
      .expect(200)
      .expect('content-type', /text\/event-stream/)
      .expect('cache-control', 'no-cache')
      .expect('connection', 'keep-alive');

    const events = parseEvents(response.text);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({
      type: 'start',
      model: 'asi1-mini',
      httpStatus: 200,
    });
    expect(events[0]).toHaveProperty('requestId', expect.any(String));
    expect(events.slice(1)).toEqual([
      { type: 'delta', text: 'A fish' },
      { type: 'delta', text: ' lives in water.' },
      {
        type: 'complete',
        finishReason: 'stop',
        usage: { promptTokens: 4, completionTokens: 6, totalTokens: 10 },
      },
    ]);
  });

  it('converts provider failures into safe stream errors', async () => {
    const provider = providerFrom(async function* () {
      yield* [] as ProviderEvent[];
      throw new ProviderError(
        'upstream_http',
        'The model service returned HTTP 503.',
        true,
      );
    });
    const app = createApp({ config: readyConfig, provider });

    const response = await request(app).post('/api/chat').send(validBody);
    const events = parseEvents(response.text);

    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'upstream_http',
      message: 'The model service returned HTTP 503.',
      retryable: true,
    });
  });

  it('rejects request bodies over 48 KB with a stable error', async () => {
    const app = createApp({
      config: readyConfig,
      provider: providerFrom(async function* () {}),
    });

    await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'x'.repeat(50_000) }] })
      .expect(413, {
        error: {
          code: 'body_too_large',
          message: 'Request body exceeds the 48 KB limit.',
        },
      });
  });

  it('aborts provider work when the client disconnects', async () => {
    let resolveAborted: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      resolveAborted = resolve;
    });
    const provider = providerFrom(async function* (signal) {
      yield { type: 'delta', text: 'first chunk' };
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolveAborted?.();
            resolve();
          },
          { once: true },
        );
      });
    });
    const server = createServer(createApp({ config: readyConfig, provider }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an ephemeral TCP port.');
    }

    let received = '';
    await new Promise<void>((resolve, reject) => {
      const clientRequest = requestNode(
        address.port,
        JSON.stringify(validBody),
        (chunk) => {
          received += chunk;
          if (received.includes('first chunk')) {
            clientRequest.destroy();
            resolve();
          }
        },
        reject,
      );
    });

    await aborted;
    expect(received).toContain('first chunk');
    expect(received).not.toContain('"type":"error"');
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
});

const requestNode = (
  port: number,
  body: string,
  onData: (chunk: string) => void,
  onError: (error: Error) => void,
) => {
  const req = httpRequest(
    {
      host: '127.0.0.1',
      port,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (response) => {
      response.setEncoding('utf8');
      response.on('data', onData);
      response.on('error', onError);
    },
  );
  req.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') {
      onError(error);
    }
  });
  req.end(body);
  return req;
};
