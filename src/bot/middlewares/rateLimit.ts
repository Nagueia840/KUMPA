import type { Context, NextFunction } from 'grammy';
import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS } from '../../config/constants.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<number, Bucket>();

/** Rate-limit simple por chat (ventana deslizante). */
export async function rateLimitMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    await next();
    return;
  }

  const now = Date.now();
  const bucket = buckets.get(chatId);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(chatId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    await next();
    return;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    await ctx.reply('Pará un toque que me estás saturando 😅. Esperá un minuto y seguimos.');
    return;
  }

  bucket.count += 1;
  await next();
}
