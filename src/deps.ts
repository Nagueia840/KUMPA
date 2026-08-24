import { BitgetClient, createBitgetClient } from './data/bitget/index.js';
import { BinanceFuturesClient } from './data/market/binance.js';
import { BybitClient } from './data/market/bybit.js';
import { CoinGeckoClient } from './data/market/coingecko.js';
import { DefiLlamaClient } from './data/onchain/defillama.js';
import { LLMClient } from './llm/index.js';
import { getLLMSettings } from './config/settings.js';
import { MemoryStore } from './memory/store.js';

/** Dependencias compartidas inyectadas en los comandos del bot. */
export interface Deps {
  llm: LLMClient | null; // null si no hay LLM_API_KEY (modo datos sin análisis)
  memory: MemoryStore;
  binance: BinanceFuturesClient;
  bybit: BybitClient;
  coinGecko: CoinGeckoClient;
  defiLlama: DefiLlamaClient;
  bitget: BitgetClient;
}

/** Construye el contenedor de dependencias a partir de la configuración. */
export async function createDeps(): Promise<Deps> {
  const settings = await getLLMSettings();
  let llm: LLMClient | null = null;
  if (settings.apiKey) {
    llm = new LLMClient(settings);
  } else {
    console.warn('[deps] Sin LLM_API_KEY: los comandos corren en modo datos (sin análisis LLM).');
  }

  return {
    llm,
    memory: new MemoryStore(),
    binance: new BinanceFuturesClient(),
    bybit: new BybitClient(),
    coinGecko: new CoinGeckoClient(),
    defiLlama: new DefiLlamaClient(),
    bitget: createBitgetClient(),
  };
}
