import { describe, it, expect } from 'vitest';
import { dispatchWorkerUpdate } from '../src/webhook/worker-handler.js';
import { parseDbWebhookUpdateId } from '../src/webhook/db-webhook.js';
import { processOneUpdate } from '../src/webhook/worker-core.js';
import { MAX_ATTEMPTS } from '../src/webhook/queue.js';
import { fakeQueueStore } from './helpers/queue-store.js';

/**
 * Regresión del patrón BACKGROUND del Edge Worker:
 *   HTTP request → validar auth + parsear update_id → registrar background task
 *   (EdgeRuntime.waitUntil) → RESPONDER 200 INMEDIATAMENTE → background:
 *   processOneUpdate → processed/failed/retry.
 *
 * La respuesta HTTP ya NO representa el resultado final (solo "accepted").
 * La verdad final queda en update_inbox / processed_updates / last_error.
 * dispatchWorkerUpdate es runtime-agnóstico: `waitUntil` se inyecta y en el
 * test captura la promise para simular el avance del background task.
 */

function bootOk() {
  return async () => ({ handleUpdate: async () => {} });
}

describe('dispatchWorkerUpdate — respuesta inmediata + background task', () => {
  it('1/2) devuelve 200 accepted ANTES de que processOneUpdate termine, y la tarea continúa después', async () => {
    const store = fakeQueueStore();
    await store.savePendingUpdate(9300000001, { update_id: 9300000001 });
    let taskDone = false;

    let captured: Promise<unknown> | null = null;
    const waitUntil = (p: Promise<unknown>) => { captured = p; };

    // dispatch es SÍNCRONO: no espera processOneUpdate
    const dispatch = dispatchWorkerUpdate(
      { store, boot: bootOk(), waitUntil },
      9300000001,
    );

    // En el momento de la respuesta, el background aún no terminó
    expect(taskDone).toBe(false);
    expect(dispatch.status).toBe(200);
    expect(dispatch.body).toEqual({ ok: true, updateId: 9300000001, accepted: true });
    expect(captured).not.toBeNull();

    // La tarea fue registrada y continúa en background hasta completar
    await captured;
    taskDone = true;
    expect(store.processed.has(9300000001)).toBe(true); // se procesó en background
  });

  it('3) fixture seguro {"update_id": N} sin message termina processed (0 side effects: solo claim+finish)', async () => {
    const store = fakeQueueStore();
    await store.savePendingUpdate(9300000002, { update_id: 9300000002 });
    let captured: Promise<unknown> | null = null;
    dispatchWorkerUpdate({ store, boot: bootOk(), waitUntil: (p) => { captured = p; } }, 9300000002);
    const result = await captured;
    expect(result).toBe('processed');
    expect(store.processed.has(9300000002)).toBe(true);
    expect(store.rows.size).toBe(0);
  });

  it('4) fallo permanente (boot falla) termina failed', async () => {
    const store = fakeQueueStore();
    await store.savePendingUpdate(9300000003, { update_id: 9300000003 });
    let captured: Promise<unknown> | null = null;
    dispatchWorkerUpdate({
      store,
      boot: async () => { throw new Error('missing LLM_API_KEY'); },
      waitUntil: (p) => { captured = p; },
    }, 9300000003);
    const result = await captured;
    expect(result).toBe('permanent_failed');
    expect(store.rows.get(9300000003)?.status).toBe('failed');
  });

  it('5) fallo transitorio conserva retry (re-pending hasta MAX_ATTEMPTS)', async () => {
    const store = fakeQueueStore();
    await store.savePendingUpdate(9300000004, { update_id: 9300000004 });
    let failMode = true;
    const boot = async () => ({ handleUpdate: async () => { if (failMode) throw new Error('429 rate limit'); } });
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      let captured: Promise<unknown> | null = null;
      dispatchWorkerUpdate({ store, boot, waitUntil: (p) => { captured = p; } }, 9300000004);
      await captured;
    }
    expect(store.rows.get(9300000004)?.status).toBe('failed'); // agotó intentos
    // si reintentáramos con failMode=false, el siguiente dispatch sería ignored (sin loop)
    failMode = false;
    let captured2: Promise<unknown> | null = null;
    dispatchWorkerUpdate({ store, boot, waitUntil: (p) => { captured2 = p; } }, 9300000004);
    expect(await captured2).toBe('ignored');
  });

  it('6) duplicado sigue idempotente (ya procesado → ignored, sin doble procesamiento)', async () => {
    const store = fakeQueueStore();
    await store.savePendingUpdate(9300000005, { update_id: 9300000005 });
    let calls = 0;
    let captured: Promise<unknown> | null = null;
    dispatchWorkerUpdate({
      store,
      boot: async () => ({ handleUpdate: async () => { calls++; } }),
      waitUntil: (p) => { captured = p; },
    }, 9300000005);
    await captured;
    expect(calls).toBe(1);
    // segunda invocación del mismo update → ignored
    let captured2: Promise<unknown> | null = null;
    dispatchWorkerUpdate({
      store,
      boot: async () => ({ handleUpdate: async () => { calls++; } }),
      waitUntil: (p) => { captured2 = p; },
    }, 9300000005);
    const r2 = await captured2;
    expect(r2).toBe('ignored');
    expect(calls).toBe(1); // sin doble procesamiento
  });
});

describe('parseDbWebhookUpdateId — contrato de eventos (sin cambios)', () => {
  it('INSERT update_inbox → update_id', () => {
    expect(parseDbWebhookUpdateId({ type: 'INSERT', table: 'update_inbox', schema: 'public', record: { update_id: 42 }, old_record: null })).toBe(42);
  });
  it('evento inválido (otra tabla/tipo) → null (skipped)', () => {
    expect(parseDbWebhookUpdateId({ type: 'UPDATE', table: 'update_inbox', record: { update_id: 1 } })).toBeNull();
    expect(parseDbWebhookUpdateId({ type: 'INSERT', table: 'alerts', record: {} })).toBeNull();
    expect(parseDbWebhookUpdateId({ type: 'INSERT', table: 'update_inbox' })).toBeNull();
  });
});

describe('processOneUpdate — sin regresión del contrato worker-core', () => {
  it('procesa exactamente un update', async () => {
    const store = fakeQueueStore();
    await store.savePendingUpdate(9400000001, { update_id: 9400000001 });
    let calls = 0;
    const r = await processOneUpdate({ store, boot: async () => ({ handleUpdate: async () => { calls++; } }) }, 9400000001);
    expect(r).toBe('processed');
    expect(calls).toBe(1);
    expect(store.processed.has(9400000001)).toBe(true);
  });
});
