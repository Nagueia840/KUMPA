import { BitgetClient, createBitgetClient } from './data/bitget/index.js';
import { BinanceFuturesClient } from './data/market/binance.js';
import { BybitClient } from './data/market/bybit.js';
import { CoinGeckoClient } from './data/market/coingecko.js';
import { DefiLlamaClient } from './data/onchain/defillama.js';
import { DuneClient } from './data/onchain/dune.js';
import { FlipsideClient } from './data/onchain/flipside.js';
import { createDefaultRpcClient, type EthAddress, type RpcClient } from './data/onchain/rpc.js';
import { FredClient } from './data/macro/fred.js';
import { SeekingAlphaClient } from './data/equities/seekingalpha.js';
import { LLMClient } from './llm/index.js';
import { EmbeddingClient } from './llm/embed.js';
import { getEmbeddingSettings, getLLMSettings } from './config/settings.js';
import { loadEnv } from './config/env.js';
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
  rpc: RpcClient;
  dune: DuneClient | null;
  flipside: FlipsideClient | null;
  fred: FredClient | null;
  seekingAlpha: SeekingAlphaClient;
}

async function createEmbedder(): Promise<EmbeddingClient | null> {
  try {
    const settings = await getEmbeddingSettings();
    if (!settings.apiKey) return null;
    return new EmbeddingClient(settings);
  } catch (err) {
    console.warn('[deps] Sin embeddings (memoria semántica desactivada):', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Construye el contenedor de dependencias a partir de la configuración. */
export async function createDeps(): Promise<Deps> {
  const env = loadEnv();
  const [llmSettings, embedder] = await Promise.all([getLLMSettings(), createEmbedder()]);

  let llm: LLMClient | null = null;
  if (llmSettings.apiKey) {
    llm = new LLMClient(llmSettings);
  } else {
    console.warn('[deps] Sin LLM_API_KEY: los comandos corren en modo datos (sin análisis LLM).');
  }

  return {
    llm,
    memory: new MemoryStore(embedder),
    binance: new BinanceFuturesClient(),
    bybit: new BybitClient(),
    coinGecko: new CoinGeckoClient(),
    defiLlama: new DefiLlamaClient(),
    bitget: createBitgetClient(),
    rpc: createDefaultRpcClient(),
    dune: env.DUNE_API_KEY ? new DuneClient(env.DUNE_API_KEY) : null,
    flipside: env.FLIPSIDE_API_KEY ? new FlipsideClient(env.FLIPSIDE_API_KEY) : null,
    fred: env.FRED_API_KEY ? new FredClient(env.FRED_API_KEY) : null,
    seekingAlpha: new SeekingAlphaClient(),
  };
}

// Re-export de utilidad para comandos que necesiten el tipo de dirección
export type { EthAddress };
