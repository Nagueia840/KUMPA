/**
 * Configuración de timeframes para el motor multitemporal (FASE A).
 *
 * Los valores de `maxPerRequest` y `depth` fueron VERIFICADOS contra la API real
 * de Bitget (26/08/2026): el endpoint /api/v2/mix/market/candles clampea el
 * límite por granularidad y la profundidad total es limitada para 1M/1W.
 * Regla de fetch (Fase B): SIEMPRE limit=90 + paginación por endTime
 * (el patrón probado); no usar limit alto + endTime (puede repetir páginas).
 */
export type TfLabel = '1M' | '1W' | '1D' | '4H' | '1H' | '15m' | '5m';

/** Orden de grueso a fino (también usado para ordenar resultados del parser). */
export const TF_ORDER: readonly TfLabel[] = ['1M', '1W', '1D', '4H', '1H', '15m', '5m'];

export interface TfMeta {
  /** String EXACTO de granularidad que espera Bitget (case-sensitive: 1M ≠ 1m). */
  bitget: string;
  /** Duración de la vela en ms; null para 1M (frontera calendario, UTC+8). */
  ms: number | null;
  /** Velas objetivo a pedir (Fase B) según la capa del TF. */
  candleNeed: number;
  /** Máx. velas que devuelve UNA request sin paginar (clamp real de la API). */
  maxPerRequest: number;
  /** Profundidad total real obtenible paginando; null = suficiente para todo. */
  depth: number | null;
}

export const TF_META: Record<TfLabel, TfMeta> = {
  '1M': { bitget: '1M', ms: null, candleNeed: 21, maxPerRequest: 4, depth: 21 },
  '1W': { bitget: '1W', ms: 604_800_000, candleNeed: 78, maxPerRequest: 13, depth: 78 },
  '1D': { bitget: '1D', ms: 86_400_000, candleNeed: 220, maxPerRequest: 90, depth: null },
  '4H': { bitget: '4H', ms: 14_400_000, candleNeed: 220, maxPerRequest: 540, depth: null },
  '1H': { bitget: '1H', ms: 3_600_000, candleNeed: 220, maxPerRequest: 1000, depth: null },
  '15m': { bitget: '15m', ms: 900_000, candleNeed: 120, maxPerRequest: 1000, depth: null },
  '5m': { bitget: '5m', ms: 300_000, candleNeed: 120, maxPerRequest: 1000, depth: null },
};

export type Layer = 'contexto' | 'estructura' | 'ejecucion';

export const LAYER_BY_TF: Record<TfLabel, Layer> = {
  '1M': 'contexto',
  '1W': 'contexto',
  '1D': 'contexto',
  '4H': 'estructura',
  '1H': 'estructura',
  '15m': 'ejecucion',
  '5m': 'ejecucion',
};

/** Indicadores por capa (subconjunto del motor existente; sin listas interminables). */
export const INDICATORS_BY_LAYER: Record<Layer, readonly string[]> = {
  contexto: [
    'ema20', 'sma50', 'sma100', 'sma200', 'rsi', 'macd', 'atr', 'bollinger',
    'adx', 'ichimoku', 'superTrend', 'pivotes', 'fib',
  ],
  estructura: [
    'ema20', 'vwap_sesion', 'rsi', 'macd', 'atr', 'bollinger', 'superTrend',
    'pivotes', 'mfi',
  ],
  ejecucion: [
    'vwap_sesion', 'ema9', 'ema20', 'rsi', 'atr', 'bollinger', 'williamsR',
    'roc', 'obv', 'superTrend',
  ],
};

/** Velas mínimas requeridas por indicador (mismo criterio que src/data/indicators.ts). */
export const INDICATOR_MIN_CANDLES: Record<string, number> = {
  sma20: 20, sma50: 50, sma100: 100, sma200: 200,
  ema9: 9, ema20: 20,
  rsi: 15, macd: 35, atr: 15, bollinger: 20, adx: 28, ichimoku: 52,
  superTrend: 12, vwap_sesion: 1, pivotes: 2, fib: 2,
  mfi: 15, williamsR: 15, roc: 11, obv: 2,
};

export type Intent =
  | 'alerta'
  | 'analisis_completo'
  | 'entrada'
  | 'scalp'
  | 'swing'
  | 'niveles'
  | 'vwap'
  | 'tendencia'
  | 'general';

export interface TfPolicy {
  contexto: readonly TfLabel[];
  estructura: readonly TfLabel[];
  ejecucion: readonly TfLabel[];
}

/** Política multitemporal por intención (contexto → estructura → ejecución). */
export const INTENT_POLICIES: Record<Intent, TfPolicy> = {
  analisis_completo: { contexto: ['1W', '1D'], estructura: ['4H'], ejecucion: ['1H'] },
  entrada: { contexto: ['1D'], estructura: ['4H', '1H'], ejecucion: ['15m'] },
  scalp: { contexto: ['1H'], estructura: ['15m'], ejecucion: ['5m'] },
  swing: { contexto: ['1W', '1D'], estructura: ['4H'], ejecucion: [] },
  niveles: { contexto: ['1D'], estructura: ['4H', '1H'], ejecucion: [] },
  vwap: { contexto: [], estructura: ['1H'], ejecucion: ['15m'] },
  tendencia: { contexto: ['1W', '1D'], estructura: [], ejecucion: [] },
  general: { contexto: ['1W', '1D'], estructura: ['4H'], ejecucion: [] },
  alerta: { contexto: ['1D'], estructura: [], ejecucion: [] },
};

/** Tope de timeframes por consulta (presupuesto de latencia en Vercel Hobby). */
export const MAX_TFS_PER_REQUEST = 4;

/** Indicadores de la capa del TF que se pueden calcular con `candleCount` velas. */
export function availableIndicators(tf: TfLabel, candleCount: number): string[] {
  const layer = LAYER_BY_TF[tf];
  return INDICATORS_BY_LAYER[layer].filter((ind) => (INDICATOR_MIN_CANDLES[ind] ?? 0) <= candleCount);
}

/** Indicadores de la capa del TF que NO se pueden calcular (historia insuficiente). */
export function missingIndicators(tf: TfLabel, candleCount: number): string[] {
  const layer = LAYER_BY_TF[tf];
  return INDICATORS_BY_LAYER[layer].filter((ind) => (INDICATOR_MIN_CANDLES[ind] ?? 0) > candleCount);
}
