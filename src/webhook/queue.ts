import type { Bot } from 'grammy';
import { withTimeout } from '../agents/fetch-multitf.js';

/**
 * COLA DE UPDATES DE TELEGRAM — arquitectura asíncrona definitiva.
 *
 * Telegram → Vercel /api/webhook (ACK <1s, SOLO encola)
 *          → Supabase update_inbox
 *          → Database Webhook → Edge Function kumpa-worker
 *          → bot.handleUpdate (motor A–E, presupuesto 60-150s)
 *          → Telegram reply → processed_updates
 *
 * El webhook NUNCA ejecuta análisis. Si el enqueue falla → HTTP 200 igual y un
 * aviso best-effort al usuario (no loop 504/retry). El worker procesa UN update
 * por invocación. /api/cron solo hace safety-net + alertas.
 *
 * Idempotencia: update_id es autoridad (PK update_inbox + processed_updates).
 *
 * ANTI-HANG (fix diagnóstico interno): `processUpdate` corre bajo un presupuesto
 * global (WORKER_BUDGET_MS, default 120s < 150s del límite free de la plataforma).
 * Si CUALQUIER await interno cuelga (LLM, Telegram, Supabase, tools...), el
 * presupuesto lo convierte en error controlado → finishPendingUpdate retry/fail.
 * Sin esto, un hang dejaba la fila `processing` para siempre: el reciclaje de la
 * instancia mataba el background task ANTES de que el timeout del SDK openai
 * (default 10 min) pudiera abortar.
 */

export const MAX_ATTEMPTS = 3;

/** Presupuesto total por update: margen bajo el límite de wall-clock del plan
 *  free (150s). Un update que excede esto se marca transitorio y reintenta. */
export const WORKER_BUDGET_MS = 120_000;

export interface PendingUpdate {
  updateId: number;
  payload: string; // JSON del update de Telegram
  attempts: number;
}

/** Contrato de persistencia (MemoryStore; inyectable en tests). */
export interface UpdateQueueStore {
  /**
   * Inserta el update como pendiente. El PK (update_id) es el árbitro:
   * 'inserted' → fila nueva; 'duplicate' → ya existe en update_inbox (23505);
   * 'failed' → error real de almacenamiento.
   */
  savePendingUpdate(updateId: number, payload: unknown): Promise<'inserted' | 'duplicate' | 'failed'>;
  /** Claim atómico pending→processing; con updateId reclama ESE update. */
  claimPendingUpdate(updateId?: number): Promise<PendingUpdate | null>;
  /** ok → processed+borra; fallo transitorio → re-pending/failed; permanente → failed. */
  finishPendingUpdate(updateId: number, ok: boolean, opts?: { error?: string; permanent?: boolean }): Promise<void>;
  isUpdateProcessed(updateId: number): Promise<boolean>;
  /** Safety-net: processing colgado → pending/failed. NO análisis. */
  recoverStuckProcessing(maxAgeMs?: number, maxAttempts?: number): Promise<number>;
}

/** Clasifica un error: transitorio (reintentable) vs permanente (no reintentar). */
export function classifyError(msg: string): 'transient' | 'permanent' {
  const m = msg.toLowerCase();
  // "timed out" es el mensaje exacto de APIConnectionTimeoutError (SDK openai):
  // un LLM colgado que aborta por nuestro timeout DEBE ser transitorio.
  if (/rate limit|quota|tokens per|429|timed out|timeout|fetch failed|econnrefused|etimedout|429 too many|tool call validation|spawn eperm/i.test(m)) {
    return 'transient';
  }
  if (/invalid update|payload|formato|api key|credential|missing.*(key|config)|configuration/i.test(m)) {
    return 'permanent';
  }
  return 'transient'; // por defecto reintentable (seguro); tope por attempts
}

/**
 * Encola un update con idempotencia estricta.
 * - 'inserted': update NUEVO (fila creada en update_inbox).
 * - 'duplicate': ya procesado (processed_updates) O ya en update_inbox — sin
 *   re-insertar, sin feedback.
 * - 'failed': error real de almacenamiento.
 */
export type EnqueueResult = 'inserted' | 'duplicate' | 'failed';

export async function enqueueUpdate(
  store: UpdateQueueStore,
  update: unknown,
): Promise<EnqueueResult> {
  const updateId = Number((update as { update_id?: number })?.update_id);
  if (!Number.isFinite(updateId)) return 'failed';
  // FUENTE 1 de duplicados: processed_updates (respuesta ya emitida).
  if (await store.isUpdateProcessed(updateId)) return 'duplicate';
  // FUENTE 2 de duplicados: update_inbox (el PK decide atómicamente en el INSERT).
  return store.savePendingUpdate(updateId, update);
}

