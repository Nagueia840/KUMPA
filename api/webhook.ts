import { webhookCallback } from 'grammy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getBot } from '../src/singleton.js';

// Entry point para Vercel (Node runtime). Este archivo DEBE estar en /api/webhook.ts
export const config = { maxDuration: 60 };

const handlerPromise = getBot().then((bot) => webhookCallback(bot, 'http'));

export default async function webhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const handler = await handlerPromise;
  await handler(req, res);
}
