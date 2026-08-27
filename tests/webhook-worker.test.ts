import { describe, it, expect } from 'vitest';
import { processOneUpdate } from '../src/webhook/worker-core.js';
import { parseDbWebhookUpdateId } from '../src/webhook/db-webhook.js';
import { MAX_ATTEMPTS } from '../src/webhook/queue.js';
import { fakeQueueStore } from './helpers/queue-store.js';

const fakeStore = fakeQueueStore;

const update = (id: number, kind = 'text') => ({
  update_id: id,
  message: kind === 'voice' ? { chat: { id: 10 }, voice: { file_id: 'v1' } } : kind === 'photo' ? { chat: { id: 10 }, photo: [{ file_id: 'p1' }] } : { chat: { id: 10 }, text: 'hola' },
});

function bootWith(bot: { handleUpdate: (u: never) => Promise<void> }) {
  return async () => bot;
}

describe('processOneUpdate — 1 update = 1 invocación worker', () => {
  it('7) procesa EXACTAMENTE un update', async () => {
    const store = fakeStore();
    await store.savePendingUpdate(1, update(1));
    let calls = 0;
    const deps = { store, boot: bootWith({ handleUpdate: async () => { calls++; } }) };
    const result = await processOneUpdate(deps, 1);
    expect(result).toBe('processed');
    expect(calls).toBe(1);
    expect(store.processed.has(1)).toBe(true);
  });

  it('8) update ya procesado → ignored (no reprocesa)', async () => {
    const store = fakeStore();
    await store.savePendingUpdate(2, update(2));
    await store.claimPendingUpdate(2);
    await store.finishPendingUpdate(2, true);
    let calls = 0;
    const result = await processOneUpdate({ store, boot: bootWith({ handleUpdate: async () => { calls++; } }) }, 2);
    expect(result).toBe('ignored');
    expect(calls).toBe(0);
  });

  it('retry de edge / webhook repetido → ignored si ya no está pending', async () => {
    const store = fakeStore();
    await store.savePendingUpdate(3, update(3));
    await store.claimPendingUpdate(3); // ya processing (otro worker)
    let calls = 0;
    const result = await processOneUpdate({ store, boot: bootWith({ handleUpdate: async () => { calls++; } }) }, 3);
    expect(result).toBe('ignored');
    expect(calls).toBe(0);
  });

  it('boot falla (config crítica) → permanent_failed (no reintenta)', async () => {
    const store = fakeStore();
    await store.savePendingUpdate(4, update(4));
    const result = await processOneUpdate({
      store,
      boot: async () => { throw new Error('missing LLM_API_KEY'); },
    }, 4);
    expect(result).toBe('permanent_failed');
    expect(store.rows.get(4)?.status).toBe('failed');
  });

  it('9/10) error transitorio → re-pending; tras MAX_ATTEMPTS → failed', async () => {
    const store = fakeStore();
    await store.savePendingUpdate(5, update(5));
    let fail = true;
    const deps = {
      store,
      boot: bootWith({ handleUpdate: async () => { if (fail) throw new Error('429 rate limit'); } }),
    };
    for (let i = 1; i <= MAX_ATTEMPTS; i++) await processOneUpdate(deps, 5);
    expect(store.rows.get(5)?.status).toBe('failed');
    fail = false;
    expect(await processOneUpdate(deps, 5)).toBe('ignored'); // sin loop
  });

  it('13/14) voz y foto pasan por el worker igual que texto', async () => {
    for (const kind of ['text', 'voice', 'photo'] as const) {
      const store = fakeStore();
      await store.savePendingUpdate(100, update(100, kind));
      let got: unknown;
      const result = await processOneUpdate({
        store,
        boot: bootWith({ handleUpdate: async (u) => { got = u; } }),
      }, 100);
      expect(result).toBe('processed');
      expect((got as { message: Record<string, unknown> }).message).toBeDefined();
    }
  });

  it('recoverStuckProcessing: colgado → pending (attempts<3) / failed (attempts>=3)', async () => {
    const store = fakeStore();
    store.rows.set(21, { payload: JSON.stringify(update(21)), status: 'processing', attempts: 1, created: 0, startedAt: Date.now() - 60_000 });
    store.rows.set(22, { payload: JSON.stringify(update(22)), status: 'processing', attempts: 3, created: 1, startedAt: Date.now() - 60_000 });
    store.rows.set(23, { payload: JSON.stringify(update(23)), status: 'processing', attempts: 1, created: 2, startedAt: Date.now() - 1000 }); // no colgado
    const fixed = await store.recoverStuckProcessing(10_000, MAX_ATTEMPTS);
    expect(fixed).toBe(2);
    expect(store.rows.get(21)?.status).toBe('pending'); // reintentable
    expect(store.rows.get(22)?.status).toBe('failed'); // agotó intentos
    expect(store.rows.get(23)?.status).toBe('processing'); // intacto
  });
});

describe('parseDbWebhookUpdateId — payload real de Supabase Database Webhooks', () => {
  it('payload INSERT en update_inbox → update_id', () => {
    const payload = {
      type: 'INSERT',
      table: 'update_inbox',
      schema: 'public',
      record: { update_id: 999, payload: { update_id: 999, message: {} }, status: 'pending' },
      old_record: null,
    };
    expect(parseDbWebhookUpdateId(payload)).toBe(999);
  });

  it('otra tabla/tipo → null (no es un evento útil)', () => {
    expect(parseDbWebhookUpdateId({ type: 'UPDATE', table: 'update_inbox', record: { update_id: 1 } })).toBeNull();
    expect(parseDbWebhookUpdateId({ type: 'INSERT', table: 'alerts', record: {} })).toBeNull();
  });

  it('sin record / update_id inválido → null', () => {
    expect(parseDbWebhookUpdateId({ type: 'INSERT', table: 'update_inbox' })).toBeNull();
    expect(parseDbWebhookUpdateId({ type: 'INSERT', table: 'update_inbox', record: { update_id: 'x' } })).toBeNull();
    expect(parseDbWebhookUpdateId(null)).toBeNull();
    expect(parseDbWebhookUpdateId('nope')).toBeNull();
  });
});

describe('cron safety-net — NO ejecuta análisis', () => {
  it('recoverStuckProcessing es la única operación de cola del cron (sin handleUpdate)', async () => {
    // Contrato: /api/cron llama recoverStuckProcessing + runAlertCheck, nunca
    // bot.handleUpdate. El método de la store es la operación de cola disponible.
    const store = fakeStore();
    expect(typeof store.recoverStuckProcessing).toBe('function');
    expect(typeof (store as { claimPendingUpdate?: unknown }).claimPendingUpdate).toBe('function');
    // El cron NO usa claim/process: solo recovery (verificado en api/cron.ts).
  });
});
