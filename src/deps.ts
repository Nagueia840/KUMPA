import { BitgetClient, createBitgetClient } from './data/bitget/index.js';
import { BinanceFuturesClient } from './data/market/binance.js';
import { BybitClient } from './data/market/bybit.js';
import { CoinGeckoClient } from './data/market/coingecko.js';
import { CoinMarketCapClient } from './data/market/coinmarketcap.js';
import { DefiLlamaClient } from './data/onchain/defillama.js';
import { DuneClient } from './data/onchain/dune.js';
import { FlipsideClient } from './data/onchain/flipside.js';
import { createDefaultRpcClient, type EthAddress, type RpcClient } from './data/onchain/rpc.js';
import { FredClient } from './data/macro/fred.js';
import { SeekingAlphaClient } from './data/equities/seekingalpha.js';
import { ExaClient } from './data/web/exa.js';
import { OpenMeteoClient } from './data/web/weather.js';
import { LLMClient } from './llm/index.js';
import { EmbeddingClient } from './llm/embed.js';
import { VisionClient } from './llm/vision.js';
import { getEmbeddingSettings, getLLMSettings, getVisionSettings } from './config/settings.js';
import { loadEnv } from './config/env.js';
import { MemoryStore } from './memory/store.js';

/** Dependencias compartidas inyectadas en los comandos del bot. */
export interface Deps {
  llm: LLMClient | null; // null si no hay LLM_API_KEY
  vision: VisionClient | null; // null si no hay VISION_API_KEY
  memory: MemoryStore;
  binance: BinanceFuturesClient;
  bybit: BybitClient;
  coinGecko: CoinGeckoClient;
  cmc: CoinMarketCapClient | null;
  defiLlama: DefiLlamaClient;
  bitget: BitgetClient;
  rpc: RpcClient;
  dune: DuneClient | null;
  flipside: FlipsideClient | null;
  fred: FredClient | null;
  seekingAlpha: SeekingAlphaClient;
  exa: ExaClient | null;
  weather: OpenMeteoClient;
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

async function createVision(): Promise<VisionClient | null> {
  try {
    const settings = await getVisionSettings();
    if (!settings.apiKey) return null;
    return new VisionClient(settings);
  } catch (err) {
    console.warn('[deps] Sin visión (falta VISION_API_KEY):', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Construye el contenedor de dependencias a partir de la configuración. */
export async function createDeps(): Promise<Deps> {
  const env = loadEnv();
  const [llmSettings, embedder, vision] = await Promise.all([
    getLLMSettings(),
    createEmbedder(),
    createVision(),
  ]);

  let llm: LLMClient | null = null;
  if (llmSettings.apiKey) {
    llm = new LLMClient(llmSettings);
  } else {
    console.warn('[deps] Sin LLM_API_KEY: los comandos corren en modo datos (sin análisis LLM).');
  }

  return {
    llm,
    vision,
    memory: new MemoryStore(embedder),
    binance: new BinanceFuturesClient(),
    bybit: new BybitClient(),
    coinGecko: new CoinGeckoClient(),
    cmc: env.CMC_API_KEY ? new CoinMarketCapClient(env.CMC_API_KEY) : null,
    defiLlama: new DefiLlamaClient(),
    bitget: createBitgetClient(),
    rpc: createDefaultRpcClient(),
    dune: env.DUNE_API_KEY ? new DuneClient(env.DUNE_API_KEY) : null,
    flipside: env.FLIPSIDE_API_KEY ? new FlipsideClient(env.FLIPSIDE_API_KEY) : null,
    fred: env.FRED_API_KEY ? new FredClient(env.FRED_API_KEY) : null,
    seekingAlpha: new SeekingAlphaClient(),
    exa: env.EXA_API_KEY ? new ExaClient(env.EXA_API_KEY) : null,
    weather: new OpenMeteoClient(),
  };
}

// Re-export de utilidad para comandos que necesiten el tipo de dirección
export type { EthAddress };
