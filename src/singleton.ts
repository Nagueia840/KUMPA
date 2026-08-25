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
  if (!botPromise) botPromise = getDeps().then((deps) => createBot(deps));
  return botPromise;
}
