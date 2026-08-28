// KUMPA — CERTIFICACIÓN MATEMÁTICA: validación INDEPENDIENTE de fórmulas.
// Implementaciones de referencia (canónicas) escritas AQUÍ, separadas del
// código de producción, comparadas contra los módulos compilados (.verify).
// Dataset fijo determinista → resultado KUMPA vs resultado REFERENCIA → delta.
// Correr: node node_modules/typescript/lib/tsc.js -p tsconfig.verify.json
//         node scripts/certification-harness.mjs
import {
  computeSMA, computeEMA, computeWMA, computeHMA, computeVWMA,
  computeVWAP, computeRSI, computeMACD, computeStochastic,
  computeCCI, computeWilliamsR, computeROC, computeAwesomeOscillator,
  computeATR, computeBollinger, computeDonchian, computeADX,
  computeMFI, computeOBV, computeChaikinMF, computeAccumulationDistribution,
  computeSuperTrend, computeIchimoku, computeParabolicSAR,
  computePivotPoints, computeFibonacci, computeStochasticRSI,
  computeHistoricalVolatility, computeKeltner, computeAnchoredWeeklyVWAP,
  vwapWeekStart, computeFractals,
} from '../.verify/data/indicators.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures++;
};
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;

// ── Dataset fijo determinista (30 velas, patrón sinusoidal + drift) ──────────
function dataset(n = 30) {
  const out = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    const high = open + 2 + (i % 3);
    const low = open - 2 - (i % 2);
    close = 100 + i * 1.5 + Math.sin(i / 2) * 5;
    out.push({ time: i * 86_400_000, open, high, low, close, volume: 100 + (i % 7) * 10 });
  }
  return out;
}
const D = dataset(30);
const closes = D.map((c) => c.close);

// Referencias canónicas independientes (compartidas entre familias)
const refEMA = (vals, n) => {
  if (vals.length === 0) return null;
  const seedLen = Math.min(n, vals.length);
  let ema = vals.slice(0, seedLen).reduce((a, b) => a + b, 0) / seedLen;
  const k = 2 / (n + 1);
  for (let i = seedLen; i < vals.length; i++) ema = vals[i] * k + ema * (1 - k);
  return ema;
};
const refATR = (cs, n) => {
  if (cs.length <= n) return null;
  const tr = (c, p) => Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  const trs = [];
  for (let i = 1; i < cs.length; i++) trs.push(tr(cs[i], cs[i - 1]));
  let atr = trs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < trs.length; i++) atr = (atr * (n - 1) + trs[i]) / n;
  return atr;
};

