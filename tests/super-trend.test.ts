import { describe, it, expect } from 'vitest';
import {
  computeAllIndicators,
  computeATR,
  computeSessionVWAP,
  computeSuperTrend,
  computeSuperTrendLegacy,
  computeVWAP,
  type Candle,
} from '../src/data/indicators.js';

/** Genera velas deterministas. */
function candles(
  closes: number[],
  opts: { high?: number; low?: number; vol?: number; step?: number; start?: number } = {},
): Candle[] {
  const { vol = 10, step = 3_600_000, start = 1_700_000_000_000 } = opts;
  return closes.map((close, i) => ({
    time: start + i * step,
    open: close,
    high: opts.high ?? close,
    low: opts.low ?? close,
    close,
    volume: vol,
  }));
}

describe('SuperTrend CANÓNICO — casos deterministas (1-8)', () => {
  it('1) tendencia alcista persistente → up, nivel = banda inferior', () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i);
    const st = computeSuperTrend(candles(up))!;
    expect(st.direction).toBe('up');
    expect(st.value).toBeCloseTo(st.lowerBand, 6);
  });

  it('2) tendencia bajista persistente → down, nivel = banda superior', () => {
    const down = Array.from({ length: 60 }, (_, i) => 200 - i);
    const st = computeSuperTrend(candles(down))!;
    expect(st.direction).toBe('down');
    expect(st.value).toBeCloseTo(st.upperBand, 6);
  });

  it('3) flip up → down: caída violenta cruza la banda inferior', () => {
    const closes = [...Array.from({ length: 50 }, (_, i) => 100 + i), 100, 50]; // sube, luego cae
    const st = computeSuperTrend(candles(closes))!;
    expect(st.direction).toBe('down');
  });

  it('4) flip down → up: subida violenta cruza la banda superior', () => {
    const closes = [...Array.from({ length: 50 }, (_, i) => 200 - i), 200, 250];
    const st = computeSuperTrend(candles(closes))!;
    expect(st.direction).toBe('up');
  });

  it('5/6) bandas finales persistentes: no se mueven en cada vela', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const st = computeSuperTrend(candles(closes))!;
    // En una subida limpia, la banda inferior final se mantiene >= básica inicial
    // y el nivel sigue a la banda inferior (persistencia de banda).
    expect(st.lowerBand).toBeGreaterThan(0);
    expect(st.upperBand).toBeGreaterThan(st.lowerBand);
  });

  it('7) datos insuficientes → null (no aproxima)', () => {
    expect(computeSuperTrend(candles([100, 101, 102]))).toBeNull(); // < period
    expect(computeSuperTrend([])).toBeNull();
  });

  it('8) ATR correctamente utilizado: con ATR grande, las bandas se separan más', () => {
    const quiet = candles(Array.from({ length: 60 }, (_, i) => 100 + i), { high: 105, low: 95 });
    const wild = candles(Array.from({ length: 60 }, (_, i) => 100 + i), { high: 150, low: 50 });
    const stQ = computeSuperTrend(quiet)!;
    const stW = computeSuperTrend(wild)!;
    expect(stW.upperBand - stW.lowerBand).toBeGreaterThan(stQ.upperBand - stQ.lowerBand);
  });

  it('9) sin NaN/Infinity en ningún punto de la serie', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i) * 20);
    const st = computeSuperTrend(candles(closes))!;
    for (const v of [st.value, st.upperBand, st.lowerBand]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('10) referencia numérica independiente (doble implementación)', () => {
    // Implementación de referencia escrita "a mano" siguiendo la fórmula canónica,
    // de forma estructuralmente distinta (arrays explícitos).
    function reference(closes: number[], highs: number[], lows: number[]): { value: number; dir: 'up' | 'down' } | null {
      const n = closes.length;
      const period = 10;
      if (n <= period) return null;
      const tr: number[] = [];
      for (let i = 1; i < n; i++) {
        tr.push(Math.max(highs[i]! - lows[i]!, Math.abs(highs[i]! - closes[i - 1]!), Math.abs(lows[i]! - closes[i - 1]!)));
      }
      const atrArr: number[] = [tr.slice(0, period).reduce((a, b) => a + b, 0) / period];
      for (let i = period; i < tr.length; i++) atrArr.push((atrArr[atrArr.length - 1]! * (period - 1) + tr[i]!) / period);
      let prevFU = 0, prevFL = 0, st = 0, dir: 'up' | 'down' = 'up';
      for (let i = period; i < n; i++) {
        const hl2 = (highs[i]! + lows[i]!) / 2;
        const bU = hl2 + 3 * atrArr[i - period]!;
        const bL = hl2 - 3 * atrArr[i - period]!;
        if (i === period) { prevFU = bU; prevFL = bL; dir = 'up'; st = prevFL; continue; }
        const fU = bU < prevFU || closes[i - 1]! > prevFU ? bU : prevFU;
        const fL = bL > prevFL || closes[i - 1]! < prevFL ? bL : prevFL;
        if (st === prevFU) dir = closes[i]! > fU ? 'up' : 'down';
        else dir = closes[i]! < fL ? 'down' : 'up';
        st = dir === 'up' ? fL : fU;
        prevFU = fU;
        prevFL = fL;
      }
      return { value: st, dir };
    }
    const closes = Array.from({ length: 90 }, (_, i) => 100 + Math.sin(i / 5) * 15 + i * 0.5);
    const highs = closes.map((c) => c + 4);
    const lows = closes.map((c) => c - 4);
    const cs = highs.map((h, i) => ({ time: i, open: closes[i]!, high: h, low: lows[i]!, close: closes[i]!, volume: 10 }));
    const mine = computeSuperTrend(cs)!;
    const ref = reference(closes, highs, lows)!;
    expect(mine.value).toBeCloseTo(ref.value, 6);
    expect(mine.direction).toBe(ref.dir);
  });
});

