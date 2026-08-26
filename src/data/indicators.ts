/** Vela OHLCV parseada. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // volumen base
}

/** Convierte una vela cruda de Bitget (string[]) a Candle. */
export function parseCandle(raw: string[]): Candle {
  return {
    time: Number(raw[0]),
    open: Number(raw[1]),
    high: Number(raw[2]),
    low: Number(raw[3]),
    close: Number(raw[4]),
    volume: Number(raw[5] ?? 0),
  };
}

function trueRange(c: Candle, prev: Candle): number {
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}

function midpoint(candles: Candle[]): number {
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  return (high + low) / 2;
}

// ── Medias móviles ──────────────────────────────────────────

/** VWAP (precio promedio ponderado por volumen) sobre un set de velas. */
export function computeVWAP(candles: Candle[]): number | null {
  let sumPV = 0;
  let sumV = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    sumPV += typical * c.volume;
    sumV += c.volume;
  }
  return sumV > 0 ? sumPV / sumV : null;
}

export type VwapAnchor = 'utc' | 'exchange' | 'argentina';

/**
 * Inicio de sesión (ms) según ancla:
 * - 'utc' (default, política FASE E): 00:00Z — referencia neutral global para un
 *   mercado 24/7 (BTC/crypto no tiene sesión de mercado tradicional).
 * - 'exchange': 16:00Z (00:00 UTC+8) — día del exchange Bitget (coincide con el
 *   roll de las velas diarias).
 * - 'argentina': 03:00Z (00:00 America/Argentina/Buenos_Aires).
 */
export function vwapSessionStart(nowMs: number, anchor: VwapAnchor = 'utc'): number {
  const offsetHours = anchor === 'argentina' ? -3 : anchor === 'exchange' ? 8 : 0;
  const shifted = new Date(nowMs + offsetHours * 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.getTime() - offsetHours * 3_600_000;
}

/**
 * VWAP de sesión (FASE E): velas desde el inicio del ancla elegido.
 * Solo velas CERRADAS (la vela viva se excluye: su volumen parcial sesgaría;
 * el fetcher ya computa indicadores sobre velas cerradas). Si la sesión tiene
 * <2 velas, cae a las últimas `fallback` (default 7) — documentado, nunca inventa.
 */
export function computeSessionVWAP(
  candles: Candle[],
  opts: { anchor?: VwapAnchor; nowMs?: number; fallback?: number } = {},
): number | null {
  if (candles.length === 0) return null;
  const nowMs = opts.nowMs ?? Date.now();
  const start = vwapSessionStart(nowMs, opts.anchor ?? 'utc');
  const session = candles.filter((c) => c.time >= start);
  const window = session.length >= 2 ? session : candles.slice(-(opts.fallback ?? 7));
  return computeVWAP(window);
}

/** Media móvil simple (últimas `period` velas). */
export function computeSMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const window = values.slice(values.length - period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/** Media móvil exponencial (serie completa). */
export function computeEMASeries(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let ema = values.slice(0, Math.min(period, values.length)).reduce((a, b) => a + b, 0) / Math.min(period, values.length);
  out.push(ema);
  for (let i = 1; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
    out.push(ema);
  }
  return out;
}

/** Último valor de EMA. */
export function computeEMA(values: number[], period: number): number | null {
  const series = computeEMASeries(values, period);
  return series.length > 0 ? series[series.length - 1]! : null;
}

/** Media móvil ponderada (pesa más lo reciente). */
export function computeWMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const window = values.slice(-period);
  let sum = 0;
  let weight = 0;
  window.forEach((v, i) => {
    sum += v * (i + 1);
    weight += i + 1;
  });
  return weight > 0 ? sum / weight : null;
}

/** Media móvil Hull (menos lag). */
export function computeHMA(values: number[], period: number): number | null {
  const half = Math.max(1, Math.floor(period / 2));
  const sqrt = Math.max(1, Math.floor(Math.sqrt(period)));
  if (values.length < period + sqrt) return null;
  const diffs: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const wmaHalf = computeWMA(values.slice(0, i + 1), half);
    const wmaFull = computeWMA(values.slice(0, i + 1), period);
    if (wmaHalf !== null && wmaFull !== null) diffs.push(2 * wmaHalf - wmaFull);
  }
  if (diffs.length < sqrt) return null;
  return computeWMA(diffs, sqrt);
}

