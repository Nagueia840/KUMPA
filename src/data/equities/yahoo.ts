import { getJSON } from '../http.js';

export interface YahooQuote {
  meta: {
    symbol: string;
    regularMarketPrice?: number;
    previousClose?: number;
    regularMarketTime?: number;
    longName?: string;
    shortName?: string;
    currency?: string;
    chartPreviousClose?: number;
  };
  indicators?: {
    quote?: [{ close?: (number | null)[] }];
  };
}

export interface YahooChartResponse {
  chart: {
    result: YahooQuote[];
    error: unknown | null;
  };
}

/** Cliente de Yahoo Finance (equities/índices/forex/crypto, gratis, sin key). */
export class YahooFinanceClient {
  constructor(private readonly baseURL = 'https://query1.finance.yahoo.com') {}

  /** Precio actual + serie de cierres de un símbolo (ej AAPL, ^GSPC, BTC-USD). */
  async getQuote(symbol: string, range = '1mo'): Promise<YahooQuote> {
    const data = await getJSON<YahooChartResponse>(
      `${this.baseURL}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kumpa/0.1' },
      },
    );
    const quote = data.chart.result[0];
    if (!quote) throw new Error(`Sin datos Yahoo para ${symbol}`);
    return quote;
  }
}
