import type { ErrorRequestHandler, Response } from 'express';

import type { ApiErrorResponse } from '@shared/chat-contracts';

export const sendError = (
  response: Response<ApiErrorResponse>,
  status: number,
  code: string,
  message: string,
) => response.status(status).json({ error: { code, message } });

export const bodyErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  void next;
  const candidate = error as { status?: number; type?: string };
  if (candidate.status === 413 || candidate.type === 'entity.too.large') {
    sendError(response, 413, 'body_too_large', 'Request body exceeds the 48 KB limit.');
    return;
  }

  if (candidate.status === 400 || candidate.type === 'entity.parse.failed') {
    sendError(response, 400, 'invalid_json', 'Request body must be valid JSON.');
    return;
  }

  sendError(response, 500, 'internal_error', 'The server could not process the request.');
};
