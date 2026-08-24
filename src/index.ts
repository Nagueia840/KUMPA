import { loadEnv } from './config/env.js';
import { createBot } from './bot/index.js';
import { createDeps } from './deps.js';
import { startAlertLoop } from './scheduler/index.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const deps = await createDeps();
  const bot = createBot(deps);

  if (env.BOT_MODE === 'polling') {
    startAlertLoop(deps, bot);
    console.info('[kumpa] Arrancando en modo polling…');
    await bot.start({
      onStart: (info) => console.info(`[kumpa] Bot activo como @${info.username}`),
    });
    return;
  }

  // Modo webhook: se expone en un server (fase de deploy). Por ahora solo polling.
  throw new Error('BOT_MODE=webhook todavía no está implementado (usá polling en desarrollo).');
}

main().catch((err) => {
  console.error('[kumpa] Falla fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
