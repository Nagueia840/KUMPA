import { parseMarketNumber } from '../utils/numbers.js';
import type { MultiTfContext, TfStatus } from '../utils/multitf.js';

/**
 * ALLOWED NUMERIC CLAIMS (FASE C).
 * Registro programático de los números de mercado que KUMPA tiene permitido
 * citar, con procedencia: symbol + timeframe + field + value + source.
 * Se construye desde el contexto multitemporal (pre-fetch) y se enriquece con
 * los resultados de herramientas (datos también obtenidos, reales).
 * El post-validator valida la respuesta contra este registro.
 */

export interface MarketClaim {
  symbol: string; // 'BTC' | 'ETH' | ... | 'GLOBAL' (datos sin símbolo, ej on-chain)
  timeframe?: string; // TfLabel cuando el valor pertenece a un marco
  field: string; // 'precio' | 'funding_pct' | 'rsi' | ... | 'tool:<path>' | 'event:*'
  value: number;
  source: 'ticker' | 'funding' | 'candles' | 'calculado' | 'tool' | 'event';
}

export interface ClaimSet {
  claims: MarketClaim[];
  bySymbol: Map<string, MarketClaim[]>;
  isEmpty: boolean;
}

function index(claims: MarketClaim[]): Map<string, MarketClaim[]> {
  const bySymbol = new Map<string, MarketClaim[]>();
  for (const c of claims) {
    const arr = bySymbol.get(c.symbol) ?? [];
    arr.push(c);
    bySymbol.set(c.symbol, arr);
  }
  return bySymbol;
}

/** Construye el registro desde el contexto multitemporal (Fase B). */
export function buildAllowedClaims(ctx: MultiTfContext): ClaimSet {
  const claims: MarketClaim[] = [];
  for (const s of Object.values(ctx)) {
    if (!s.valido) continue;
    const sym = s.symbol;
    if (typeof s.precio === 'number' && Number.isFinite(s.precio)) {
      claims.push({ symbol: sym, field: 'precio', value: s.precio, source: 'ticker' });
    }
    if (s.funding_pct) {
      const v = parseMarketNumber(s.funding_pct);
      if (v !== null) claims.push({ symbol: sym, field: 'funding_pct', value: v, source: 'funding' });
    }
    for (const [tf, b] of Object.entries(s.timeframes ?? {})) {
      if (!b?.valido) continue;
      if (b.cierre_ultima_cerrada !== null) {
        claims.push({ symbol: sym, timeframe: tf, field: 'cierre', value: b.cierre_ultima_cerrada, source: 'candles' });
      }
      if (b.vela_viva) {
        const vv = b.vela_viva;
        claims.push(
          { symbol: sym, timeframe: tf, field: 'viva_open', value: vv.open, source: 'candles' },
          { symbol: sym, timeframe: tf, field: 'viva_high', value: vv.high, source: 'candles' },
          { symbol: sym, timeframe: tf, field: 'viva_low', value: vv.low, source: 'candles' },
          { symbol: sym, timeframe: tf, field: 'viva_close', value: vv.close, source: 'candles' },
        );
      }
      for (const [k, v] of Object.entries(b.indicadores)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          claims.push({ symbol: sym, timeframe: tf, field: k, value: v, source: 'calculado' });
        }
      }
    }
  }
  return { claims, bySymbol: index(claims), isEmpty: claims.length === 0 };
}

/**
 * MAPEO TOOL → VOCABULARIO CANÓNICO (FIX -2470 / falso positivo del guard).
 *
 * `collectToolResultClaims` recorría el resultado de la tool y etiquetaba cada
 * número con `tool:<path>` (ej. `tool:priceUsd`, `tool:indicators.macd_histograma`).
 * El validator (validator.ts) solo reconoce campos canónicos en LABELS[].fields
 * ('precio', 'funding_pct', 'macd_linea', 'rsi', ...) → un número LEGÍTIMO de
 * get_market_snapshot / get_technical_indicators se marcaba "sin respaldo"
 * (GUARD_REFUSAL_TEXT en producción: -2470 = macd_histograma real de ETH).
 *
 * SOLUCIÓN: normalizar en el borde. Los campos CONOCIDOS se mapean al field
 * canónico que el validator ya entiende; los campos desconocidos conservan
 * `tool:<path>` (sin respaldo) → el guard sigue bloqueando números inventados.
 * `source: 'tool'` se mantiene: la trazabilidad de procedencia queda intacta.
 */