/** Media móvil ponderada por volumen. */
export function computeVWMA(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  const window = candles.slice(-period);
  let sumPV = 0;
  let sumV = 0;
  for (const c of window) {
    sumPV += c.close * c.volume;
    sumV += c.volume;
  }
  return sumV > 0 ? sumPV / sumV : null;
}

// ── Osciladores ─────────────────────────────────────────────

/** RSI (Wilder). */
export function computeRSI(values: number[], period = 14): number | null {
  if (values.length <= period || period <= 0) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** MACD: línea, señal e histograma. */
export function computeMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = computeEMASeries(closes, fast);
  const emaSlow = computeEMASeries(closes, slow);
  if (emaFast.length < slow || emaSlow.length < slow) return null;
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]!);
  const signalLine = computeEMASeries(macdLine, signal);
  if (signalLine.length === 0) return null;
  const macd = macdLine[macdLine.length - 1]!;
  const sig = signalLine[signalLine.length - 1]!;
  return { macd, signal: sig, histogram: macd - sig };
}

/** Stochastic %K/%D. */
export function computeStochastic(candles: Candle[], period = 14, smoothK = 3) {
  if (candles.length < period + smoothK) return null;
  const kValues: number[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1);
    const high = Math.max(...window.map((c) => c.high));
    const low = Math.min(...window.map((c) => c.low));
    const close = candles[i]!.close;
    kValues.push(low === high ? 50 : ((close - low) / (high - low)) * 100);
  }
  const k = kValues[kValues.length - 1]!;
  const d = kValues.slice(-smoothK).reduce((a, b) => a + b, 0) / smoothK;
  return { k, d };
}

/** Stochastic RSI. */
export function computeStochasticRSI(closes: number[], period = 14, smoothK = 3): number | null {
  const rsiSeries: number[] = [];
  for (let i = period; i < closes.length; i++) {
    const r = computeRSI(closes.slice(0, i + 1), period);
    if (r !== null) rsiSeries.push(r);
  }
  if (rsiSeries.length < period + smoothK) return null;
  const kValues: number[] = [];
  for (let i = period - 1; i < rsiSeries.length; i++) {
    const window = rsiSeries.slice(i - period + 1, i + 1);
    const high = Math.max(...window);
    const low = Math.min(...window);
    const cur = rsiSeries[i]!;
    kValues.push(high === low ? 50 : ((cur - low) / (high - low)) * 100);
  }
  return kValues[kValues.length - 1]!;
}

/** CCI. */
export function computeCCI(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  const window = candles.slice(-period);
  const typicals = window.map((c) => (c.high + c.low + c.close) / 3);
  const mean = typicals.reduce((a, b) => a + b, 0) / period;
  const meanDev = typicals.reduce((a, t) => a + Math.abs(t - mean), 0) / period;
  if (meanDev === 0) return 0;
  return (typicals[typicals.length - 1]! - mean) / (0.015 * meanDev);
}

/** Williams %R. */
export function computeWilliamsR(candles: Candle[], period = 14): number | null {
  if (candles.length < period) return null;
  const window = candles.slice(-period);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const close = candles[candles.length - 1]!.close;
  if (high === low) return -50;
  return -((high - close) / (high - low)) * 100;
}

/** ROC / Momentum (%). */
export function computeROC(closes: number[], period = 10): number | null {
  if (closes.length <= period) return null;
  const cur = closes[closes.length - 1]!;
  const prev = closes[closes.length - 1 - period]!;
  if (prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

/** Awesome Oscillator. */
export function computeAwesomeOscillator(candles: Candle[], fast = 5, slow = 34): number | null {
  if (candles.length < slow) return null;
  const medians = candles.map((c) => (c.high + c.low) / 2);
  const smaFast = computeSMA(medians, fast);
  const smaSlow = computeSMA(medians, slow);
  if (smaFast === null || smaSlow === null) return null;
  return smaFast - smaSlow;
}

// ── Volatilidad ─────────────────────────────────────────────

/** ATR (Wilder). */
export function computeATR(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) trs.push(trueRange(candles[i]!, candles[i - 1]!));
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]!) / period;
  return atr;
}

/**
 * Serie de ATR (Wilder) por índice: out[k] = ATR correspondiente a la vela
 * `candles[period + k]`. Usada por el SuperTrend canónico (necesita ATR[i]).
 */
