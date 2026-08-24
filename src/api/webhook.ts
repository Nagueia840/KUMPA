import { webhookCallback } from 'grammy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getBot } from '../singleton.js';

// Entry point para Vercel (Node runtime). Ubicación recomendada: api/webhook.ts
// Configurá el webhook de Telegram con:
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<TU_URL>/api/webhook
export const config = { runtime: 'nodejs' };

const handlerPromise = getBot().then((bot) => webhookCallback(bot, 'http'));

export default async function webhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const handler = await handlerPromise;
  await handler(req, res);
}
