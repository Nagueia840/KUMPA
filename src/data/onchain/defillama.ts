import { getJSON } from '../http.js';

export interface ChainTVL {
  name: string;
  tokenSymbol?: string;
  tvl: number;
  chainId?: number;
}

export interface ProtocolTVL {
  name: string;
  symbol: string;
  chain: string;
  tvl: number;
  slug: string;
  category?: string;
}

export interface Stablecoin {
  id: string;
  name: string;
  symbol: string;
  gecko_id?: string;
  pegType?: string;
  pegMechanism?: string;
  price?: number;
  /** Circulante total pegado a USD. */
  circulating?: { peggedUSD: number };
  circulatingPrevDay?: { peggedUSD: number };
  circulatingPrevWeek?: { peggedUSD: number };
  circulatingPrevMonth?: { peggedUSD: number };
  chainCirculating?: Record<string, { current?: { peggedUSD: number } }>;
  chains?: string[];
}

/** Cliente de DefiLlama (gratis, sin API key): TVL, stablecoins, protocolos. */
export class DefiLlamaClient {
  constructor(
    private readonly apiBaseURL = 'https://api.llama.fi',
    private readonly stablecoinsBaseURL = 'https://stablecoins.llama.fi',
  ) {}

  async getChains(): Promise<ChainTVL[]> {
    return getJSON<ChainTVL[]>(`${this.apiBaseURL}/v2/chains`);
  }

  async getProtocols(): Promise<ProtocolTVL[]> {
    return getJSON<ProtocolTVL[]>(`${this.apiBaseURL}/v2/protocols`);
  }

  async getStablecoins(): Promise<Stablecoin[]> {
    const data = await getJSON<{ peggedAssets: Stablecoin[] }>(`${this.stablecoinsBaseURL}/stablecoins`);
    return data.peggedAssets;
  }

  async getProtocolTVL(slug: string): Promise<{ tvl: { date: number; totalLiquidityUSD: number }[] }> {
    return getJSON(`${this.apiBaseURL}/protocol/${slug}`);
  }
}