function computeATRSeries(candles: Candle[], period: number): number[] {
  const out: number[] = [];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) trs.push(trueRange(candles[i]!, candles[i - 1]!));
  if (trs.length < period) return out;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(atr);
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]!) / period;
    out.push(atr);
  }
  return out;
}

/** Bollinger Bands. */
export function computeBollinger(candles: Candle[], period = 20, mult = 2) {
  const closes = candles.map((c) => c.close);
  const middle = computeSMA(closes, period);
  if (middle === null) return null;
  const window = closes.slice(-period);
  const variance = window.reduce((a, v) => a + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: middle + mult * sd, middle, lower: middle - mult * sd };
}

/** Keltner Channels. */
export function computeKeltner(candles: Candle[], period = 20, mult = 2) {
  const middle = computeSMA(candles.map((c) => c.close), period);
  const atr = computeATR(candles, period);
  if (middle === null || atr === null) return null;
  return { upper: middle + mult * atr, middle, lower: middle - mult * atr };
}

/** Donchian Channels. */
export function computeDonchian(candles: Candle[], period = 20) {
  if (candles.length < period) return null;
  const window = candles.slice(-period);
  return { upper: Math.max(...window.map((c) => c.high)), lower: Math.min(...window.map((c) => c.low)) };
}

/** Volatilidad histórica anualizada (%). */
export function computeHistoricalVolatility(closes: number[], period = 20): number | null {
  if (closes.length < period + 1) return null;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) returns.push(Math.log(closes[i]! / closes[i - 1]!));
  const window = returns.slice(-period);
  const mean = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((a, r) => a + (r - mean) ** 2, 0) / (period - 1);
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

// ── Tendencia ───────────────────────────────────────────────

/** ADX + DI+ + DI-. */
export function computeADX(candles: Candle[], period = 14) {
  if (candles.length < period * 2) return null;
  let plusDM = 0;
  let minusDM = 0;
  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const up = c.high - prev.high;
    const down = prev.low - c.low;
    plusDM += up > down && up > 0 ? up : 0;
    minusDM += down > up && down > 0 ? down : 0;
    trSum += trueRange(c, prev);
  }
  let atr = trSum / period;
  let plusDI = (plusDM / atr) * 100;
  let minusDI = (minusDM / atr) * 100;
  let adx = 0;
  for (let i = period + 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const up = c.high - prev.high;
    const down = prev.low - c.low;
    plusDM = (plusDM * (period - 1) + (up > down && up > 0 ? up : 0)) / period;
    minusDM = (minusDM * (period - 1) + (down > up && down > 0 ? down : 0)) / period;
    atr = (atr * (period - 1) + trueRange(c, prev)) / period;
    plusDI = (plusDM / atr) * 100;
    minusDI = (minusDM / atr) * 100;
    const dx = (Math.abs(plusDI - minusDI) / (plusDI + minusDI || 1)) * 100;
    adx = (adx * (period - 1) + dx) / period;
  }
  return { adx, plusDi: plusDI, minusDi: minusDI };
}

/** Ichimoku (Tenkan, Kijun, Senkou A/B). */
export function computeIchimoku(candles: Candle[]) {
  if (candles.length < 52) return null;
  const tenkan = midpoint(candles.slice(-9));
  const kijun = midpoint(candles.slice(-26));
  return {
    tenkan,
    kijun,
    senkouA: (tenkan + kijun) / 2,
    senkouB: midpoint(candles.slice(-52)),
  };
}

/** Parabolic SAR. */
export function computeParabolicSAR(candles: Candle[], step = 0.02, maxStep = 0.2): number | null {
  if (candles.length < 2) return null;
  let up = candles[1]!.close > candles[0]!.close;
  let sar = up ? candles[0]!.low : candles[0]!.high;
  let ep = up ? candles[1]!.high : candles[1]!.low;
  let af = step;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    sar = sar + af * (ep - sar);
    if (up) {
      if (c.low < sar) {
        up = false;
        sar = ep;
        ep = c.low;
        af = step;
      } else if (c.high > ep) {
        ep = c.high;
        af = Math.min(af + step, maxStep);
      }
      if (i >= 2) sar = Math.min(sar, candles[i - 1]!.low, candles[i - 2]!.low);
    } else {
      if (c.high > sar) {
        up = true;
        sar = ep;
        ep = c.high;
        af = step;
      } else if (c.low < ep) {
        ep = c.low;
        af = Math.min(af + step, maxStep);
      }
      if (i >= 2) sar = Math.max(sar, candles[i - 1]!.high, candles[i - 2]!.high);
    }
  }
  return sar;
}

