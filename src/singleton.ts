import type { Bot } from 'grammy';
import { createBot } from './bot/index.js';
import { createDeps } from './deps.js';

let botPromise: Promise<Bot> | null = null;

/**
 * Singleton lazy del bot. En serverless (Vercel) se inicializa una sola vez
 * por instancia y se reutiliza entre requests.
 */
export function getBot(): Promise<Bot> {
  if (!botPromise) {
    botPromise = (async () => {
      const deps = await createDeps();
      return createBot(deps);
    })();
  }
  return botPromise;
}
