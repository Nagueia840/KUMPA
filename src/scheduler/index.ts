import type { Bot } from 'grammy';
import type { Deps } from '../deps.js';
import { buildAggregatedScan } from '../data/snapshot.js';
import { checkAlert } from '../agents/alerts.js';

/**
 * Loop de alertas en proceso (sin Redis). Revisa las alertas activas cada
 * `intervalMs` y notifica al usuario si se cumple alguna condición.
 * En producción se puede reemplazar por BullMQ (Redis) sin tocar la lógica.
 */
export function startAlertLoop(
  deps: Deps,
  bot: Bot,
  intervalMs = 5 * 60 * 1000,
): ReturnType<typeof setInterval> {
  console.info(`[scheduler] Loop de alertas cada ${Math.round(intervalMs / 1000)}s`);

  const timer = setInterval(async () => {
    try {
      const alerts = await deps.memory.getActiveAlerts();
      if (alerts.length === 0) return;

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
          }
        } catch (err) {
          console.warn(
            `[scheduler] alerta ${alert.symbol} falló:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } catch (err) {
      console.error('[scheduler] error en alert loop:', err instanceof Error ? err.message : err);
    }
  }, intervalMs);

  return timer;
}