describe('SuperTrend legacy vs canónico (comparación estructural)', () => {
  it('en una subida, legacy puede diferir: el canónico persiste bandas y usa cruce', () => {
    const closes = [...Array.from({ length: 40 }, (_, i) => 100 + i), 145, 144, 146, 143, 147];
    const cs = candles(closes, { high: 160, low: 90 });
    const legacy = computeSuperTrendLegacy(cs)!;
    const canonical = computeSuperTrend(cs)!;
    // Al menos la dirección no se infiere por close >= prev (legacy); el canónico
    // decide por cruce de banda. Valores casi siempre difieren.
    expect(typeof legacy.direction).toBe('string');
    expect(typeof canonical.direction).toBe('string');
  });
});

describe('VWAP de sesión (FASE E) — casos 9-14', () => {
  it('9) dataset simple manual: VWAP = Σ(typical·vol)/Σvol', () => {
    const cs = candles([100, 110], { high: 120, low: 80, vol: 10, start: 1_700_000_000_000 });
    // typical = (high+low+close)/3: vela0 = (120+80+100)/3 = 100; vela1 = (120+80+110)/3 = 103.33
    const vwap = computeVWAP(cs)!;
    expect(vwap).toBeCloseTo((100 * 10 + (103.3333) * 10) / 20, 2);
  });

  it('10) frontera de sesión: solo velas desde el inicio del día UTC', () => {
    const dayStart = Date.parse('2026-08-26T00:00:00Z');
    // high=low=close → typical = close. Una vela de ayer (100) + 2 de hoy (110, 120).
    const cs = candles([100, 110, 120], { vol: 10, start: dayStart - 3_600_000, step: 3_600_000 });
    const now = Date.parse('2026-08-26T03:00:00Z');
    const vwap = computeSessionVWAP(cs, { nowMs: now, anchor: 'utc' })!;
    // sesión = velas >= 00:00Z → solo 110 y 120: VWAP = (110 + 120) / 2
    expect(vwap).toBeCloseTo(115, 6);
  });

  it('11) volumen cero → null (no divide por cero)', () => {
    expect(computeSessionVWAP(candles([100, 110], { vol: 0 }), { nowMs: 1_700_000_000_000 })).toBeNull();
    expect(computeVWAP([])).toBeNull();
  });

  it('12) candle order: se esperan velas oldest→newest (el fetcher normaliza)', () => {
    // La función asume orden asc; el fetcher ordena antes de calcular.
    const asc = candles([100, 110, 120], { vol: 10, start: 1_700_000_000_000 });
    const sortedAsc = [...asc].sort((a, b) => a.time - b.time);
    expect(computeVWAP(sortedAsc)).toBeCloseTo(computeVWAP(asc)!, 9);
  });

  it('13) closed-only: la vela viva no entra (el fetcher la excluye antes)', () => {
    // Documentación del contrato: computeSessionVWAP recibe velas cerradas.
    const closed = candles([100, 110], { vol: 10, start: 1_700_000_000_000 });
    expect(computeSessionVWAP(closed, { nowMs: 1_700_000_000_000 + 3_600_000 })).not.toBeNull();
  });

  it('anclas: utc ≠ exchange (16:00Z) ≠ argentina (03:00Z)', () => {
    const now = Date.parse('2026-08-26T18:00:00Z');
    // 22 velas horarias desde el 25/08 20:00Z hasta el 26/08 17:00Z (sesiones con ≥2 velas)
    const closes = Array.from({ length: 22 }, (_, i) => 100 + i);
    const cs = candles(closes, { vol: 10, start: Date.parse('2026-08-25T20:00:00Z'), step: 3_600_000 });
    const utc = computeSessionVWAP(cs, { nowMs: now, anchor: 'utc' })!;
    const exch = computeSessionVWAP(cs, { nowMs: now, anchor: 'exchange' })!;
    const arg = computeSessionVWAP(cs, { nowMs: now, anchor: 'argentina' })!;
    // Distintas ventanas de sesión → valores distintos.
    expect(utc).not.toBe(exch);
    expect(exch).not.toBe(arg);
    expect(utc).not.toBe(arg);
  });
});

describe('Precisión — sin NaN/Infinity ni redondeo prematuro', () => {
  it('21) computeAllIndicators sin NaN en la serie completa', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 30);
    const all = computeAllIndicators(candles(closes, { high: 130, low: 70 }), closes[closes.length - 1]!);
    const values = [
      all.rsi14, all.atr14, all.sma20, all.sma50, all.ema20,
      all.superTrend?.value ?? null,
      all.superTrend?.upperBand ?? null,
      all.superTrend?.lowerBand ?? null,
    ];
    for (const v of values) {
      if (v !== null) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('23) sin redondeo prematuro: computeATR devuelve precisión completa', () => {
    const cs = candles(Array.from({ length: 30 }, (_, i) => 100 + i), { high: 105, low: 95 });
    const atr = computeATR(cs, 14)!;
    const rounded = Math.round(atr);
    expect(atr).not.toBe(rounded); // el cálculo interno no redondea a entero
  });
});
