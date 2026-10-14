import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';

import type { ServerConfig } from '@server/config';
import { sendError } from '@server/http-errors';
import { ProviderError, type ChatProvider } from '@server/provider';
import { writeSseEvent } from '@server/sse';
import { validateChatRequest, type ChatStreamEvent } from '@shared/chat-contracts';

interface ChatHandlerDependencies {
  config: ServerConfig;
  provider: ChatProvider;
  logger: Pick<Console, 'error'>;
}

const toStreamError = (
  error: unknown,
): Extract<ChatStreamEvent, { type: 'error' }> => {
  if (error instanceof ProviderError) {
    return {
      type: 'error',
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    type: 'error',
    code: 'internal_error',
    message: 'The server could not complete the model request.',
    retryable: true,
  };
};

export const createChatHandler = ({
  config,
  provider,
  logger,
}: ChatHandlerDependencies) => async (request: Request, response: Response) => {
  const validation = validateChatRequest(request.body);
  if (!validation.ok) {
    sendError(response, 400, validation.error.code, validation.error.message);
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

  const requestId = randomUUID();
  writeSseEvent(response, {
    type: 'start',
    requestId,
    model: config.model,
    httpStatus: 200,
  });

  try {
    for await (const event of provider.stream(validation.value.messages, controller.signal)) {
      if (controller.signal.aborted || response.destroyed) {
        return;
      }
      writeSseEvent(response, event);
    }
  } catch (error) {
    if (controller.signal.aborted || response.destroyed) {
      return;
    }
    const streamError = toStreamError(error);
    logger.error('Chat provider request failed.', {
      requestId,
      code: streamError.code,
      retryable: streamError.retryable,
    });
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
