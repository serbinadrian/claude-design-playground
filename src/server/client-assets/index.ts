import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import express, { type Express } from 'express';

export const registerClientAssets = (app: Express, clientDirectory: string) => {
  const clientEntry = resolve(clientDirectory, 'index.html');
  if (!existsSync(clientEntry)) {
    return;
  }

  app.use(express.static(clientDirectory));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api')) {
      next();
      return;
    }
    response.sendFile('index.html', { root: clientDirectory });
  });
};