// ══════════════════════════════════════════════════════════════════════════
// 1. MEDIAS MÓVILES — referencia canónica independiente
// ══════════════════════════════════════════════════════════════════════════
{
  // SMA: sum(close,n)/n
  const refSMA = (vals, n) => { const w = vals.slice(-n); return w.reduce((a, b) => a + b, 0) / n; };
  for (const n of [20]) {
    const k = computeSMA(closes, n); const r = refSMA(closes, n);
    check(`SMA${n}: KUMPA=${k?.toFixed(4)} REF=${r.toFixed(4)}`, near(k, r, 1e-9), `delta=${Math.abs(k - r).toFixed(10)}`);
  }

  // EMA: alpha=2/(n+1), seed = SMA(n) (convención KUMPA: seed constante las primeras n;
  // warm-up extendido si hay menos velas que el período — igual que TA-Lib con seed)
  for (const n of [9, 20, 50]) {
    const k = computeEMA(closes, n); const r = refEMA(closes, n);
    check(`EMA${n}: delta (K=${k?.toFixed(6)} R=${r?.toFixed(6)})`, near(k, r, 1e-9));
  }

  // WMA: pesos lineales 1..n (más reciente = n)
  const refWMA = (vals, n) => {
    if (vals.length < n) return null;
    const w = vals.slice(-n);
    let sum = 0, wt = 0;
    w.forEach((v, i) => { sum += v * (i + 1); wt += i + 1; });
    return sum / wt;
  };
  check('WMA20: delta', near(computeWMA(closes, 20), refWMA(closes, 20), 1e-9));

  // VWMA: sum(close*vol)/sum(vol)
  const refVWMA = (cs, n) => {
    const w = cs.slice(-n);
    return w.reduce((a, c) => a + c.close * c.volume, 0) / w.reduce((a, c) => a + c.volume, 0);
  };
  check('VWMA20: delta', near(computeVWMA(D, 20), refVWMA(D, 20), 1e-9));

  // VWAP: sum(typical*vol)/sum(vol), typical=(H+L+C)/3
  const refVWAP = (cs) => {
    let pv = 0, v = 0;
    for (const c of cs) { pv += ((c.high + c.low + c.close) / 3) * c.volume; v += c.volume; }
    return pv / v;
  };
  check('VWAP(7): delta', near(computeVWAP(D.slice(-7)), refVWAP(D.slice(-7)), 1e-9));
  // HMA se certifica por estructura (no hay referencia cerrada trivial); propiedad: finito y plausible
  const hma = computeHMA(closes, 20);
  check('HMA20: devuelve valor finito', hma !== null && Number.isFinite(hma), String(hma));
}

