import type { IncomingMessage, ServerResponse } from 'node:http';
import { getBot, getDeps } from '../src/singleton.js';
import { runAlertCheck } from '../src/scheduler/index.js';

// Cron de Vercel: dispara el chequeo de alertas. Schedule: */5 * * * *
export const config = { maxDuration: 60 };

export default async function cron(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const [deps, bot] = await Promise.all([getDeps(), getBot()]);
  const triggered = await runAlertCheck(deps, bot);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, triggered }));
}