/** Resultado del SuperTrend canónico: nivel, dirección y bandas finales persistentes. */
export interface SuperTrendResult {
  value: number;
  direction: 'up' | 'down';
  /** FinalUpper persistente (banda superior tras la lógica de persistencia). */
  upperBand: number;
  /** FinalLower persistente (banda inferior tras la lógica de persistencia). */
  lowerBand: number;
}

/**
 * SuperTrend CANÓNICO (FASE E).
 * Serie completa: el último valor depende de bandas/tendencia previas (no se
 * calcula de forma aislada). Fórmula:
 *   HL2 = (high + low) / 2
 *   BasicUpper[i] = HL2[i] + mult * ATR[i]
 *   BasicLower[i] = HL2[i] - mult * ATR[i]
 *   FinalUpper[i] = BasicUpper[i] si (BasicUpper[i] < FinalUpper[i-1] o close[i-1] > FinalUpper[i-1]); si no FinalUpper[i-1]
 *   FinalLower[i] = BasicLower[i] si (BasicLower[i] > FinalLower[i-1] o close[i-1] < FinalLower[i-1]); si no FinalLower[i-1]
 *   Si superTrend[i-1] == FinalUpper[i-1] (bajista): dirección = up si close[i] > FinalUpper[i]; si no down
 *   Si no (alcista): dirección = down si close[i] < FinalLower[i]; si no up
 *   superTrend[i] = FinalLower[i] si dirección up; si no FinalUpper[i]
 * El flip solo ocurre cuando el precio cruza la banda correspondiente (nunca por
 * close >= close previo como la versión simplificada).
 */
export function computeSuperTrend(
  candles: Candle[],
  period = 10,
  mult = 3,
): SuperTrendResult | null {
  if (candles.length <= period) return null;
  const atrSeries = computeATRSeries(candles, period);
  if (atrSeries.length === 0) return null;

  let prevFinalUpper = 0;
  let prevFinalLower = 0;
  let superTrend = 0;
  let direction: 'up' | 'down' = 'up';

  for (let i = period; i < candles.length; i++) {
    const c = candles[i]!;
    const atr = atrSeries[i - period]!;
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + mult * atr;
    const basicLower = hl2 - mult * atr;

    if (i === period) {
      // Seed: sin valor previo se inicia con las bandas básicas en tendencia alcista.
      prevFinalUpper = basicUpper;
      prevFinalLower = basicLower;
      direction = 'up';
      superTrend = prevFinalLower;
      continue;
    }

    const prev = candles[i - 1]!;
    const finalUpper =
      basicUpper < prevFinalUpper || prev.close > prevFinalUpper ? basicUpper : prevFinalUpper;
    const finalLower =
      basicLower > prevFinalLower || prev.close < prevFinalLower ? basicLower : prevFinalLower;

    if (superTrend === prevFinalUpper) {
      direction = c.close > finalUpper ? 'up' : 'down';
    } else {
      direction = c.close < finalLower ? 'down' : 'up';
    }
    superTrend = direction === 'up' ? finalLower : finalUpper;
    prevFinalUpper = finalUpper;
    prevFinalLower = finalLower;
  }

  return {
    value: superTrend,
    direction,
    upperBand: prevFinalUpper,
    lowerBand: prevFinalLower,
  };
}

/**
 * Versión SIMPLIFICADA anterior (FASE B). SOLO para comparación en tests —
 * NO usar en producción (infería dirección por close >= close previo y no
 * persistía bandas).
 */
export function computeSuperTrendLegacy(
  candles: Candle[],
  period = 10,
  mult = 3,
): { value: number; direction: 'up' | 'down' } | null {
  const atr = computeATR(candles, period);
  if (!atr) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!last || !prev) return null;
  const hl2 = (last.high + last.low) / 2;
  const direction: 'up' | 'down' = last.close >= prev.close ? 'up' : 'down';
  return { value: direction === 'up' ? hl2 - mult * atr : hl2 + mult * atr, direction };
}

// ── Volumen ─────────────────────────────────────────────────

