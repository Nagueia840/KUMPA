/** Configuración del cliente Bitget. */
export interface BitgetConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseURL: string;
}

/** Tipo de producto de futuros (USDT-M es el estándar para perpetuos). */
export type ProductType = 'USDT-FUTURES' | 'COIN-FUTURES' | 'USDC-FUTURES';

/** Envelope estándar de respuestas Bitget v2. */
export interface BitgetEnvelope<T> {
  code: string;
  msg?: string;
  requestTime?: number;
  data: T;
}

/** Ticker de un par en mix (futuros). */
export interface Ticker {
  symbol: string;
  lastPr?: string;
  high24h?: string;
  low24h?: string;
  change24h?: string;
  baseVolume?: string;
  quoteVolume?: string;
  usdtVolume?: string;
  ts?: string;
}

/** Tasa de funding actual / histórica. */
export interface FundingRate {
  symbol: string;
  fundingRate: string;
  nextUpdate?: string; // current-fund-rate (ms)
  fundingTime?: string; // history-fund-rate (ms)
}

/** Punto de la serie de open interest. */
export interface OpenInterestPoint {
  symbol: string;
  size: string;
}

/** Open interest de un par. */
export interface OpenInterest {
  openInterestList?: OpenInterestPoint[];
  ts?: string;
}

/**
 * Vela OHLCV en mix. Array con [ts, open, high, low, close, baseVol, quoteVol, ...].
 * Los nombres exactos de campos se verifican contra la API real al probar con key.
 */
export type Candle = string[];
