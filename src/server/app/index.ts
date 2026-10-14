import { resolve } from 'node:path';

import express, { type Express, type Response } from 'express';

import { createChatHandler } from '@server/chat-handler';
import { registerClientAssets } from '@server/client-assets';
import type { ServerConfig } from '@server/config';
import type { ChatProvider } from '@server/provider';
import { bodyErrorHandler, sendError } from '@server/http-errors';
import { createSingularityProvider } from '@server/singularity-provider';
import type { HealthResponse } from '@shared/chat-contracts';

export const createApp = ({
  config,
  provider,
  clientDirectory = resolve(process.cwd(), 'dist/client'),
  logger = console,
}: {
  config: ServerConfig;
  provider?: ChatProvider;
  clientDirectory?: string;
  logger?: Pick<Console, 'error'>;
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
  const chatHandler = chatProvider
    ? createChatHandler({ config, provider: chatProvider, logger })
    : undefined;

  app.use(express.json({ limit: '48kb' }));

  app.get('/api/health', (_request, response: Response<HealthResponse>) => {
    response.json({
      status: config.token ? 'ready' : 'unconfigured',
      model: config.model,
    });
  });

  app.post('/api/chat', async (request, response) => {
    if (!config.token || !chatHandler) {
      sendError(
        response,
        503,
        'server_unconfigured',
        'SC_TOKEN is not configured on the server.',
      );
      return;
    }

    await chatHandler(request, response);
  });

  registerClientAssets(app, clientDirectory);

  app.use(bodyErrorHandler);
  return app;
};