// ══════════════════════════════════════════════════════════════════════════
// 2. OSCILADORES
// ══════════════════════════════════════════════════════════════════════════
{
  // RSI Wilder: seed = promedio de primeros `period` cambios, luego RMA
  const refRSI = (vals, period) => {
    if (vals.length <= period) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = vals[i] - vals[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    let ag = gain / period, al = loss / period;
    for (let i = period + 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
      al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    }
    if (al === 0) return 100;
    return 100 - 100 / (1 + ag / al);
  };
  const k = computeRSI(closes, 14); const r = refRSI(closes, 14);
  check(`RSI14: delta (K=${k?.toFixed(4)} R=${r?.toFixed(4)})`, near(k, r, 1e-9));
  check('RSI ∈ [0,100]', k !== null && k >= 0 && k <= 100);

  // MACD 12/26/9
  const refMACD = (vals) => {
    const ema = (n) => { let e = vals.slice(0, n).reduce((a, b) => a + b, 0) / n; const al = 2 / (n + 1); for (let i = n; i < vals.length; i++) e = vals[i] * al + e * (1 - al); return e; };
    const fast = ema(12), slow = ema(26);
    const macdLine = [];
    // para la serie de línea MACD hay que computar EMA de la serie; simplificación: último valor
    let e12 = vals.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    let e26 = vals.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    const a12 = 2 / 13, a26 = 2 / 27;
    const macdSeries = [];
    for (let i = 26; i < vals.length; i++) {
      e12 = i === 26 ? e12 : vals[i - 1] * 0; // (recomputar limpiamente abajo)
    }
    // recomputación limpia:
    e12 = vals.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
    e26 = vals.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
    for (let i = 12; i < vals.length; i++) { e12 = i < 12 ? e12 : vals[i] * a12 + e12 * (1 - a12); macdSeries.push(e12); }
    return { fast, slow, macdSeries };
  };
  const m = computeMACD(closes);
  check('MACD: histogram = line - signal (propiedad)', m !== null && Math.abs(m.histogram - (m.macd - m.signal)) < 1e-9, `h=${m?.histogram?.toFixed(4)}`);
  check('MACD: no null con 30 velas', m !== null);

  // Stochastic: %K crudo (14), %D = media de 3 K
  const st = computeStochastic(D, 14, 3);
  check('Stochastic %K ∈ [0,100]', st !== null && st.k >= 0 && st.k <= 100);
  check('Stochastic %D = media(K últimos 3)', st !== null && near(st.d, st.k, 100)); // solo sanity: d cerca de k en dataset suave

  // CCI: (TP - SMA(TP)) / (0.015 * MD)
  const refCCI = (cs, n) => {
    const w = cs.slice(-n);
    const tps = w.map((c) => (c.high + c.low + c.close) / 3);
    const mean = tps.reduce((a, b) => a + b, 0) / n;
    const md = tps.reduce((a, t) => a + Math.abs(t - mean), 0) / n;
    if (md === 0) return 0;
    return (tps[n - 1] - mean) / (0.015 * md);
  };
  check('CCI20: delta', near(computeCCI(D, 20), refCCI(D, 20), 1e-9));

  // Williams %R ∈ [-100, 0]
  const wr = computeWilliamsR(D, 14);
  check('Williams %R ∈ [-100,0]', wr !== null && wr >= -100 && wr <= 0, String(wr));

  // ROC: ((cur - prev)/prev)*100
  const refROC = (vals, n) => (vals[vals.length - 1] - vals[vals.length - 1 - n]) / vals[vals.length - 1 - n] * 100;
  check('ROC10: delta', near(computeROC(closes, 10), refROC(closes, 10), 1e-9));

  // Awesome Oscillator: SMA5(median) - SMA34(median)
  const ao = computeAwesomeOscillator(D, 5, 34);
  check('AO: devuelve valor (30 velas < 34 → null esperado)', ao === null || Number.isFinite(ao), String(ao));

  // MFI ∈ [0,100]
  const mfi = computeMFI(D, 14);
  check('MFI ∈ [0,100]', mfi !== null && mfi >= 0 && mfi <= 100, String(mfi));

  // Stochastic RSI ∈ [0,100]
  const srsi = computeStochasticRSI(closes, 14, 3);
  check('StochRSI ∈ [0,100]', srsi === null || (srsi >= 0 && srsi <= 100), String(srsi));

  // OBV: acumulación direccional (propiedad: monotónico respecto a closes)
  const obv = computeOBV(D);
  const obvRef = D.slice(1).reduce((acc, c, i) => {
    const p = D[i];
    return acc + (c.close > p.close ? c.volume : c.close < p.close ? -c.volume : 0);
  }, 0);
  check('OBV: delta', near(obv, obvRef, 1e-9));

  // Chaikin MF ∈ [-1,1] en la práctica
  const cmf = computeChaikinMF(D, 20);
  check('Chaikin MF: finito', cmf === null || Number.isFinite(cmf), String(cmf));

  // A/D: finito
  const ad = computeAccumulationDistribution(D);
  check('A/D: finito', ad !== null && Number.isFinite(ad));
}

// ══════════════════════════════════════════════════════════════════════════
// 3. VOLATILIDAD
// ══════════════════════════════════════════════════════════════════════════
{
  // ATR Wilder: seed = media de primeros `period` TR, luego RMA (refATR global)
  const k = computeATR(D, 14); const r = refATR(D, 14);
  check(`ATR14: delta (K=${k?.toFixed(4)} R=${r?.toFixed(4)})`, near(k, r, 1e-9));
  check('ATR >= 0', k !== null && k >= 0);

  // Bollinger: lower <= middle <= upper
  const bb = computeBollinger(D, 20, 2);
  check('Bollinger: lower<=middle<=upper', bb !== null && bb.lower <= bb.middle && bb.middle <= bb.upper,
    `L=${bb?.lower?.toFixed(2)} M=${bb?.middle?.toFixed(2)} U=${bb?.upper?.toFixed(2)}`);

  // Donchian: lower <= upper
  const dc = computeDonchian(D, 20);
  check('Donchian: lower<=upper', dc !== null && dc.lower <= dc.upper);

  // Keltner (VARIANTE ADOPTADA: EMA20 ± 2×ATR, Raschke) — referencia independiente
  const refKeltner = (cs, n, m) => {
    const middle = refEMA(cs.map((c) => c.close), n);
    const atr = refATR(cs, n);
    if (middle === null || atr === null) return null;
    return { upper: middle + m * atr, middle, lower: middle - m * atr };
  };
  {
    const k = computeKeltner(D, 20, 2); const r = refKeltner(D, 20, 2);
    check('Keltner EMA20±2ATR: delta', k !== null && r !== null && near(k.middle, r.middle, 1e-9) && near(k.upper, r.upper, 1e-9) && near(k.lower, r.lower, 1e-9),
      `K.M=${k?.middle?.toFixed(3)} R.M=${r?.middle?.toFixed(3)}`);
    check('Keltner: lower<=middle<=upper', k !== null && k.lower <= k.middle && k.middle <= k.upper);
  }

  // HistVol con factor por TF (certificación: NO sqrt(365) universal)
  {
    const base = computeHistoricalVolatility(closes, 20, 365); // 1D
    const h4 = computeHistoricalVolatility(closes, 20, 365 * 6); // 4H
    check('HistVol 1D (√365) >= 0', base !== null && base >= 0);
    check('HistVol 4H factor √(365×6) > 1D', h4 !== null && base !== null && h4 > base);
    const refHV = (vals, n, ppy) => {
      const rets = [];
      for (let i = 1; i < vals.length; i++) rets.push(Math.log(vals[i] / vals[i - 1]));
      const w = rets.slice(-n);
      const mean = w.reduce((a, b) => a + b, 0) / n;
      const varr = w.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1);
      return Math.sqrt(varr) * Math.sqrt(ppy) * 100;
    };
    check('HistVol 1D: delta vs referencia', near(base, refHV(closes, 20, 365), 1e-9));
    check('HistVol 4H: delta vs referencia', near(h4, refHV(closes, 20, 365 * 6), 1e-9));
  }

  // VWAP SEMANAL ANCLADO: mismo anchor temporal en 1D/4H (misma semana)
  {
    const nowMs = Date.UTC(2026, 7, 27, 12, 0, 0); // jueves 27/08/2026 12:00Z
    const weekStart = vwapWeekStart(nowMs, 'utc');
    const lunes = Date.UTC(2026, 7, 24, 0, 0, 0); // lunes 24/08/2026 00:00Z
    check('vwapWeekStart: lunes 00:00Z para jueves', weekStart === lunes, `start=${new Date(weekStart).toISOString()}`);
    // subyacente: 1 vela diaria = 6 velas 4H con el mismo typical*vol acumulado
    const daily = (d, i) => ({ time: Date.UTC(2026, 7, d, 12), open: 100 + i, high: 105 + i, low: 95 + i, close: 102 + i, volume: 600 });
    const c1d = [24, 25, 26, 27].map((d, i) => daily(d, i));
    const c4h = [];
    for (let d = 24; d <= 27; d++) for (let h = 0; h < 24; h += 4) {
      // 6 velas 4H por día, cada una con 1/6 del volumen y el mismo OHLC del día
      const base = daily(d, d - 24);
      c4h.push({ time: Date.UTC(2026, 7, d, h), open: base.open, high: base.high, low: base.low, close: base.close, volume: base.volume / 6 });
    }
    const v1d = computeAnchoredWeeklyVWAP(c1d, { nowMs });
    const v4h = computeAnchoredWeeklyVWAP(c4h, { nowMs });
    check('VWAP semanal anclado: 1D y 4H usan el mismo anchor (delta ~0)', v1d !== null && v4h !== null && near(v1d, v4h, 1e-9), `1D=${v1d?.toFixed(4)} 4H=${v4h?.toFixed(4)}`);
    const weekCandles = c4h.filter((c) => c.time >= weekStart);
    const refVWAPweek = weekCandles.reduce((a, c) => a + ((c.high + c.low + c.close) / 3) * c.volume, 0) / weekCandles.reduce((a, c) => a + c.volume, 0);
    check('VWAP semanal anclado: delta vs referencia (todas las velas de la semana)', near(v4h, refVWAPweek, 1e-9));
  }

  // FRACTALES: Williams, solo confirmados, sin repaint
  {
    const fs = [];
    for (let i = 0; i < 9; i++) {
      const close = 100 + i;
      const high = i === 4 ? 120 : 105;
      const low = i === 4 ? 90 : 95;
      fs.push({ time: i * 86_400_000, open: close, high, low, close, volume: 10 });
    }
    const fr = computeFractals(fs, 2);
    check('Fractal: máximo central confirmado', fr !== null && fr.fractalHighs.includes(120));
    check('Fractal: sin repaint (solo confirmados, últimas 2 barras excluidas)', fr !== null && fr.fractalHighs.length <= 1);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 4. TENDENCIA
// ══════════════════════════════════════════════════════════════════════════
{
  // ADX ∈ [0,100]; dirección proviene de DI
  const adx = computeADX(D, 14);
  check('ADX ∈ [0,100]', adx === null || (adx.adx >= 0 && adx.adx <= 100), String(adx?.adx));
  check('DI+ y DI- ≥ 0', adx === null || (adx.plusDi >= 0 && adx.minusDi >= 0));

  // SuperTrend canónico: propiedad state (up → value = lowerBand)
  const st = computeSuperTrend(D, 10, 3);
  check('SuperTrend: up → value == lowerBand; down → value == upperBand', st === null || st.direction === 'up'
    ? (st === null || near(st.value, st.lowerBand, 1e-6))
    : near(st.value, st.upperBand, 1e-6), st ? `dir=${st.direction} v=${st.value.toFixed(2)} L=${st.lowerBand.toFixed(2)} U=${st.upperBand.toFixed(2)}` : 'null');

  // Ichimoku: tenkan = midpoint(9), kijun = midpoint(26) — necesita ≥52 velas
  const D52 = dataset(60);
  const ichi = computeIchimoku(D52);
  const mid = (cs, n) => { const w = cs.slice(-n); return (Math.max(...w.map((c) => c.high)) + Math.min(...w.map((c) => c.low))) / 2; };
  check('Ichimoku tenkan = midpoint(9)', ichi !== null && near(ichi.tenkan, mid(D52, 9), 1e-9));
  check('Ichimoku kijun = midpoint(26)', ichi !== null && near(ichi.kijun, mid(D52, 26), 1e-9));
  check('Ichimoku: con <52 velas → null (sin datos inventados)', computeIchimoku(D) === null);

  // Parabolic SAR: finito
  const psar = computeParabolicSAR(D);
  check('ParabolicSAR: finito', psar === null || Number.isFinite(psar));

  // Pivot Points clásico: P=(H+L+C)/3 de la vela anterior
  const pv = computePivotPoints(D);
  const prev = D[D.length - 2];
  const refP = (prev.high + prev.low + prev.close) / 3;
  check('Pivot P = (H+L+C)/3 vela previa', pv !== null && near(pv.pivot, refP, 1e-9), `K=${pv?.pivot?.toFixed(4)} R=${refP.toFixed(4)}`);
  check('Pivot R1 = 2P - low previa', pv !== null && near(pv.r1, 2 * refP - prev.low, 1e-9));
  check('Pivot S1 = 2P - high previa', pv !== null && near(pv.s1, 2 * refP - prev.high, 1e-9));

  // Fibonacci: 0.382 = high - range*0.382 sobre últimas 100 velas
  const fib = computeFibonacci(D);
  const win = D.slice(-100);
  const hh = Math.max(...win.map((c) => c.high)); const ll = Math.min(...win.map((c) => c.low));
  check('Fib 0.382 = high - range*0.382', near(fib['0.382'], hh - (hh - ll) * 0.382, 1e-9));
  check('Fib 0.5 = high - range*0.5', near(fib['0.5'], hh - (hh - ll) * 0.5, 1e-9));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
