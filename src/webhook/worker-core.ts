import type { Bot } from 'grammy';
import { processUpdate, type UpdateQueueStore } from './queue.js';

/**
 * NÚCLEO DEL EDGE WORKER (runtime-agnóstico — corre en Deno y es testeable en Node).
 * Procesa EXACTAMENTE un update por invocación:
 * 1. idempotencia: processed_updates → 'ignored';
 * 2. claim atómico pending→processing (con update_id);
 * 3. boot de dependencias (bot A–E);
 * 4. bot.handleUpdate → reply Telegram;
 * 5. marcar processed / re-pending / failed.
 */

export interface WorkerDeps {
  store: UpdateQueueStore;
  /** Inicializa el bot (deps A–E). Puede fallar por config crítica → permanente. */
  boot: () => Promise<Pick<Bot, 'handleUpdate'>>;
}

export type WorkerResult =
  | 'processed' // análisis completo + reply + marcado
  | 'claimed' // (reservado) claim sin resultado
  | 'ignored' // ya procesado / ya claimado / no existe
  | 'failed' // transitorio (re-pending o failed por attempts)
  | 'permanent_failed'; // config crítica / payload imposible

export async function processOneUpdate(
  deps: WorkerDeps,
  updateId: number,
): Promise<WorkerResult> {
  if (await deps.store.isUpdateProcessed(updateId)) return 'ignored';

  const pending = await deps.store.claimPendingUpdate(updateId);
  if (!pending) return 'ignored'; // ya lo tomó otro worker o no está pendiente

  let bot;
  try {
    bot = await deps.boot();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[worker] boot falló para update ${updateId} (permanente): ${msg}`);
    await deps.store.finishPendingUpdate(updateId, false, { error: msg, permanent: true });
    return 'permanent_failed';
  }

  const ok = await processUpdate(bot, deps.store, pending);
  return ok ? 'processed' : 'failed';
}