/** OBV. */
export function computeOBV(candles: Candle[]): number | null {
  if (candles.length < 2) return null;
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    if (c.close > prev.close) obv += c.volume;
    else if (c.close < prev.close) obv -= c.volume;
  }
  return obv;
}

/** MFI. */
export function computeMFI(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) return null;
  let posFlow = 0;
  let negFlow = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const typical = (c.high + c.low + c.close) / 3;
    const raw = typical * c.volume;
    if (typical > (prev.high + prev.low + prev.close) / 3) posFlow += raw;
    else negFlow += raw;
  }
  if (negFlow === 0) return 100;
  return 100 - 100 / (1 + posFlow / negFlow);
}

/** Chaikin Money Flow. */
export function computeChaikinMF(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  const window = candles.slice(-period);
  let sum = 0;
  for (const c of window) {
    const range = c.high - c.low;
    const mfm = range === 0 ? 0 : (c.close - c.low - (c.high - c.close)) / range;
    sum += mfm * c.volume;
  }
  const vol = window.reduce((a, c) => a + c.volume, 0);
  return vol > 0 ? sum / vol : 0;
}

/** A/D Line. */
export function computeAccumulationDistribution(candles: Candle[]): number | null {
  if (candles.length === 0) return null;
  let ad = 0;
  for (const c of candles) {
    const range = c.high - c.low;
    const clv = range === 0 ? 0 : (c.close - c.low - (c.high - c.close)) / range;
    ad += clv * c.volume;
  }
  return ad;
}

// ── Soportes / resistencias ─────────────────────────────────

/** Pivot Points (clásico). */
export function computePivotPoints(candles: Candle[]) {
  if (candles.length < 2) return null;
  const prev = candles[candles.length - 2]!;
  const p = (prev.high + prev.low + prev.close) / 3;
  return {
    pivot: p,
    r1: 2 * p - prev.low,
    s1: 2 * p - prev.high,
    r2: p + (prev.high - prev.low),
    s2: p - (prev.high - prev.low),
  };
}

/** Fibonacci retracement (sobre las últimas 100 velas). */
export function computeFibonacci(candles: Candle[]): Record<string, number> {
  const window = candles.slice(-100);
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const range = high - low;
  const levels: Record<string, number> = {};
  for (const level of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) {
    levels[String(level)] = high - range * level;
  }
  return levels;
}

/** Fractales (últimos 5 máximos/mínimos). */
export function computeFractals(candles: Candle[], w = 2) {
  const fractalHighs: number[] = [];
  const fractalLows: number[] = [];
  for (let i = w; i < candles.length - w; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= c.high) isHigh = false;
      if (candles[j]!.low <= c.low) isLow = false;
    }
    if (isHigh) fractalHighs.push(c.high);
    if (isLow) fractalLows.push(c.low);
  }
  return { fractalHighs: fractalHighs.slice(-5), fractalLows: fractalLows.slice(-5) };
}

// ── Agregador ───────────────────────────────────────────────

export interface TechnicalSnapshot {
  price: number;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  wma20: number | null;
  hma20: number | null;
  vwma20: number | null;
  vwapWeekly: number | null;
  rsi14: number | null;
  macd: { macd: number; signal: number; histogram: number } | null;
  stochastic: { k: number; d: number } | null;
  stochasticRsi: number | null;
  cci: number | null;
  williamsR: number | null;
  roc10: number | null;
  awesomeOscillator: number | null;
  atr14: number | null;
  bollinger: { upper: number; middle: number; lower: number } | null;
  keltner: { upper: number; middle: number; lower: number } | null;
  donchian: { upper: number; lower: number } | null;
  historicalVolatility: number | null;
  adx: { adx: number; plusDi: number; minusDi: number } | null;
  ichimoku: { tenkan: number; kijun: number; senkouA: number; senkouB: number } | null;
  parabolicSar: number | null;
  superTrend: SuperTrendResult | null;
  obv: number | null;
  mfi14: number | null;
  chaikinMF: number | null;
  accumulationDistribution: number | null;
  pivotPoints: { pivot: number; r1: number; s1: number; r2: number; s2: number } | null;
  fibonacci: Record<string, number>;
  fractals: { fractalHighs: number[]; fractalLows: number[] };
}

