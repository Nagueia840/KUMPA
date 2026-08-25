import { getJSON } from '../http.js';

export interface CMCGlobal {
  data?: {
    total_market_cap_usd?: number;
    btc_dominance?: number;
    total_volume_24h_usd?: number;
  };
}

/** Cliente de CoinMarketCap (fallback de CoinGecko). Requiere CMC_API_KEY (free tier). */
export class CoinMarketCapClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://pro-api.coinmarketcap.com',
  ) {}

  async getGlobal(): Promise<CMCGlobal> {
    return getJSON<CMCGlobal>(`${this.baseURL}/v1/global-metrics/quotes/latest`, {
      headers: { 'X-CMC_PRO_API_KEY': this.apiKey },
    });
  }
}
