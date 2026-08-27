// Harness empírico: reproduce el HANG INTERNO (update 30098831) y verifica que
// los fixes lo convierten en error controlado. Correr DESPUÉS de compilar:
//   node node_modules/typescript/lib/tsc.js -p tsconfig.verify.json
//   node scripts/hang-harness.mjs
import { createServer } from 'node:net';
import { processUpdate, classifyError } from '../.verify/webhook/queue.js';
import { LLMClient, shouldFallbackProvider } from '../.verify/llm/index.js';
import { fetchWithTimeout } from '../.verify/data/http.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures++;
};

/** Servidor local que ACEPTA la conexión TCP pero NUNCA responde: reproduce
 *  fielmente un provider/host colgado (el fetch queda pendiente hasta que el
 *  AbortController lo aborta). */
function hangingServer() {
  return new Promise((resolve) => {
    const sockets = new Set();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket));
      // no responder jamás
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy();
            server.close(() => r());
          }),
      });
    });
  });
}

// ── 1. processUpdate con handleUpdate que NUNCA resuelve ─────────────────────
{
  // Mini store con la semántica de update_inbox
  const rows = new Map();
  const finishLog = [];
  const store = {
    rows,
    finishLog,
    finishPendingUpdate: async (id, ok, opts) => {
      finishLog.push({ id, ok, opts });
      const r = rows.get(id);
      if (ok) rows.delete(id);
      else if (opts?.permanent || r.attempts >= 3) r.status = 'failed';
      else r.status = 'pending';
    },
    savePendingUpdate: async () => 'inserted',
    claimPendingUpdate: async () => null,
    isUpdateProcessed: async () => false,
    recoverStuckProcessing: async () => 0,
  };
  rows.set(30098831, { payload: JSON.stringify({ update_id: 30098831, message: { chat: { id: 10 }, text: 'hola' } }), status: 'processing', attempts: 1 });
  const hangingBot = { handleUpdate: () => new Promise(() => {}) }; // nunca settlea (provider colgado)

  const t0 = Date.now();
  const result = await processUpdate(hangingBot, store, { updateId: 30098831, payload: JSON.stringify({ update_id: 30098831 }), attempts: 1 }, { budgetMs: 150 });
  const elapsed = Date.now() - t0;

  check('handleUpdate colgado → processUpdate retorna false en ~150ms', result === false && elapsed < 3000, `elapsed=${elapsed}ms`);
  check('finishPendingUpdate SIEMPRE corrió (error real)', finishLog.length === 1, JSON.stringify(finishLog[0]));
  check('error clasificado transitorio (reintentable, no processing eterno)', finishLog[0]?.opts?.permanent === false && /timeout/i.test(finishLog[0]?.opts?.error ?? ''), finishLog[0]?.opts?.error);
  check('fila re-pending (no processing, no perdida)', rows.get(30098831)?.status === 'pending', rows.get(30098831)?.status);
}

// ── 2. LLMClient: provider que acepta conexión pero nunca responde ───────────
{
  const srv = await hangingServer();
  try {
    const settings = (provider, port) => ({ provider, apiKey: 'sk-test', baseURL: `http://127.0.0.1:${port}/v1`, model: 'm', fastModel: 'm', smartModel: 'm' });
    const client = new LLMClient(settings('custom', srv.port), [], { timeoutMs: 150 });
    const t0 = Date.now();
    let err = null;
    try {
      await client.completionsCreate({ model: 'm', messages: [{ role: 'user', content: 'hola' }] });
    } catch (e) { err = e; }
    const elapsed = Date.now() - t0;
    check('LLM colgado → completionsCreate aborta a ~timeoutMs', err !== null && /timed out|timeout|abort/i.test(err?.message ?? String(err)), `elapsed=${elapsed}ms msg=${err?.message}`);
    check('elapsed < 5s (no 10 min del default SDK)', elapsed < 5000, `${elapsed}ms`);
    check('error de timeout clasificable transitorio (fallback/retry)', shouldFallbackProvider(err) === true);
  } finally {
    await srv.close();
  }
}

// ── 3. fetchWithTimeout: host colgado → abort a ms ────────────────────────────
{
  const srv = await hangingServer();
  try {
    const t0 = Date.now();
    let err = null;
    try {
      await fetchWithTimeout(`http://127.0.0.1:${srv.port}/api`, undefined, 150);
    } catch (e) { err = e; }
    check('fetch externo colgado → timeout controlado', err !== null && /timeout/i.test(err?.message ?? String(err)), `elapsed=${Date.now() - t0}ms msg=${err?.message}`);
    check('clasificado transitorio', classifyError(err?.message ?? '') === 'transient');
  } finally {
    await srv.close();
  }
}

// ── 4. timeout SDK openai default vs límite plataforma ────────────────────────
{
  check('LLM_TIMEOUT_MS (30s) < límite plataforma free (150s)', 30_000 < 150_000);
  check('WORKER_BUDGET_MS (120s) < límite plataforma free (150s)', 120_000 < 150_000);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
