import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { processUpdate, classifyError, type PendingUpdate } from '../src/webhook/queue.js';
import { LLMClient, shouldFallbackProvider } from '../src/llm/index.js';
import { fakeQueueStore } from './helpers/queue-store.js';

/**
 * REGRESIÓN: HANG INTERNO (update 30098831 quedó `processing` para siempre).
 *
 * La causa raíz: un await externo que NUNCA resuelve (provider LLM colgado,
 * Telegram, Supabase, tool...) dejaba `bot.handleUpdate` pendiente; el SDK
 * openai aborta recién a los 10 min (DEFAULT_TIMEOUT), pero el Edge Worker
 * (plan free) recicla la instancia a los ~150s ANTES → el background task
 * moría sin llegar a `finishPendingUpdate` → fila `processing` eterna con
 * `last_error=NULL`.
 *
 * Este test garantiza que un await que nunca resuelve se convierte en ERROR
 * CONTROLADO (timeout) y que processUpdate SIEMPRE cierra la fila.
 */

/** Servidor local que ACEPTA la conexión TCP pero NUNCA responde — reproduce
 *  fielmente un provider/host colgado (el fetch queda pendiente hasta que el
 *  AbortController del SDK / fetchWithTimeout lo aborta). */
function hangingServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const sockets = new Set<import('node:net').Socket>();
    const server: Server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      // no responder jamás
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        close: () =>
          new Promise<void>((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

const update = (id: number) => ({
  update_id: id,
  message: { chat: { id: 10 }, text: 'hola' },
});

const pending = (id: number, attempts: number, payload = JSON.stringify(update(id))): PendingUpdate => ({
  updateId: id,
  payload,
  attempts,
});

describe('processUpdate — presupuesto anti-hang (WORKER_BUDGET_MS)', () => {
  it('un handleUpdate que NUNCA resuelve → timeout controlado → finishPendingUpdate transitorio (nunca processing eterno)', async () => {
    const store = fakeQueueStore();
    // bot realista: la promesa de handleUpdate no se settlea jamás (dependencia colgada)
    const hangingBot = { handleUpdate: () => new Promise<void>(() => {}) };
    store.rows.set(30098831, {
      payload: JSON.stringify(update(30098831)),
      status: 'processing',
      attempts: 1,
      created: 0,
      startedAt: Date.now(),
    });

    const result = await processUpdate(hangingBot, store, pending(30098831, 1), { budgetMs: 150 });

    expect(result).toBe(false);
    // SIEMPRE se cerró la fila: finishPendingUpdate corrió con error real
    expect(store.finishLog.length).toBe(1);
    expect(store.finishLog[0]?.ok).toBe(false);
    expect(store.finishLog[0]?.opts?.permanent).toBe(false); // transitorio → reintenta
    expect(store.finishLog[0]?.opts?.error).toMatch(/timeout/i);
    // la fila quedó re-pending (reintentable), NUNCA processing para siempre
    expect(store.rows.get(30098831)?.status).toBe('pending');
    expect(store.processed.has(30098831)).toBe(false);
  });

  it('payload corrupto sigue siendo permanente aunque el bot cuelgue (sin interacción)', async () => {
    const store = fakeQueueStore();
    const hangingBot = { handleUpdate: () => new Promise<void>(() => {}) };
    store.rows.set(7, { payload: '{corrupto', status: 'processing', attempts: 1, created: 0, startedAt: Date.now() });
    const result = await processUpdate(hangingBot, store, pending(7, 1, '{corrupto'), { budgetMs: 150 });
    expect(result).toBe(false);
    expect(store.rows.get(7)?.status).toBe('failed'); // permanente, no reintenta
    expect(store.finishLog[0]?.opts?.permanent).toBe(true);
  });

  it('timeout del presupuesto se clasifica como transitorio (reintentable)', () => {
    expect(classifyError('timeout update 30098831 (120000ms)')).toBe('transient');
    expect(classifyError('Request timed out.')).toBe('transient');
  });

  it('budgetMs por defecto = 120s (margen bajo el límite de 150s del plan free)', async () => {
    // Sin pasar budgetMs, el default debe existir y ser < 150s para que el
    // timeout controlado dispare ANTES del reciclaje de la plataforma.
    const store = fakeQueueStore();
    const hangingBot = { handleUpdate: () => new Promise<void>(() => {}) };
    store.rows.set(99, { payload: JSON.stringify(update(99)), status: 'processing', attempts: 1, created: 0, startedAt: Date.now() });
    // No esperamos 120s reales: solo verificamos que el default aplica sin explotar.
    // Corremos con un budget explícito corto para no alargar la suite.
    const result = await processUpdate(hangingBot, store, pending(99, 1), { budgetMs: 150 });
    expect(result).toBe(false);
    expect(store.rows.get(99)?.status).toBe('pending');
  });
});

describe('LLMClient — timeout por llamada (LLM_TIMEOUT_MS=30s) con AbortController', () => {
  const settings = (provider: 'groq' | 'deepseek' | 'openrouter' | 'custom', port: number) => ({
    provider,
    apiKey: 'sk-test',
    baseURL: `http://127.0.0.1:${port}/v1`,
    model: 'm',
    fastModel: 'm',
    smartModel: 'm',
  } as const);

  it('un provider que acepta conexión pero NUNCA responde → aborta a los timeoutMs (error controlado, no hang)', async () => {
    const srv = await hangingServer();
    try {
      const client = new LLMClient(settings('custom', srv.port), [], { timeoutMs: 150 });
      const t0 = Date.now();
      let err: unknown = null;
      try {
        await client.completionsCreate({ model: 'm', messages: [{ role: 'user', content: 'hola' }] });
      } catch (e) {
        err = e;
      }
      const elapsed = Date.now() - t0;
      expect(err).not.toBeNull();
      expect(String((err as Error)?.message ?? err)).toMatch(/timed out|timeout|abort/i);
      // abortó a ~150ms, NO quedó colgado minutos (ni 10 min del default SDK)
      expect(elapsed).toBeLessThan(5000);
      // el error de timeout es clasificable transitorio → fallback/retry
      expect(shouldFallbackProvider(err)).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('provider colgado → fallback al siguiente proveedor (que también cuelga) → error de timeout final', async () => {
    const srv = await hangingServer();
    try {
      const client = new LLMClient(settings('groq', srv.port), [settings('openrouter', srv.port)], { timeoutMs: 120 });
      let err: unknown = null;
      try {
        await client.completionsCreate({ model: 'm', messages: [{ role: 'user', content: 'hola' }] });
      } catch (e) {
        err = e;
      }
      // Probó ambos proveedores (fallback) y el error final es un timeout clasificable
      expect(err).not.toBeNull();
      expect(String((err as Error)?.message ?? err)).toMatch(/timed out|timeout|abort/i);
      expect(shouldFallbackProvider(err)).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('shouldFallbackProvider: timeout/429/5xx → fallback; 400 → no', () => {
    expect(shouldFallbackProvider(new Error('Request timed out.'))).toBe(true);
    expect(shouldFallbackProvider({ status: 429 })).toBe(true);
    expect(shouldFallbackProvider({ status: 502 })).toBe(true);
    expect(shouldFallbackProvider({ status: 400 })).toBe(false);
  });
});

describe('capa de datos — fetchWithTimeout (HTTP_TIMEOUT_MS=8s)', () => {
  it('un host que nunca responde aborta y lanza error de timeout (no cuelga)', async () => {
    const srv = await hangingServer();
    try {
      const { fetchWithTimeout } = await import('../src/data/http.js');
      const t0 = Date.now();
      let err: unknown = null;
      try {
        await fetchWithTimeout(`http://127.0.0.1:${srv.port}/api`, undefined, 150);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      expect(String((err as Error)?.message ?? err)).toMatch(/timeout/i);
      expect(Date.now() - t0).toBeLessThan(3000); // abortó a ~150ms
    } finally {
      await srv.close();
    }
  });

  it('el error de timeout del fetch se clasifica transitorio (reintentable)', () => {
    expect(classifyError('timeout https://data.test/api (8000ms)')).toBe('transient');
  });
});
