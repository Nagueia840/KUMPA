import {
  TF_META,
  availableIndicators,
  missingIndicators,
  type TfLabel,
} from '../config/timeframes.js';

/**
 * Estructura de datos multitemporal (FASE A + extensión FASE B).
 * Ensambla el JSON que recibe el LLM. Reglas:
 * - Cada valor vive dentro de su objeto `timeframes.<TF>` (no se mezclan marcos).
 * - `ultima_vela_estado` distingue vela cerrada ('closed') de la vela en curso ('live').
 * - `no_disponible` lista indicadores que NO se pudieron calcular (historia corta).
 * - FASE B: `valido`/`error` por TF (un TF que falla NO se sustituye por otro),
 *   `vela_viva` (OHLC de la vela en curso, aparte del cálculo) y
 *   `cierre_ultima_cerrada` (precio de cierre de la última vela cerrada).
 */

/** Vela OHLCV mínima (misma forma que Candle de indicators.ts). */
export interface TfCandleInput {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** OHLC de la vela en curso (metadata; nunca entra al cálculo de indicadores). */
export interface VelaViva {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type CandleState = 'closed' | 'live';

/** Estado de validez de un timeframe o símbolo (FASE C — data validity). */
export type TfStatus =
  | 'ok'
  | 'fetch_failed'
  | 'timeout'
  | 'insufficient_candles'
  | 'unsupported'
  | 'calculation_failed'
  | 'not_available';

export interface TfBlock {
  /** false = este timeframe no tiene datos (fetch falló / sin velas). */
  valido: boolean;
  /** Estado estructurado de validez (FASE C). */
  status: TfStatus;
  /** Motivo cuando valido === false. */
  error?: string;
  granularidad_bitget: string;
  fuente: string;
  velas_total: number;
  ultima_vela_estado: CandleState;
  ultima_vela_ts_ms: number | null;
  /** Precio de cierre de la última vela CERRADA (base del cálculo). */
  cierre_ultima_cerrada: number | null;
  indicadores_disponibles: string[];
  no_disponible: string[];
  /** Indicadores de la capa del TF ya calculados (Fase B). */
  indicadores: Record<string, unknown>;
  /** Vela en curso aparte (solo si la última vela es live). */
  vela_viva?: VelaViva;
}

export interface MultiTfSymbolData {
  symbol: string;
  market: string;
  exchange: string;
  valido: boolean;
  /** Estado estructurado de validez del símbolo (FASE C). */
  status?: TfStatus;
  error?: string;
  precio?: number;
  funding_pct?: string;
  funding_ts_ms?: number;
  timeframes?: Partial<Record<TfLabel, TfBlock>>;
}

/** Contexto multitemporal: clave = par (ej. 'BTCUSDT'). */
export interface MultiTfContext {
  [pair: string]: MultiTfSymbolData;
}

/**
 * ¿La vela que abre en `openTsMs` está en curso a las `now` ms?
 * - TFs con duración fija: openTs + duración > now → live.
 * - 1M (mensual): Bitget abre la vela del mes M el último día del mes anterior a
 *   las 16:00Z (frontera UTC+8) → se compara el mes en UTC+8.
 */
export function isLiveCandle(tf: TfLabel, openTsMs: number, now: number): boolean {
  const ms = TF_META[tf].ms;
  if (ms !== null) return openTsMs + ms > now;
  const open = new Date(openTsMs + 8 * 3_600_000);
  const current = new Date(now + 8 * 3_600_000);
  return (
    open.getUTCFullYear() === current.getUTCFullYear() &&
    open.getUTCMonth() === current.getUTCMonth()
  );
}

/**
 * Construye el bloque de un timeframe.
 * - `candles`: serie completa (para metadata: velas_total y estado de la última).
 * - `closedCount`: velas CERRADAS efectivas (base de disponibilidad de indicadores).
 * - `indicadores`: valores calculados sobre las velas cerradas (Fase B).
 * - `velaViva`: OHLC de la vela en curso, aparte (Fase B).
 */
export function buildTfBlock(
  tf: TfLabel,
  candles: readonly TfCandleInput[],
  now: number,
  opts: {
    closedCount?: number;
    indicadores?: Record<string, unknown>;
    velaViva?: VelaViva;
    cierreUltimaCerrada?: number | null;
  } = {},
): TfBlock {
  const last = candles.length > 0 ? candles[candles.length - 1] : undefined;
  const estado: CandleState =
    last !== undefined && isLiveCandle(tf, last.time, now) ? 'live' : 'closed';
  const closedCount = opts.closedCount ?? candles.length;
  return {
    valido: true,
    status: 'ok',
    granularidad_bitget: TF_META[tf].bitget,
    fuente: 'Bitget',
    velas_total: candles.length,
    ultima_vela_estado: estado,
    ultima_vela_ts_ms: last?.time ?? null,
    cierre_ultima_cerrada: opts.cierreUltimaCerrada ?? null,
    indicadores_disponibles: availableIndicators(tf, closedCount),
    no_disponible: missingIndicators(tf, closedCount),
    indicadores: opts.indicadores ?? {},
    ...(opts.velaViva ? { vela_viva: opts.velaViva } : {}),
  };
}

/** Bloque de un timeframe que falló: valido:false + status + motivo. NUNCA se sustituye por otro TF. */
export function buildInvalidTfBlock(tf: TfLabel, status: TfStatus, error: string): TfBlock {
  return {
    valido: false,
    status,
    error,
    granularidad_bitget: TF_META[tf].bitget,
    fuente: 'Bitget',
    velas_total: 0,
    ultima_vela_estado: 'closed',
    ultima_vela_ts_ms: null,
    cierre_ultima_cerrada: null,
    indicadores_disponibles: [],
    no_disponible: [],
    indicadores: {},
  };
}

/** Crea la entrada de un símbolo VÁLIDO (sin timeframes; se adjuntan con attachTfBlock). */
export function buildMultiTfSymbol(
  symbol: string,
  opts: {
    price?: number;
    fundingPct?: string;
    fundingTsMs?: number;
    market?: string;
    exchange?: string;
  } = {},
): MultiTfSymbolData {
  return {
    symbol: symbol.toUpperCase(),
    market: opts.market ?? 'USDT-FUTURES',
    exchange: opts.exchange ?? 'Bitget',
    valido: true,
    precio: opts.price,
    funding_pct: opts.fundingPct,
    funding_ts_ms: opts.fundingTsMs,
    timeframes: {},
  };
}

/** Crea la entrada de un símbolo INVÁLIDO (sin datos en ningún marco → el guard lo bloquea). */
export function buildInvalidSymbol(
  symbol: string,
  error: string,
  status: TfStatus = 'fetch_failed',
): MultiTfSymbolData {
  return {
    symbol: symbol.toUpperCase(),
    market: 'USDT-FUTURES',
    exchange: 'Bitget',
    valido: false,
    status,
    error,
  };
}

/** Devuelve una copia de `data` con el bloque `block` adjuntado al timeframe `tf`. */
export function attachTfBlock(
  data: MultiTfSymbolData,
  tf: TfLabel,
  block: TfBlock,
): MultiTfSymbolData {
  return { ...data, timeframes: { ...data.timeframes, [tf]: block } };
}

/** Ensambla el contexto multitemporal agrupado por par (símbolo → BTCUSDT). */
export function buildMultiTfContext(entries: readonly MultiTfSymbolData[]): MultiTfContext {
  const out: MultiTfContext = {};
  for (const e of entries) out[`${e.symbol}USDT`] = e;
  return out;
}