/**
 * Procesa un update pendiente (usado por el Edge worker).
 * - payload corrupto → fallo PERMANENTE (no reintentar).
 * - handleUpdate OK → processed.
 * - handleUpdate falla → finishPendingUpdate(false) con clasificación.
 * IMPORTANTE (send failure): si Telegram recibió la respuesta pero el request
 * del worker falló después, el update NO se marca processed → retry → riesgo
 * inevitable de duplicado. Mitigación: preferir duplicado sobre pérdida.
 *
 * ANTI-HANG: `handleUpdate` corre bajo WORKER_BUDGET_MS. Un await colgado
 * (provider LLM sin responder, Telegram, Supabase, tool externa) NO puede dejar
 * la fila `processing` para siempre: el presupuesto lo convierte en error
 * transitorio y `finishPendingUpdate` reintenta/falla con `last_error` real.
 */
export async function processUpdate(
  bot: Pick<Bot, 'handleUpdate'>,
  store: UpdateQueueStore,
  pending: PendingUpdate,
  opts: { budgetMs?: number } = {},
): Promise<boolean> {
  const budgetMs = opts.budgetMs ?? WORKER_BUDGET_MS;
  let update: unknown;
  try {
    update = JSON.parse(pending.payload);
  } catch {
    await store.finishPendingUpdate(pending.updateId, false, {
      error: 'payload corrupto (JSON inválido)',
      permanent: true,
    });
    return false;
  }
  try {
    console.log(`[worker-stage] update=${pending.updateId} stage=handle_start`);
    const t0 = Date.now();
    // Presupuesto global: SIEMPRE hay un límite, aunque un await interno cuelgue.
    await withTimeout(bot.handleUpdate(update as never), budgetMs, `update ${pending.updateId}`);
    console.log(`[worker-stage] update=${pending.updateId} stage=handle_done ms=${Date.now() - t0}`);
    await store.finishPendingUpdate(pending.updateId, true);
    console.log(`[worker-stage] update=${pending.updateId} stage=finish_ok`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind = classifyError(msg);
    console.warn(`[queue] update ${pending.updateId} falló (intento ${pending.attempts}, ${kind}): ${msg}`);
    console.log(`[worker-stage] update=${pending.updateId} stage=finish_fail kind=${kind}`);
    await store.finishPendingUpdate(pending.updateId, false, { error: msg, permanent: kind === 'permanent' });
    return false;
  }
}

/**
 * Lógica del webhook Vercel (ACK SIEMPRE, sin trabajo pesado).
 * - sin update_id → 'ignored' (aun así el endpoint responde 200).
 * - enqueue OK → 'enqueued' (+ "Analizando…" best-effort, SOLO si fue aceptado).
 * - update ya procesado → 'duplicate' (200 silencioso).
 * - enqueue falla → 'enqueue_failed' + aviso best-effort al usuario; NUNCA
 *   procesamiento síncrono.
 */
export type WebhookAckResult = 'enqueued' | 'duplicate' | 'enqueue_failed' | 'ignored';

export interface WebhookHelpers {
  /** Feedback "Analizando…" (best-effort; no debe abortar el enqueue). */
  sendAnalyzing?: (update: unknown) => Promise<void>;
  /** Aviso de que no se pudo encolar (best-effort). */
  notifyEnqueueFailed?: (update: unknown) => Promise<void>;
}

export async function webhookAck(
  update: unknown,
  store: UpdateQueueStore,
  helpers: WebhookHelpers = {},
): Promise<WebhookAckResult> {
  const updateId = Number((update as { update_id?: number })?.update_id);
  if (!Number.isFinite(updateId)) return 'ignored';

  const result = await enqueueUpdate(store, update);
  if (result === 'inserted') {
    // "Analizando…" únicamente cuando el update fue ACEPTADO para procesamiento.
    if (helpers.sendAnalyzing) {
      try {
        await helpers.sendAnalyzing(update);
      } catch {
        // el feedback no es requisito para procesar
      }
    }
    return 'enqueued';
  }
  if (result === 'duplicate') {
    // Ya procesado o ya encolado: 200 silencioso, sin feedback duplicado.
    return 'duplicate';
  }
  // 'failed': error real de almacenamiento → aviso best-effort + ACK (sin fallback síncrono).
  if (helpers.notifyEnqueueFailed) {
    try {
      await helpers.notifyEnqueueFailed(update);
    } catch {
      // el aviso es best-effort
    }
  }
  return 'enqueue_failed';
}
