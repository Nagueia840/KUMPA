import { describe, it, expect } from 'vitest';
import { computeLayerIndicators } from '../src/data/layer-indicators.js';
import type { Candle } from '../src/data/indicators.js';

function makeClosedCandles(n: number, endTs: number, step: number, close = 101): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push({ time: t, open: 100, high: 105, low: 95, close, volume: 10 });
  }
  return out;
}

const HOUR = 3_600_000;
const now = Date.parse('2026-08-26T18:00:00Z');

describe('computeLayerIndicators — subconjunto por capa', () => {
  it('contexto 1D (540 velas): claves de capa contexto, sin ema9/obv', () => {
    const ind = computeLayerIndicators('1D', makeClosedCandles(540, now, 24 * HOUR), 78500);
    expect(ind['sma50']).toBeDefined();
    expect(ind['sma200']).toBeDefined();
    expect(ind['rsi']).toBeDefined();
    expect(ind['atr']).toBeDefined();
    expect(ind['macd_linea']).toBeDefined();
    expect(ind['superTrend_nivel']).toBeDefined();
    expect(ind['pivot_p']).toBeDefined();
    expect(ind['ema9']).toBeUndefined(); // ema9 es de ejecución
    expect(ind['obv']).toBeUndefined(); // obv es de ejecución
    expect(ind['vwap_sesion']).toBeUndefined(); // vwap es de estructura/ejecución
  });

  it('estructura 4H (220 velas): ema20, vwap_sesion, mfi, macd', () => {
    const ind = computeLayerIndicators('4H', makeClosedCandles(220, now, 4 * HOUR), 78500);
    expect(ind['ema20']).toBeDefined();
    expect(ind['vwap_sesion']).toBeDefined();
    expect(ind['mfi']).toBeDefined();
    expect(ind['macd_linea']).toBeDefined();
    expect(ind['sma200']).toBeUndefined(); // sma200 es de contexto
    expect(ind['obv']).toBeUndefined();
  });

  it('ejecución 5m (120 velas): ema9, williamsR, roc, obv, vwap_sesion', () => {
    const ind = computeLayerIndicators('5m', makeClosedCandles(120, now, 5 * 60_000), 78500);
    expect(ind['ema9']).toBeDefined();
    expect(ind['williamsR']).toBeDefined();
    expect(ind['roc']).toBeDefined();
    expect(ind['obv']).toBeDefined();
    expect(ind['vwap_sesion']).toBeDefined();
    expect(ind['macd_linea']).toBeUndefined(); // macd no es de ejecución
    expect(ind['mfi']).toBeUndefined(); // mfi es de estructura
  });

  it('estructura 1H: ema20, vwap_sesion, mfi; sin obv/sma200', () => {
    const ind = computeLayerIndicators('1H', makeClosedCandles(220, now, HOUR), 78500);
    expect(ind['ema20']).toBeDefined();
    expect(ind['vwap_sesion']).toBeDefined();
    expect(ind['mfi']).toBeDefined();
    expect(ind['obv']).toBeUndefined();
    expect(ind['sma200']).toBeUndefined();
  });

  it('ejecución 15m: ema9, williamsR, roc, obv; sin macd/mfi', () => {
    const ind = computeLayerIndicators('15m', makeClosedCandles(120, now, 15 * 60_000), 78500);
    expect(ind['ema9']).toBeDefined();
    expect(ind['williamsR']).toBeDefined();
    expect(ind['roc']).toBeDefined();
    expect(ind['obv']).toBeDefined();
    expect(ind['vwap_sesion']).toBeDefined();
    expect(ind['macd_linea']).toBeUndefined();
    expect(ind['mfi']).toBeUndefined();
  });

  it('20) no indicador fuera de capa: contexto no tiene obv/vwap; ejecución no tiene macd', () => {
    const d1 = computeLayerIndicators('1D', makeClosedCandles(540, now, 24 * HOUR), 78500);
    const m5 = computeLayerIndicators('5m', makeClosedCandles(120, now, 5 * 60_000), 78500);
    expect(d1['obv']).toBeUndefined();
    expect(d1['vwap_sesion']).toBeUndefined();
    expect(m5['macd_linea']).toBeUndefined();
    expect(m5['sma200']).toBeUndefined();
  });

  it('historia insuficiente: no inventa (1M con 21 velas → sin sma50 ni macd)', () => {
    const ind = computeLayerIndicators('1M', makeClosedCandles(21, now, 30 * 24 * HOUR), 78500);
    expect(ind['sma50']).toBeUndefined();
    expect(ind['macd_linea']).toBeUndefined();
    expect(ind['rsi']).toBeDefined();
    expect(ind['superTrend_nivel']).toBeDefined();
  });

  it('valores redondeados y sin nulos (rsi con 1 decimal)', () => {
    const ind = computeLayerIndicators('1H', makeClosedCandles(220, now, HOUR), 78500);
    const rsi = ind['rsi'];
    expect(typeof rsi).toBe('number');
    expect(Number.isInteger((rsi as number) * 10)).toBe(true); // 1 decimal
  });
});
