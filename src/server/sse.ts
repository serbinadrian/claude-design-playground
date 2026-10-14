import type { Response } from 'express';

import type { ChatStreamEvent } from '@shared/chat-contracts';

export const writeSseEvent = (
  response: Response,
  event: ChatStreamEvent,
): boolean =>
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
