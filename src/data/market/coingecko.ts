import { buildQueryString, getJSON } from '../http.js';

export interface GlobalData {
  data: {
    total_market_cap: Record<string, number>;
    total_volume: Record<string, number>;
    market_cap_percentage: Record<string, number>;
    market_cap_change_percentage_24h_usd?: number;
  };
}

export interface TrendingCoin {
  item: {
    id: string;
    name: string;
    symbol: string;
    market_cap_rank?: number;
    score?: number;
  };
}

export interface TrendingResponse {
  coins: TrendingCoin[];
}

/** Cliente de CoinGecko (gratis, sin key para endpoints públicos). */
export class CoinGeckoClient {
  constructor(private readonly baseURL = 'https://api.coingecko.com/api/v3') {}

  async getGlobal(): Promise<GlobalData> {
    return getJSON<GlobalData>(`${this.baseURL}/global`);
  }

  async getSimplePrice(
    ids: string[],
    vsCurrencies: string[] = ['usd'],
  ): Promise<Record<string, Record<string, number>>> {
    return getJSON(
      `${this.baseURL}/simple/price?${buildQueryString({
        ids: ids.join(','),
        vs_currencies: vsCurrencies.join(','),
      })}`,
    );
  }

  async getTrending(): Promise<TrendingResponse> {
    return getJSON<TrendingResponse>(`${this.baseURL}/search/trending`);
  }
}
