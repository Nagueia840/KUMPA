import type { IncomingMessage, ServerResponse } from 'node:http';
import { Bot } from 'grammy';
import { MemoryStore } from '../src/memory/store.js';
import { loadEnv } from '../src/config/env.js';
import { webhookAck } from '../src/webhook/queue.js';

// Entry point para Vercel (Node runtime).
export const config = { maxDuration: 10 };

/**
 * WEBHOOK ACK-ONLY (arquitectura asíncrona definitiva).
 * EXCLUSIVAMENTE: parse mínimo → update_id → insert en update_inbox (Supabase)
 * → (feedback "Analizando…" solo si fue aceptado) → HTTP 200.
 *
 * PROHIBIDO aquí: bot.handleUpdate, LLM, Bitget, Exa, voz/visión pesada.
 * El procesamiento pesado lo ejecuta la Edge Function kumpa-worker (60-150s),
 * disparada por el Database Webhook de Supabase.
 *
 * ACK SIEMPRE: enqueue OK → 200; ya procesado → 200; Supabase falla → aviso
 * best-effort al usuario + 200 (NUNCA fallback síncrono → sin loop 504/retry).
 */

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Envía un mensaje best-effort por Telegram (feedback; no bloquea el ACK). */
async function sendTelegramMessage(update: unknown, text: string): Promise<void> {
  const chatId = (update as { message?: { chat?: { id?: number } } })?.message?.chat?.id;
  if (!chatId) return;
  const env = loadEnv();
  await new Bot(env.TELEGRAM_BOT_TOKEN).api.sendMessage(chatId, text);
}

export default async function webhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let update: unknown = null;
  try {
    const body = await readBody(req);
    update = JSON.parse(body || '{}');
  } catch {
    res.statusCode = 200;
    res.end('ok');
    return;
  }

  // Cola liviana: solo MemoryStore (sin inicializar LLM/vision/etc. en el ACK).
  const store = new MemoryStore(null);

  await webhookAck(update, store, {
    sendAnalyzing: (u) => sendTelegramMessage(u, '⏳ Analizando…'),
    notifyEnqueueFailed: (u) =>
      sendTelegramMessage(u, '⚠️ No pude registrar tu consulta ahora. Reintentá en unos segundos.'),
  });

  // ACK siempre (2xx) — Telegram no reintenta y el worker se encarga del resto.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('ok');
}
