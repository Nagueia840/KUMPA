import { buildSignature, encryptPassphrase } from './sign.js';
import { fetchWithTimeout } from '../http.js';
import type {
  BitgetConfig,
  Candle,
  FundingRate,
  OpenInterest,
  ProductType,
  Ticker,
} from './types.js';

export class BitgetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BitgetError';
    this.code = code;
  }
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/** Cliente REST de Bitget v2. Solo lectura de datos de mercado (nunca trading). */
export class BitgetClient {
  private readonly config: BitgetConfig;

  constructor(config: BitgetConfig) {
    this.config = config;
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const queryString = buildQueryString(opts.query);
    const url = `${this.config.baseURL}${opts.path}${queryString ? `?${queryString}` : ''}`;
    const bodyString = opts.method === 'POST' ? JSON.stringify(opts.body ?? {}) : '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Firma (solo si hay credenciales; los endpoints públicos funcionan igual).
    if (this.config.apiKey && this.config.secretKey) {
      const timestamp = String(Date.now());
      const signature = buildSignature({
        secretKey: this.config.secretKey,
        timestamp,
        method: opts.method,
        requestPath: opts.path,
        body: opts.method === 'GET' ? (queryString ? `?${queryString}` : '') : bodyString,
      });
      headers['ACCESS-KEY'] = this.config.apiKey;
      headers['ACCESS-SIGN'] = signature;
      headers['ACCESS-TIMESTAMP'] = timestamp;
      headers['ACCESS-PASSPHRASE'] = encryptPassphrase(this.config.secretKey, this.config.passphrase);
    }

    const res = await fetchWithTimeout(url, {
      method: opts.method,
      headers,
      body: opts.method === 'POST' ? bodyString : undefined,
    });

    const json = (await res.json()) as { code?: string; msg?: string; data?: T };
    if (!res.ok || (json.code !== undefined && json.code !== '00000')) {
      throw new BitgetError(json.code ?? String(res.status), json.msg ?? `HTTP ${res.status}`);
    }
    if (json.data === undefined) {
      throw new BitgetError('NO_DATA', `Respuesta sin data para ${opts.path}`);
    }
    return json.data;
  }

  // ── Market data (mix / futuros) ────────────────────────────

  async getTicker(symbol: string, productType: ProductType = 'USDT-FUTURES'): Promise<Ticker> {
    const data = await this.request<Ticker[]>({
      method: 'GET',
      path: '/api/v2/mix/market/ticker',
      query: { symbol, productType },
    });
    const ticker = data[0];
    if (!ticker) throw new BitgetError('NO_DATA', `Sin ticker para ${symbol}`);
    return ticker;
  }

  async getCurrentFunding(
    symbol: string,
    productType: ProductType = 'USDT-FUTURES',
  ): Promise<FundingRate> {
    const data = await this.request<FundingRate[]>({
      method: 'GET',
      path: '/api/v2/mix/market/current-fund-rate',
      query: { symbol, productType },
    });
    const fr = data[0];
    if (!fr) throw new BitgetError('NO_DATA', `Sin funding para ${symbol}`);
    return fr;
  }

  async getFundingHistory(
    symbol: string,
    opts: { pageSize?: number; productType?: ProductType } = {},
  ): Promise<FundingRate[]> {
    return this.request<FundingRate[]>({
      method: 'GET',
      path: '/api/v2/mix/market/history-fund-rate',
      query: { symbol, productType: opts.productType ?? 'USDT-FUTURES', pageSize: opts.pageSize ?? 30 },
    });
  }

  async getOpenInterest(
    symbol: string,
    productType: ProductType = 'USDT-FUTURES',
  ): Promise<OpenInterest> {
    return this.request<OpenInterest>({
      method: 'GET',
      path: '/api/v2/mix/market/open-interest',
      query: { symbol, productType },
    });
  }

  async getCandles(
    symbol: string,
    granularity: string,
    opts: { limit?: number; productType?: ProductType; endTime?: number } = {},
  ): Promise<Candle[]> {
    return this.request<Candle[]>({
      method: 'GET',
      path: '/api/v2/mix/market/candles',
      query: {
        symbol,
        granularity,
        productType: opts.productType ?? 'USDT-FUTURES',
        limit: opts.limit ?? 100,
        endTime: opts.endTime,
      },
    });
  }

  /** Obtiene velas paginando hasta `minCount` (Bitget limita a ~90 por request). */
  async getCandlesHistory(
    symbol: string,
    granularity: string,
    minCount: number,
    productType: ProductType = 'USDT-FUTURES',
  ): Promise<Candle[]> {
    const all: Candle[] = [];
    let endTime: number | undefined;
    // Hasta 6 páginas: 1D/1W llegan a su profundidad real (540/78); 1M a ~21.
    // El loop corta apenas alcanza minCount, así que 1D (220) usa solo 3 páginas.
    for (let page = 0; page < 6 && all.length < minCount; page++) {
      const batch = await this.getCandles(symbol, granularity, { limit: 90, productType, endTime });
      if (batch.length === 0) break;
      all.push(...batch);
      const times = batch.map((c) => Number(c[0])).filter((n) => Number.isFinite(n));
      if (times.length === 0) break;
      endTime = Math.min(...times) - 1;
    }
    return all;
  }
}

function buildQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return '';
  return Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}
