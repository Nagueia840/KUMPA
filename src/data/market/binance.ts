import { getJSON } from '../http.js';

export interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  interestRate: string;
  estimatedSettlePrice: string;
  time: number;
}

export interface FundingRateHistory {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  markPrice: string;
}

export interface OpenInterest {
  symbol: string;
  openInterest: string;
  time: number;
}

/** Cliente de Binance USDT-M Futures (fapi, público, sin key). */
export class BinanceFuturesClient {
  constructor(private readonly baseURL = 'https://fapi.binance.com') {}

  /** Mark price, index price y funding actual en un solo endpoint. */
  async getPremiumIndex(symbol: string): Promise<PremiumIndex> {
    return getJSON<PremiumIndex>(`${this.baseURL}/fapi/v1/premiumIndex?symbol=${symbol}`);
  }

  async getFundingHistory(symbol: string, limit = 30): Promise<FundingRateHistory[]> {
    return getJSON<FundingRateHistory[]>(
      `${this.baseURL}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`,
    );
  }

  async getOpenInterest(symbol: string): Promise<OpenInterest> {
    return getJSON<OpenInterest>(`${this.baseURL}/fapi/v1/openInterest?symbol=${symbol}`);
  }
}
