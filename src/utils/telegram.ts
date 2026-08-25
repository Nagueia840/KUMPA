import type { Context } from 'grammy';

// Margen bajo el límite real de Telegram (4096 caracteres por mensaje)
const MAX_TELEGRAM_MESSAGE = 4000;

/** Divide un texto en chunks que no superen el límite de Telegram. */
export function chunkText(text: string, maxLen = MAX_TELEGRAM_MESSAGE): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed ? [trimmed] : [];

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of trimmed.split('\n')) {
    if (current.length + paragraph.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = paragraph;
      // párrafo único más largo que el límite → corte duro
      while (current.length > maxLen) {
        chunks.push(current.slice(0, maxLen));
        current = current.slice(maxLen);
      }
    } else {
      current = current ? `${current}\n${paragraph}` : paragraph;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/** Envía un texto por Telegram, dividiéndolo en varios mensajes si hace falta. */
export async function replyLong(
  ctx: Context,
  text: string,
  other?: { parse_mode?: 'HTML' },
): Promise<void> {
  for (const chunk of chunkText(text)) {
    await ctx.reply(chunk, other);
  }
}
