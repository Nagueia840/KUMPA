import type { Bot } from 'grammy';
import type { Deps } from '../deps.js';
import { buildAggregatedScan } from '../data/snapshot.js';
import { checkAlert } from '../agents/alerts.js';

/**
 * Chequea todas las alertas activas contra datos en vivo y notifica.
 * Reutilizable tanto por el loop en proceso como por un cron serverless.
 * Devuelve cuántas alertas se dispararon.
 */
export async function runAlertCheck(deps: Deps, bot: Bot): Promise<number> {
  let triggered = 0;
  try {
    const alerts = await deps.memory.getActiveAlerts();
    if (alerts.length === 0) return 0;

    for (const alert of alerts) {
      try {
        const scan = await buildAggregatedScan(alert.symbol, deps);
        const result = checkAlert(alert, scan);
        if (result.triggered) {
          await bot.api.sendMessage(
            alert.chatId,
            result.message ?? `🔔 Alerta <b>${alert.symbol}</b>`,
            { parse_mode: 'HTML' },
          );
          await deps.memory.markAlertTriggered(alert.id);
          triggered++;
        }
      } catch (err) {
        console.warn(
          `[scheduler] alerta ${alert.symbol} falló:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (err) {
    console.error('[scheduler] error en alert check:', err instanceof Error ? err.message : err);
  }
  return triggered;
}

/** Loop de alertas en proceso (desarrollo/local). En serverless usá el cron. */
export function startAlertLoop(
  deps: Deps,
  bot: Bot,
  intervalMs = 5 * 60 * 1000,
): ReturnType<typeof setInterval> {
  console.info(`[scheduler] Loop de alertas cada ${Math.round(intervalMs / 1000)}s`);
  return setInterval(() => {
    void runAlertCheck(deps, bot);
  }, intervalMs);
}