const TOOL_CANONICAL_FIELDS: Record<string, string> = {
  // get_market_snapshot / get_price (renombrados en certificación: price/volume24h,
  // con quoteAsset explícito — USDT ≠ USD; se mantienen los viejos por compat)
  price: 'precio',
  priceUsd: 'precio',
  fundingBitgetPct: 'funding_pct',
  fundingBinancePct: 'funding_pct',
  fundingBybitPct: 'funding_pct',
  fundingSpreadBps: 'funding_spread_bps',
  openInterestBitget: 'open_interest',
  openInterestBybit: 'open_interest',
  annualizedFundingPct: 'funding_anualizado_pct',
  premiumPct: 'premium_pct',
  volume24h: 'volumen_24h',
  volume24hUsd: 'volumen_24h',
  btcDominancePct: 'dominancia_btc',
  globalCapUsd: 'market_cap_global',
  // get_technical_indicators → computeAllIndicators (snapshot técnico completo)
  'indicators.price': 'precio',
  'indicators.precio': 'precio',
  'indicators.vwapWeekly': 'vwap_semanal',
  'indicators.sma20': 'sma20',
  'indicators.sma50': 'sma50',
  'indicators.sma100': 'sma100',
  'indicators.sma200': 'sma200',
  'indicators.ema20': 'ema20',
  'indicators.ema50': 'ema50',
  'indicators.wma20': 'wma20',
  'indicators.hma20': 'hma20',
  'indicators.vwma20': 'vwma20',
  'indicators.rsi14': 'rsi',
  'indicators.macd.macd': 'macd_linea',
  'indicators.macd.signal': 'macd_senal',
  'indicators.macd.histogram': 'macd_histograma',
  'indicators.stochastic.k': 'stochastic_k',
  'indicators.stochastic.d': 'stochastic_d',
  'indicators.stochasticRsi': 'stochasticRsi',
  'indicators.cci': 'cci',
  'indicators.awesomeOscillator': 'awesomeOscillator',
  'indicators.atr14': 'atr',
  'indicators.bollinger.lower': 'bollinger_inferior',
  'indicators.bollinger.middle': 'bollinger_media',
  'indicators.bollinger.upper': 'bollinger_superior',
  'indicators.bollingerBandwidth': 'bollinger_bandwidth_pct',
  'indicators.bollingerBandwidthPercentile': 'bollinger_bandwidth_pctil',
  'indicators.keltner.lower': 'keltner_inferior',
  'indicators.keltner.middle': 'keltner_media',
  'indicators.keltner.upper': 'keltner_superior',
  'indicators.donchian.lower': 'donchian_inferior',
  'indicators.donchian.upper': 'donchian_superior',
  'indicators.historicalVolatility': 'hv',
  'indicators.adx.adx': 'adx',
  'indicators.adx.plusDi': 'di_positivo',
  'indicators.adx.minusDi': 'di_negativo',
  'indicators.ichimoku.tenkan': 'ichimoku_tenkan',
  'indicators.ichimoku.kijun': 'ichimoku_kijun',
  'indicators.parabolicSar': 'parabolicSar',
  'indicators.superTrend.value': 'superTrend_nivel',
  'indicators.superTrend.direction': 'superTrend_direccion',
  'indicators.mfi14': 'mfi',
  'indicators.williamsR': 'williamsR',
  'indicators.roc10': 'roc',
  'indicators.obv': 'obv',
  'indicators.chaikinMF': 'cmf',
  'indicators.accumulationDistribution': 'accumulationDistribution',
  'indicators.fibonacci.0.236': 'fib_0_236',
  'indicators.fibonacci.0.382': 'fib_0_382',
  'indicators.fibonacci.0.5': 'fib_0_5',
  'indicators.fibonacci.0.618': 'fib_0_618',
  'indicators.fibonacci.0.786': 'fib_0_786',
  'indicators.pivotPoints.pivot': 'pivot_p',
  'indicators.pivotPoints.r1': 'pivot_r1',
  'indicators.pivotPoints.s1': 'pivot_s1',
  'indicators.pivotPoints.r2': 'pivot_r2',
  'indicators.pivotPoints.s2': 'pivot_s2',
  'indicators.fractals.fractalHighs': 'fractal_alto_reciente',
  'indicators.fractals.fractalLows': 'fractal_bajo_reciente',
};

