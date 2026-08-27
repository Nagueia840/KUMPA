import type { Bot } from 'grammy';
import type { UpdateQueueStore } from './queue.js';
import { processOneUpdate, type WorkerResult } from './worker-core.js';

/**
 * LÓGICA DE DISPATCH DEL EDGE WORKER (runtime-agnóstico — testeable en Node).
 *
 * Separa el contrato HTTP (Deno.serve / EdgeRuntime) de la lógica pura:
 * - el entrypoint de Supabase valida auth y parsea el payload;
 * - esta función decide el resultado HTTP y registra el background task.
 *
 * El patrón background (EdgeRuntime.waitUntil) no bloquea la request:
 * la respuesta HTTP solo indica que el trabajo fue ACEPTADO; la verdad final
 * queda en update_inbox / processed_updates / last_error / status.
 *
 * `waitUntil` se inyecta para poder mockearlo en tests (en Deno es
 * EdgeRuntime.waitUntil; en Node se simula capturando la promise).
 */

export interface WorkerDispatchResult {
  status: number;
  body: Record<string, unknown>;
}

export interface WorkerDispatchDeps {
  store: UpdateQueueStore;
  /** Inicializa el bot (motor A–E). */
  boot: () => Promise<Pick<Bot, 'handleUpdate'>>;
  /** Registra el background task sin bloquear (EdgeRuntime.waitUntil). */
  waitUntil: (promise: Promise<unknown>) => void;
}

/** Decide la respuesta HTTP y registra el background task para un update_id. */
export function dispatchWorkerUpdate(
  deps: WorkerDispatchDeps,
  updateId: number,
): WorkerDispatchResult {
  // Background task: procesa EXACTAMENTE un update SIN bloquear la request.
  // Sin await: la instancia continúa hasta que la promise completa.
  // try/catch evita unhandled rejection; processOneUpdate ya persiste
  // processed/failed/retry vía la store (no duplicamos lógica).
  const task = processOneUpdate({ store: deps.store, boot: deps.boot }, updateId).catch(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[worker] background task falló para update ${updateId}: ${msg}`);
    },
  );

  deps.waitUntil(task);

  // Respuesta inmediata: el trabajo fue ACEPTADO (no el resultado final).
  return { status: 200, body: { ok: true, updateId, accepted: true } };
}

export type { WorkerResult };
