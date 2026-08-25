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

/** Media móvil simple (últimas `period` velas). */
export function computeSMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const window = values.slice(values.length - period);
  return window.reduce((a, b) => a + b, 0) / period;
}

/** Media móvil exponencial. */
export function computeEMA(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
  }
  return ema;
}

/** RSI (Wilder) sobre la serie de cierres. */
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