/** Normaliza el path de un número de tool al field canónico del validator. */
function canonicalToolField(path: string): string {
  return TOOL_CANONICAL_FIELDS[path] ?? (path ? `tool:${path}` : 'tool:value');
}

/** Extrae claims de un resultado de herramienta (datos reales obtenidos). */
export function collectToolResultClaims(result: unknown, fallbackSymbol: string): MarketClaim[] {
  const out: MarketClaim[] = [];
  const resultObj = (result ?? {}) as { symbol?: string; timeframe?: string };
  const symbol = typeof resultObj.symbol === 'string' && resultObj.symbol ? resultObj.symbol.toUpperCase() : fallbackSymbol || 'GLOBAL';
  const timeframe = typeof resultObj.timeframe === 'string' ? resultObj.timeframe : undefined;

  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'number' && Number.isFinite(node)) {
      out.push({ symbol, timeframe, field: canonicalToolField(path), value: node, source: 'tool' });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, path ? `${path}[${i}]` : `[${i}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(result, '');
  return out;
}

/** Devuelve una copia del ClaimSet incluyendo claims de herramientas. */
export function withToolClaims(base: ClaimSet, toolClaims: readonly MarketClaim[]): ClaimSet {
  if (toolClaims.length === 0) return base;
  const all = [...base.claims, ...toolClaims];
  return { claims: all, bySymbol: index(all), isEmpty: all.length === 0 };
}

/** Devuelve una copia del ClaimSet incluyendo claims de eventos verificados (FASE D). */
export function withEventClaims(base: ClaimSet, eventClaims: readonly MarketClaim[]): ClaimSet {
  if (eventClaims.length === 0) return base;
  const all = [...base.claims, ...eventClaims];
  return { claims: all, bySymbol: index(all), isEmpty: all.length === 0 };
}

/**
 * VALIDACIÓN PRE-LLM (FASE C): bloque legible de validez por símbolo/TF.
 * Si un símbolo no tiene NINGÚN dato válido, el modelo lo ve explícito.
 */
export function buildValidityBlock(ctx: MultiTfContext): string {
  const lines: string[] = [];
  for (const [pair, s] of Object.entries(ctx)) {
    const sym = s.symbol;
    if (!s.valido) {
      lines.push(`${pair} (${sym}): SIN DATOS DE MERCADO VERIFICADOS PARA ESTE ACTIVO (${s.status ?? 'error'}: ${s.error ?? 'desconocido'})`);
      continue;
    }
    const tfs = Object.entries(s.timeframes ?? {});
    const allFailed = tfs.length === 0 || tfs.every(([, b]) => !b?.valido);
    if (allFailed) {
      lines.push(`${pair} (${sym}): SIN DATOS DE MERCADO VERIFICADOS PARA ESTE ACTIVO`);
      continue;
    }
    const detail = tfs
      .map(([tf, b]) => `${tf}=${b?.valido ? 'ok' : (b?.status ?? 'fail')}`)
      .join(', ');
    lines.push(`${pair} (${sym}): ${detail}`);
  }
  return lines.join('\n');
}

/** Convierte un ClaimSet a JSON legible (solo para logs/diagnóstico; sin secretos). */
export function summarizeClaims(claims: ClaimSet): string {
  return claims.claims.map((c) => `${c.symbol}${c.timeframe ? ':' + c.timeframe : ''}:${c.field}=${c.value}`).join(' ');
}

export type { TfStatus };
