import { getJSON } from '../http.js';

interface BybitEnvelope<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
}

export interface BybitTicker {
  symbol: string;
  lastPrice: string;
  fundingRate: string;
  nextFundingTime: string;
  turnover24h: string;
  volume24h: string;
  openInterest: string;
  markPrice: string;
  indexPrice: string;
}

export interface BybitFundingHistoryItem {
  symbol: string;
  fundingRate: string;
  fundingRateTimestamp: string;
}

export interface BybitOpenInterest {
  symbol: string;
  openInterest: string;
  timestamp: string;
  list?: { openInterest: string; timestamp: string }[];
}

/** Cliente de Bybit v5 (linear/USDT-M, público, sin key). */
export class BybitClient {
  constructor(private readonly baseURL = 'https://api.bybit.com') {}

  async getTicker(symbol: string): Promise<BybitTicker> {
    const env = await getJSON<BybitEnvelope<{ list: BybitTicker[] }>>(
      `${this.baseURL}/v5/market/tickers?category=linear&symbol=${symbol}`,
    );
    const ticker = env.result.list[0];
    if (!ticker) throw new Error(`Sin ticker Bybit para ${symbol}`);
    return ticker;
  }

  async getFundingHistory(symbol: string, limit = 30): Promise<BybitFundingHistoryItem[]> {
    const env = await getJSON<BybitEnvelope<{ list: BybitFundingHistoryItem[] }>>(
      `${this.baseURL}/v5/market/funding/history?category=linear&symbol=${symbol}&limit=${limit}`,
    );
    return env.result.list;
  }

  async getOpenInterest(symbol: string): Promise<BybitOpenInterest> {
    const env = await getJSON<BybitEnvelope<{ list: BybitOpenInterest[] }>>(
      `${this.baseURL}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=1h`,
    );
    const oi = env.result.list[0];
    if (!oi) throw new Error(`Sin open interest Bybit para ${symbol}`);
    return oi;
  }
}