/** Calcula TODOS los indicadores técnicos desde velas. */
export function computeAllIndicators(candles: Candle[], price: number): TechnicalSnapshot {
  const closes = candles.map((c) => c.close);
  const vwapWindow = candles.slice(-7); // VWAP semanal (7 velas diarias)
  return {
    price,
    sma20: computeSMA(closes, 20),
    sma50: computeSMA(closes, 50),
    sma100: computeSMA(closes, 100),
    sma200: computeSMA(closes, 200),
    ema20: computeEMA(closes, 20),
    ema50: computeEMA(closes, 50),
    wma20: computeWMA(closes, 20),
    hma20: computeHMA(closes, 20),
    vwma20: computeVWMA(candles, 20),
    vwapWeekly: computeVWAP(vwapWindow),
    rsi14: computeRSI(closes, 14),
    macd: computeMACD(closes),
    stochastic: computeStochastic(candles),
    stochasticRsi: computeStochasticRSI(closes),
    cci: computeCCI(candles),
    williamsR: computeWilliamsR(candles),
    roc10: computeROC(closes, 10),
    awesomeOscillator: computeAwesomeOscillator(candles),
    atr14: computeATR(candles),
    bollinger: computeBollinger(candles),
    keltner: computeKeltner(candles),
    donchian: computeDonchian(candles),
    historicalVolatility: computeHistoricalVolatility(closes),
    adx: computeADX(candles),
    ichimoku: computeIchimoku(candles),
    parabolicSar: computeParabolicSAR(candles),
    superTrend: computeSuperTrend(candles),
    obv: computeOBV(candles),
    mfi14: computeMFI(candles),
    chaikinMF: computeChaikinMF(candles),
    accumulationDistribution: computeAccumulationDistribution(candles),
    pivotPoints: computePivotPoints(candles),
    fibonacci: computeFibonacci(candles),
    fractals: computeFractals(candles),
  };
}

const round = (n: number | null | undefined): number | null =>
  n == null || Number.isNaN(n) ? null : Math.round(n);
const round1 = (n: number | null | undefined): number | null =>
  n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10;

/**
 * Versión COMPACTA pero CLARA del snapshot para inyectar como contexto al LLM
 * (ahorra tokens — clave para el límite TPM del tier gratis de Groq).
 * Sin arrays ambiguos: cada campo con nombre explícito para no confundir símbolos.
 */
export function compactIndicators(ind: TechnicalSnapshot): Record<string, unknown> {
  return {
    precio: round(ind.price),
    vwap_semanal: round(ind.vwapWeekly),
    sma20: round(ind.sma20),
    sma50: round(ind.sma50),
    sma100: round(ind.sma100),
    sma200: round(ind.sma200),
    ema20: round(ind.ema20),
    rsi: round1(ind.rsi14),
    macd_linea: ind.macd ? round(ind.macd.macd) : null,
    macd_senal: ind.macd ? round(ind.macd.signal) : null,
    macd_histograma: ind.macd ? round(ind.macd.histogram) : null,
    stochastic: ind.stochastic ? round1(ind.stochastic.k) : null,
    cci: round1(ind.cci),
    williamsR: round1(ind.williamsR),
    atr: round(ind.atr14),
    bollinger_inferior: ind.bollinger ? round(ind.bollinger.lower) : null,
    bollinger_media: ind.bollinger ? round(ind.bollinger.middle) : null,
    bollinger_superior: ind.bollinger ? round(ind.bollinger.upper) : null,
    adx: ind.adx ? round1(ind.adx.adx) : null,
    di_positivo: ind.adx ? round1(ind.adx.plusDi) : null,
    di_negativo: ind.adx ? round1(ind.adx.minusDi) : null,
    ichimoku_tenkan: ind.ichimoku ? round(ind.ichimoku.tenkan) : null,
    ichimoku_kijun: ind.ichimoku ? round(ind.ichimoku.kijun) : null,
    superTrend_direccion: ind.superTrend ? ind.superTrend.direction : null,
    superTrend_nivel: ind.superTrend ? round(ind.superTrend.value) : null,
    mfi: round1(ind.mfi14),
    pivot_p: ind.pivotPoints ? round(ind.pivotPoints.pivot) : null,
    pivot_r1: ind.pivotPoints ? round(ind.pivotPoints.r1) : null,
    pivot_s1: ind.pivotPoints ? round(ind.pivotPoints.s1) : null,
    fib_0_382: round(ind.fibonacci['0.382']),
    fib_0_5: round(ind.fibonacci['0.5']),
    fib_0_618: round(ind.fibonacci['0.618']),
  };
}
