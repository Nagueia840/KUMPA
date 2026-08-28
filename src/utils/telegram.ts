import type { Context } from 'grammy';
import { markdownBoldToHtml, sanitizeOutput } from './sanitize.js';

// Margen bajo el límite real de Telegram (4096 caracteres por mensaje)
const MAX_TELEGRAM_MESSAGE = 4000;

/**
 * Divide un texto en chunks que no superen el límite de Telegram.
 * F.3 — los cortes DUROS (párrafo único > límite) nunca parten una palabra:
 * se corta en el último límite de oración (., !, ?, …) disponible dentro del
 * límite, o en el último espacio si no hay oración completa (límite real).
 */
export function chunkText(text: string, maxLen = MAX_TELEGRAM_MESSAGE): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed ? [trimmed] : [];

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of trimmed.split('\n')) {
    if (current.length + paragraph.length + 1 > maxLen) {
      if (current) chunks.push(current);
      let rest = paragraph;
      while (rest.length > maxLen) {
        const slice = rest.slice(0, maxLen);
        // 1) último límite de oración dentro del slice (si hay al menos 60% del chunk);
        // 2) si no, último espacio (nunca a mitad de palabra).
        const sent = Math.max(
          slice.lastIndexOf('. '),
          slice.lastIndexOf('! '),
          slice.lastIndexOf('? '),
          slice.lastIndexOf('… '),
          slice.lastIndexOf('.\n'),
        );
        const space = slice.lastIndexOf(' ');
        const at = sent > maxLen * 0.5 ? sent + 2 : space > maxLen * 0.5 ? space + 1 : maxLen;
        chunks.push(rest.slice(0, at).trimEnd());
        rest = rest.slice(at).trimStart();
        if (at === maxLen && rest.length > 0) {
          console.log('[telegram] trunc_source=TELEGRAM_SPLIT_TRUNCATION (límite real de mensaje)');
        }
      }
      current = rest;
    } else {
      current = current ? `${current}\n${paragraph}` : paragraph;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Envía un texto por Telegram, dividiéndolo en varios mensajes si hace falta.
 *
 * TRATAMIENTO DE SALIDA (auditoría de fidelidad):
 * - SIEMPRE sanitiza (quita caracteres CJK y tokens de ruido como
 *   "tendenciaup"/"parachirurgical" — bug real de producción).
 * - Si el caller NO especificó parse_mode (texto plano del agente/LLM),
 *   convierte markdown `**bold**` → `<b>bold</b>` con escape HTML seguro y
 *   envía con parse_mode 'HTML' (corrige `**1D**` literal en Telegram).
 * - Si el caller YA pasó `parse_mode: 'HTML'` (formatScan/formatPlan/briefing),
 *   respeta el HTML tal cual (no re-escapa tags existentes).
 */
export async function replyLong(
  ctx: Context,
  text: string,
  other?: { parse_mode?: 'HTML' },
): Promise<void> {
  const clean = sanitizeOutput(text);
  const html = other?.parse_mode ? clean : markdownBoldToHtml(clean);
  for (const chunk of chunkText(html)) {
    await ctx.reply(chunk, { ...other, parse_mode: 'HTML' });
  }
}
