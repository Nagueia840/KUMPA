import { describe, it, expect } from 'vitest';
import {
  MAX_ATTEMPTS,
  classifyError,
  enqueueUpdate,
  processUpdate,
  webhookAck,
  type PendingUpdate,
  type UpdateQueueStore,
} from '../src/webhook/queue.js';
import { fakeQueueStore } from './helpers/queue-store.js';

const fakeStore = fakeQueueStore;

const update = (id: number, kind = 'text') => ({
  update_id: id,
  message: kind === 'voice' ? { chat: { id: 10 }, voice: { file_id: 'v1' } } : kind === 'photo' ? { chat: { id: 10 }, photo: [{ file_id: 'p1' }] } : { chat: { id: 10 }, text: 'hola' },
});

describe('webhookAck — ACK SIEMPRE, sin trabajo pesado', () => {
  it('1/2) enqueue OK → enqueued; "Analizando…" solo tras aceptar; NUNCA procesamiento síncrono', async () => {
    const store = fakeStore();
    let analyzing = 0;
    let notify = 0;
    const result = await webhookAck(update(1), store, {
      sendAnalyzing: async () => { analyzing++; },
      notifyEnqueueFailed: async () => { notify++; },
    });
    expect(result).toBe('enqueued');
    expect(analyzing).toBe(1); // feedback tras aceptar
    expect(notify).toBe(0);
    expect(store.rows.size).toBe(1);
    expect(store.finishLog.length).toBe(0); // NO hubo handleUpdate (nada que cerrar)
  });

  it('5/B) mismo update_id dos veces → segunda duplicate, sin "Analizando…" duplicado', async () => {
    const store = fakeStore();
    let analyzing = 0;
    const r1 = await webhookAck(update(42), store, { sendAnalyzing: async () => { analyzing++; } });
    const r2 = await webhookAck(update(42), store, { sendAnalyzing: async () => { analyzing++; } });
    expect(r1).toBe('enqueued');
    expect(r2).toBe('duplicate');
    expect(analyzing).toBe(1); // feedback una sola vez
    expect(store.rows.size).toBe(1);
  });

  it('4) enqueue failure → enqueue_failed + aviso al usuario + ACK (sin fallback síncrono)', async () => {
    const dead: UpdateQueueStore = {
      savePendingUpdate: async () => 'failed', // Supabase caído / error real
      claimPendingUpdate: async () => null,
      finishPendingUpdate: async () => {},
      isUpdateProcessed: async () => false,
      recoverStuckProcessing: async () => 0,
    };
    let notify = 0;
    let analyzing = 0;
    const result = await webhookAck(update(9), dead, {
      sendAnalyzing: async () => { analyzing++; },
      notifyEnqueueFailed: async () => { notify++; },
    });
    expect(result).toBe('enqueue_failed');
    expect(notify).toBe(1); // el usuario se entera
    expect(analyzing).toBe(0); // no se promete análisis que no arrancó
  });

  it('update ya procesado → duplicate (200 silencioso, sin feedback duplicado)', async () => {
    const store = fakeStore();
    await enqueueUpdate(store, update(7));
    await store.claimPendingUpdate(7);
    await store.finishPendingUpdate(7, true);
    let analyzing = 0;
    const result = await webhookAck(update(7), store, { sendAnalyzing: async () => { analyzing++; } });
    expect(result).toBe('duplicate');
    expect(analyzing).toBe(0);
    expect(store.rows.size).toBe(0);
  });

  it('sin update_id → ignored (el endpoint aún responde 200)', async () => {
    expect(await webhookAck({ foo: 1 }, fakeStore(), {})).toBe('ignored');
  });
});

