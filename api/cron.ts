import type { IncomingMessage, ServerResponse } from 'node:http';
import { getBot, getDeps } from '../src/singleton.js';
import { runAlertCheck } from '../src/scheduler/index.js';

// Cron de Vercel / cron externo.
// SOLO: (1) alertas existentes; (2) safety-net de jobs colgados/fallidos.
// PROHIBIDO: bot.handleUpdate / análisis de inbox / esperar LLM.
export const config = { maxDuration: 10 };

export default async function cron(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [deps, bot] = await Promise.all([getDeps(), getBot()]);

  // 1) Safety-net: jobs en 'processing' colgados (processing_started_at viejo)
  //    → re-pending (attempts < 3) o failed. Operación trivial, <1s.
  let recovered = 0;
  try {
    recovered = await deps.memory.recoverStuckProcessing(10 * 60_000, 3);
  } catch (err) {
    console.warn('[cron] recoverStuckProcessing:', err instanceof Error ? err.message : err);
  }

  // 2) Alertas de precio/funding (como siempre).
  let triggered = 0;
  try {
    triggered = await runAlertCheck(deps, bot);
  } catch (err) {
    console.warn('[cron] runAlertCheck:', err instanceof Error ? err.message : err);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, recovered, triggered }));
}
