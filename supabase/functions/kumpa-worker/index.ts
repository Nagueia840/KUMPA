import { MemoryStore } from '../../../src/memory/store.js';
import { getBot } from '../../../src/singleton.js';
import { parseDbWebhookUpdateId } from '../../../src/webhook/db-webhook.js';
import { dispatchWorkerUpdate } from '../../../src/webhook/worker-handler.js';

/**
 * KUMPA WORKER — Supabase Edge Function (Deno).
 *
 * Disparada por el Database Webhook de Supabase (evento INSERT en update_inbox)
 * o por una invocación manual. Procesa EXACTAMENTE UN update por invocación:
 *
 *   request (payload del Database Webhook)
 *   → validar payload → update_id
 *   → idempotencia (processed_updates)
 *   → claim atómico pending→processing
 *   → boot del bot (motor A–E) → bot.handleUpdate
 *   → reply Telegram → marcar processed
 *
 * PATRÓN BACKGROUND (EdgeRuntime.waitUntil):
 *   La request NO espera el análisis completo: registra el trabajo como
 *   background task y responde HTTP 200 INMEDIATAMENTE. La instancia sigue
 *   viva hasta que processOneUpdate complete (doc oficial Supabase:
 *   /docs/guides/functions/background-tasks). Esto evita que pg_net corte
 *   la conexión por timeout (la request termina en milisegundos, no en
 *   los 10s del trigger).
 *
 *   La verdad final NO está en la respuesta HTTP (que solo dice "aceptado"):
 *   está en update_inbox / processed_updates / last_error / status.
 *
 * Autenticación: header `Authorization: Bearer <KUMPA_WORKER_SECRET>` (secret de
 * Edge Functions). Si el secret no está configurado, la función rechaza 401
 * (fail-closed) — el Database Webhook debe enviar ese header.
 */

const JSON_HEADERS = { 'content-type': 'application/json' };

Deno.serve(async (req: Request): Promise<Response> => {
  // 1) Autenticación fail-closed entre Database Webhook y Edge Function.
  const secret = Deno.env.get('KUMPA_WORKER_SECRET');
  if (!secret) {
    return new Response(JSON.stringify({ error: 'worker secret no configurado' }), { status: 500, headers: JSON_HEADERS });
  }
  const auth = req.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: JSON_HEADERS });
  }

  // 2) Payload real del Database Webhook (no asumir formato).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: JSON_HEADERS });
  }
  const updateId = parseDbWebhookUpdateId(body);
  if (updateId === null) {
    // Evento no aplicable (otra tabla/tipo) → 200 silencioso.
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200, headers: JSON_HEADERS });
  }

  // 3) Background task: procesa EXACTAMENTE un update SIN bloquear la request.
  //    dispatchWorkerUpdate registra la promise en EdgeRuntime.waitUntil
  //    (doc oficial /docs/guides/functions/background-tasks) y responde
  //    inmediatamente { accepted: true }. La verdad final queda en
  //    update_inbox / processed_updates / last_error / status.
  const store = new MemoryStore(null);
  const dispatch = dispatchWorkerUpdate(
    { store, boot: async () => getBot(), waitUntil: (p) => EdgeRuntime.waitUntil(p) },
    updateId,
  );

  return new Response(JSON.stringify(dispatch.body), { status: dispatch.status, headers: JSON_HEADERS });
});
