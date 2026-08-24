import { Bot } from 'grammy';
import { loadEnv } from '../config/env.js';
import { setLogLevel } from '../utils/logger.js';
import { loggingMiddleware } from './middlewares/logging.js';
import { rateLimitMiddleware } from './middlewares/rateLimit.js';
import { sessionMiddleware } from './middlewares/session.js';
import { registerStart } from './commands/start.js';
import { registerHelp } from './commands/help.js';
import { registerScan } from './commands/scan.js';
import { registerManiana } from './commands/maniana.js';
import { registerPlan } from './commands/plan.js';
import { registerThesis } from './commands/thesis.js';
import { registerReview } from './commands/review.js';
import { registerAlerta } from './commands/alerta.js';
import type { Deps } from '../deps.js';

/** Crea y configura la instancia del bot de Telegram. */
export function createBot(deps: Deps): Bot {
  const env = loadEnv();
  setLogLevel(env.LOG_LEVEL);

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Middlewares (el orden importa: logging → rate-limit → session)
  bot.use(loggingMiddleware);
  bot.use(rateLimitMiddleware);
  bot.use(sessionMiddleware);

  // Comandos
  registerStart(bot);
  registerHelp(bot);
  registerScan(bot, deps);
  registerManiana(bot, deps);
  registerPlan(bot, deps);
  registerThesis(bot, deps);
  registerReview(bot, deps);
  registerAlerta(bot, deps);

  // Manejo global de errores
  bot.catch((err) => {
    const e = err.error instanceof Error ? err.error : new Error(String(err.error));
    console.error(`[bot] error en update: ${e.message}`, e);
  });

  return bot;
}
