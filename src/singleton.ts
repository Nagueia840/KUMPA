import type { Bot } from 'grammy';
import type { Deps } from './deps.js';
import { createBot } from './bot/index.js';
import { createDeps } from './deps.js';

let depsPromise: Promise<Deps> | null = null;
let botPromise: Promise<Bot> | null = null;

/** Singleton lazy de dependencias (para serverless: se inicializa una sola vez). */
export function getDeps(): Promise<Deps> {
  if (!depsPromise) depsPromise = createDeps();
  return depsPromise;
}

/** Singleton lazy del bot. Reutiliza las mismas dependencias. */
export function getBot(): Promise<Bot> {
  if (!botPromise) {
    botPromise = getDeps()
      .then((deps) => createBot(deps))
      .then(async (bot) => {
        // grammY exige bot.init() (o botInfo) antes de bot.handleUpdate():
        // handleUpdate lanza "Bot not initialized!" si `this.me` es undefined
        // (grammy out/bot.js). bot.init() hace un getMe() (1 llamada HTTP
        // inofensiva a Telegram, sin mensajes), cachea botInfo y es idempotente
        // (isInited() → no repite). Es el mismo mecanismo que usa
        // webhookCallback (grammy out/convenience/webhook.js L72-75).
        // En Edge Functions (Deno) getMe() es soportado por grammY vía fetch.
        await bot.init();
        return bot;
      });
  }
  return botPromise;
}