describe('enqueueUpdate — idempotencia estricta', () => {
  it('A) update nuevo → inserted', async () => {
    const store = fakeStore();
    expect(await enqueueUpdate(store, update(1))).toBe('inserted');
    expect(store.rows.size).toBe(1);
  });

  it('B) mismo update_id dos veces → segunda duplicate, 1 fila', async () => {
    const store = fakeStore();
    expect(await enqueueUpdate(store, update(1))).toBe('inserted');
    expect(await enqueueUpdate(store, update(1))).toBe('duplicate');
    expect(store.rows.size).toBe(1);
  });

  it('C) ya procesado (processed_updates) → duplicate y no reencola', async () => {
    const store = fakeStore();
    await enqueueUpdate(store, update(3));
    await store.claimPendingUpdate(3);
    await store.finishPendingUpdate(3, true);
    expect(await enqueueUpdate(store, update(3))).toBe('duplicate');
    expect(store.rows.size).toBe(0);
  });

  it('sin update_id → failed (el webhook lo filtra antes como ignored)', async () => {
    expect(await enqueueUpdate(fakeStore(), { foo: 1 })).toBe('failed');
  });
});

describe('classifyError — transitorio vs permanente', () => {
  it('transitorios: rate limit, timeout, fetch failed, tool validation', () => {
    expect(classifyError('429 Rate limit reached for model')).toBe('transient');
    expect(classifyError('timeout BTCUSDT 1H (3000ms)')).toBe('transient');
    expect(classifyError('fetch failed')).toBe('transient');
    expect(classifyError('Tool call validation failed: missing query')).toBe('transient');
  });
  it('permanentes: config/API key/payload', () => {
    expect(classifyError('missing LLM_API_KEY')).toBe('permanent');
    expect(classifyError('invalid update format')).toBe('permanent');
  });
});

describe('processUpdate — cierre de estados', () => {
  const botOk = { handleUpdate: async () => {} };
  const botFail = { handleUpdate: async () => { throw new Error('429 Rate limit'); } };
  const pending = (id: number, attempts: number, payload = JSON.stringify(update(id))): PendingUpdate => ({ updateId: id, payload, attempts });

  it('ok → processed', async () => {
    const store = fakeStore();
    await enqueueUpdate(store, update(5));
    const p = await store.claimPendingUpdate(5);
    expect(await processUpdate(botOk, store, p!)).toBe(true);
    expect(store.processed.has(5)).toBe(true);
    expect(store.rows.size).toBe(0);
  });

  it('13/14) payload de voz y foto se conserva', async () => {
    const store = fakeStore();
    await enqueueUpdate(store, update(6, 'voice'));
    await enqueueUpdate(store, update(7, 'photo'));
    const pv = await store.claimPendingUpdate(6);
    const pp = await store.claimPendingUpdate(7);
    expect(JSON.parse(pv!.payload).message.voice).toBeDefined();
    expect(JSON.parse(pp!.payload).message.photo).toBeDefined();
  });

  it('9/10) error transitorio → re-pending; tras MAX_ATTEMPTS → failed', async () => {
    const store = fakeStore();
    await enqueueUpdate(store, update(8));
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const p = await store.claimPendingUpdate(8);
      await processUpdate(botFail, store, p!);
    }
    expect(store.rows.get(8)?.status).toBe('failed');
    expect((await store.claimPendingUpdate(8))).toBeNull(); // sin loop
  });

  it('11) payload corrupto → fallo PERMANENTE inmediato (sin reintento)', async () => {
    const store = fakeStore();
    // Estado post-claim real: la fila existe en 'processing'.
    store.rows.set(9, { payload: '{corrupto', status: 'processing', attempts: 1, created: 0, startedAt: Date.now() });
    const p = pending(9, 1, '{corrupto');
    const result = await processUpdate(botOk, store, p);
    expect(result).toBe(false);
    expect(store.rows.get(9)?.status).toBe('failed');
    expect(store.finishLog[0]?.opts?.permanent).toBe(true);
  });

  it('error permanente → failed inmediato', async () => {
    const store = fakeStore();
    const p = pending(10, 1);
    store.rows.set(10, { payload: p.payload, status: 'pending', attempts: 1, created: 0, startedAt: null });
    const bot = { handleUpdate: async () => { throw new Error('missing API key'); } };
    await processUpdate(bot, store, p);
    expect(store.rows.get(10)?.status).toBe('failed');
  });
});
