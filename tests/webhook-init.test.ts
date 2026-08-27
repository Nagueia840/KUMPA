import { describe, it, expect, vi, afterEach } from 'vitest';
import { Bot } from 'grammy';
import { processOneUpdate } from '../src/webhook/worker-core.js';
import { fakeQueueStore } from './helpers/queue-store.js';
import { registerStart } from '../src/bot/commands/start.js';
import { registerHelp } from '../src/bot/commands/help.js';
import { registerScan } from '../src/bot/commands/scan.js';
import { registerManiana } from '../src/bot/commands/maniana.js';
import { registerPlan } from '../src/bot/commands/plan.js';
import { registerThesis } from '../src/bot/commands/thesis.js';
import { registerReview } from '../src/bot/commands/review.js';
import { registerAlerta } from '../src/bot/commands/alerta.js';
import { registerRecordar } from '../src/bot/commands/recordar.js';
import { registerChat } from '../src/bot/handlers/chat.js';
import { registerVision } from '../src/bot/handlers/vision.js';
import { registerVoice } from '../src/bot/handlers/voice.js';
import { loggingMiddleware } from '../src/bot/middlewares/logging.js';
import { rateLimitMiddleware } from '../src/bot/middlewares/rateLimit.js';
import { sessionMiddleware } from '../src/bot/middlewares/session.js';

/**
 * Regresión del fix de inicialización grammY en el Edge Worker:
 * bot.handleUpdate() exige bot.init() (o botInfo); sin init grammY lanza
 * "Bot not initialized!". El singleton getBot() ahora inicializa el bot.
 * Estos tests usan un bot REAL (mismos handlers que createBot) con fetch
 * mockeado vía client.fetch: el init() llama getMe() (una sola vez,
 * inofensivo) y el fixture seguro {"update_id": N} (sin message) no dispara
 * handlers con side effects.
 */

type DepsForTest = Parameters<typeof registerScan>[1];

function makeDeps(): DepsForTest {
  return {
    llm: null,
    vision: null,
    memory: {
      getRecentConversations: async () => [],
      saveConversation: async () => {},
    } as never,
    binance: {} as never,
    bybit: {} as never,
    coinGecko: {} as never,
    cmc: null,
    defiLlama: {} as never,
    bitget: {} as never,
    rpc: {} as never,
    dune: null,
    flipside: null,
    fred: null,
    seekingAlpha: {} as never,
    exa: null,
    weather: {} as never,
  };
}

const FETCHES: string[] = [];

function mockTelegramFetch(): typeof fetch {
  FETCHES.length = 0;
  const fn = async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    FETCHES.push(url);
    if (url.includes('getMe')) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: { id: 123456, is_bot: true, first_name: 'Test', username: 'kumpa_test_bot', can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  // grammY espera `typeof fetch` (incluye props estáticas); el cast es
  // necesario porque la implementación del test solo cubre la llamada.
  return fn as unknown as typeof fetch;
}

function buildBot(fetchMock: typeof fetch): Bot {
  const deps = makeDeps();
  const bot = new Bot('123456:TEST-DUMMY-TOKEN-NOT-REAL', {
    // El tipo de client.fetch en grammY es el del shim de Node (node-fetch),
    // distinto del fetch global del DOM; el cast es solo para el test.
    client: { fetch: fetchMock as never },
  });
  bot.use(loggingMiddleware);
  bot.use(rateLimitMiddleware);
  bot.use(sessionMiddleware);
  registerStart(bot);
  registerHelp(bot);
  registerScan(bot, deps);
  registerManiana(bot, deps);
  registerPlan(bot, deps);
  registerThesis(bot, deps);
  registerReview(bot, deps);
  registerAlerta(bot, deps);
  registerRecordar(bot, deps);
  registerChat(bot, deps);
  registerVision(bot, deps);
  registerVoice(bot, deps);
  bot.catch(() => {});
  return bot;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('grammY init en Edge Worker (fix singleton.getBot)', () => {
  it('bot sin init: handleUpdate lanza "Bot not initialized!" (regresión previa)', async () => {
    const fetchMock = mockTelegramFetch();
    const bot = buildBot(fetchMock); // SIN bot.init()
    await expect(bot.handleUpdate({ update_id: 9000000100 } as never)).rejects.toThrow(/Bot not initialized/);
    // sin init no debe llamar getMe ni nada de red
    expect(FETCHES.length).toBe(0);
  });

  it('bot con bot.init(): el fixture seguro {"update_id": N} sin message termina processed y sin side effects', async () => {
    const fetchMock = mockTelegramFetch();
    const bot = buildBot(fetchMock);
    await bot.init(); // 1 getMe (mockeado)

    const store = fakeQueueStore();
    const payload = { update_id: 9000000101 };
    await store.savePendingUpdate(9000000101, payload);
    const result = await processOneUpdate({ store, boot: async () => bot }, 9000000101);

    expect(result).toBe('processed');
    expect(store.processed.has(9000000101)).toBe(true);
    expect(store.rows.size).toBe(0);
    // Unica llamada de red: el getMe del init. NINGUNA otra (0 Telegram reply,
    // 0 LLM, 0 Bitget, 0 Exa, 0 Vision).
    expect(FETCHES.length).toBe(1);
    expect(FETCHES[0]).toContain('getMe');
  });

  it('bot con bot.init(): message con new_chat_member (sin text/photo/voice) termina processed sin side effects', async () => {
    const fetchMock = mockTelegramFetch();
    const bot = buildBot(fetchMock);
    await bot.init();

    const store = fakeQueueStore();
    const payload = { update_id: 9000000102, message: { chat: { id: 123456 }, new_chat_member: { id: 1 } } };
    await store.savePendingUpdate(9000000102, payload);
    const result = await processOneUpdate({ store, boot: async () => bot }, 9000000102);

    expect(result).toBe('processed');
    expect(store.processed.has(9000000102)).toBe(true);
    expect(FETCHES.length).toBe(1); // solo el getMe del init
    expect(FETCHES[0]).toContain('getMe');
  });

  it('bot con bot.init(): texto normal SÍ intenta reply (control: el fixture seguro es el que evita side effects)', async () => {
    const fetchMock = mockTelegramFetch();
    const bot = buildBot(fetchMock);
    await bot.init();

    const store = fakeQueueStore();
    const payload = { update_id: 9000000103, message: { chat: { id: 123456 }, text: 'hola' } };
    await store.savePendingUpdate(9000000103, payload);
    // llm=null → el chat handler responde "Perdón, todavía no tengo el LLM..."
    // vía ctx.reply → sendChatAction/sendMessage → llamada de red adicional.
    const result = await processOneUpdate({ store, boot: async () => bot }, 9000000103);
    expect(result).toBe('processed');
    expect(FETCHES.length).toBeGreaterThan(1); // getMe + sendChatAction/sendMessage
  });
});

