import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from 'express';

import type { ServerConfig } from '@server/config';
import type { ChatProvider } from '@server/provider';
import { ProviderError } from '@server/provider';
import { createSingularityProvider } from '@server/singularity-provider';
import { writeSseEvent } from '@server/sse';
import {
  type ApiErrorResponse,
  type ChatStreamEvent,
  type HealthResponse,
  validateChatRequest,
} from '@shared/chat-contracts';

const sendError = (
  response: Response<ApiErrorResponse>,
  status: number,
  code: string,
  message: string,
) => response.status(status).json({ error: { code, message } });

const bodyErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  void next;
  const candidate = error as { status?: number; type?: string };
  if (candidate.status === 413 || candidate.type === 'entity.too.large') {
    sendError(
      response,
      413,
      'body_too_large',
      'Request body exceeds the 48 KB limit.',
    );
    return;
  }

  if (candidate.status === 400 || candidate.type === 'entity.parse.failed') {
    sendError(response, 400, 'invalid_json', 'Request body must be valid JSON.');
    return;
  }

  sendError(response, 500, 'internal_error', 'The server could not process the request.');
};

const streamChat = async (
  request: Request,
  response: Response,
  config: ServerConfig,
  provider: ChatProvider,
) => {
  const validation = validateChatRequest(request.body);
  if (!validation.ok) {
    sendError(
      response,
      400,
      validation.error.code,
      validation.error.message,
    );
    return;
  }

  response.status(200);
  response.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();

  const controller = new AbortController();
  let finished = false;
  const abortIfOpen = () => {
    if (!finished) {
      controller.abort();
    }
  };
  request.once('aborted', abortIfOpen);
  response.once('close', abortIfOpen);

  writeSseEvent(response, {
    type: 'start',
    requestId: randomUUID(),
    model: config.model,
    httpStatus: 200,
  });

  try {
    for await (const event of provider.stream(
      validation.value.messages,
      controller.signal,
    )) {
      if (controller.signal.aborted || response.destroyed) {
        return;
      }

      const streamEvent: ChatStreamEvent = event;
      writeSseEvent(response, streamEvent);
    }
  } catch (error) {
    if (controller.signal.aborted || response.destroyed) {
      return;
    }

    const streamError: ChatStreamEvent =
      error instanceof ProviderError
        ? {
            type: 'error',
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          }
        : {
            type: 'error',
            code: 'internal_error',
            message: 'The server could not complete the model request.',
            retryable: true,
          };
    writeSseEvent(response, streamError);
  } finally {
    request.removeListener('aborted', abortIfOpen);
    response.removeListener('close', abortIfOpen);
    if (!response.destroyed) {
      finished = true;
      response.end();
    }
  }
};

export const createApp = ({
  config,
  provider,
}: {
  config: ServerConfig;
  provider?: ChatProvider;
}): Express => {
  const app = express();
  const chatProvider =
    provider ??
    (config.token
      ? createSingularityProvider({
          token: config.token,
          timeoutMs: config.timeoutMs,
        })
      : undefined);

  app.use(express.json({ limit: '48kb' }));

  app.get('/api/health', (_request, response: Response<HealthResponse>) => {
    response.json({
      status: config.token ? 'ready' : 'unconfigured',
      model: config.model,
    });
  });

  app.post('/api/chat', async (request, response) => {
    if (!config.token || !chatProvider) {
      sendError(
        response,
        503,
        'server_unconfigured',
        'SC_TOKEN is not configured on the server.',
      );
      return;
    }

    await streamChat(request, response, config, chatProvider);
  });

  const clientDirectory = resolve(process.cwd(), 'dist/client');
  const clientEntry = resolve(clientDirectory, 'index.html');
  if (existsSync(clientEntry)) {
    app.use(express.static(clientDirectory));
    app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
      response.sendFile(clientEntry);
    });
  }

  app.use(bodyErrorHandler);
  return app;
};
