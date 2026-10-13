import 'dotenv/config';

import type { Server } from 'node:http';

import { createApp } from '@server/app';
import { readServerConfig, type ServerConfig } from '@server/config';

export const startServer = async (config: ServerConfig): Promise<Server> => {
  const app = createApp({ config });

  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, () => resolve(server));
    server.once('error', reject);
  });
};

const config = readServerConfig();
const server = await startServer(config);

console.log(`Quick LLM server listening on http://localhost:${config.port}`);

const shutdown = (signal: NodeJS.Signals) => {
  console.log(`Received ${signal}; closing the server.`);
  server.close((error) => {
    if (error) {
      console.error('Server shutdown failed.', error);
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
