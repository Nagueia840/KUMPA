import type { Context, NextFunction } from 'grammy';

/** Registra cada update con latencia y un extracto del texto. */
export async function loggingMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const startedAt = Date.now();
  await next();
  const ms = Date.now() - startedAt;
  const chatId = ctx.chat?.id ?? '?';
  const text = extractText(ctx);
  console.info(`[bot] chat=${chatId} ms=${ms}${text ? ` text=${truncate(text)}` : ''}`);
}

function extractText(ctx: Context): string | undefined {
  const msg = ctx.message;
  if (msg && 'text' in msg && typeof msg.text === 'string') return msg.text;
  const cb = ctx.callbackQuery;
  if (cb?.data) return cb.data;
  return undefined;
}

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
