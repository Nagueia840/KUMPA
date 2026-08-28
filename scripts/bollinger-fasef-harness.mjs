// HARNESS BOLLINGER FASE F — valida los 9 casos de la corrección conceptual
// (posición ≠ compresión) contra el source compilado (.verify).
import { computeBollingerBandwidthSeries, bandwidthPercentile, classifyBandwidthState, computeBollinger, MIN_BANDWIDTH_HISTORY } from '../.verify/data/indicators.js';
import { computeLayerIndicators } from '../.verify/data/layer-indicators.js';
import { buildSymbolSynthesis } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock } from '../.verify/utils/multitf.js';
import { ANALYTIC_INSTRUCTIONS } from '../.verify/config/personality.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;

/** Closes que oscilan con amplitud constante alrededor de `base` (bandwidth estable). */
function closesOsc(n, amp, base = 100) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const close = base + Math.sin(i / 3) * amp;
    out.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close, volume: 10 });
  }
  return out;
}
/** Closes cuya amplitud se estrecha 40 → 0.5 (bandwidth decreciente → contracción). */
function closesSqueezing(n, base = 100) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const amp = Math.max(0.5, 40 - (i / n) * 39.5);
    const close = base + Math.sin(i / 3) * amp;
    out.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close, volume: 10 });
  }
  return out;
}
/** Closes cuya amplitud crece 1 → 60 (bandwidth creciente → expansión). */
function closesExpanding(n, base = 100) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const amp = 1 + (i / (n - 1)) * 59;
    const close = base + Math.sin(i / 3) * amp;
    out.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close, volume: 10 });
  }
  return out;
}
function synWith(tf, cs, price) {
  const ind = computeLayerIndicators(tf, cs, price);
  let s = buildMultiTfSymbol('ETH', { price, fundingPct: '0.0200%', quoteAsset: 'USDT' });
  const b = { valido: true, status: 'ok', granularidad_bitget: tf, fuente: 'Bitget', velas_total: cs.length, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: price, indicadores_disponibles: [], no_disponible: [], indicadores: ind };
  s = attachTfBlock(s, tf, b);
  const syn = buildSymbolSynthesis(s);
  const vol = syn.timeframes[0].familias.find((f) => f.familia === 'VOLATILIDAD');
  return { ind, vol };
}

// 1) precio cerca de banda inferior + bandas ANCHAS → NO compresión
{
  const cs = closesOsc(120, 40);
  const bw = computeBollingerBandwidthSeries(cs);
  const pctil = bandwidthPercentile(bw);
  ok('1) bandas anchas → NO contracción', bw.length > MIN_BANDWIDTH_HISTORY && classifyBandwidthState(pctil) !== 'contraccion', `pctil=${pctil?.toFixed(1)} estado=${classifyBandwidthState(pctil)}`);
  const bb = computeBollinger(cs);
  ok('1b) precio 60 bajo la media (posición inferior)', 60 < bb.middle && bb.lower > 40, `media=${bb.middle.toFixed(1)} lower=${bb.lower.toFixed(1)}`);
}
// 2) precio cerca de banda superior + bandas ESTRECHAS → compresión posible
{
  const cs = closesSqueezing(120, 100);
  const bw = computeBollingerBandwidthSeries(cs);
  const pctil = bandwidthPercentile(bw);
  ok('2) bandas estrechas → contracción', classifyBandwidthState(pctil) === 'contraccion', `pctil=${pctil?.toFixed(1)}`);
  // Comparación RELATIVA (no umbral absoluto): el ancho actual es menor que el de
  // una serie de amplitud constante equivalente.
  const bb = computeBollinger(cs);
  const ref = computeBollinger(closesOsc(120, 40));
  ok('2b) ancho actual < ancho de serie con volatilidad estable', (bb.upper - bb.lower) < (ref.upper - ref.lower), `ancho=${(bb.upper - bb.lower).toFixed(2)} vs ref=${(ref.upper - ref.lower).toFixed(2)}`);
  // precio 103: posición superior (sobre la media) + contracción coexisten
  const { vol: vol2 } = synWith('1H', cs, 103);
  const txt2 = vol2.senales.join(' ');
  ok('2c) posición superior + contracción coexisten (independientes)', /banda superior|mitad superior/.test(txt2));
}
// 3) bandwidth decreciente → contracción
{
  const cs = closesSqueezing(120, 100);
  const pctil = bandwidthPercentile(computeBollingerBandwidthSeries(cs));
  ok('3) decreciente → contracción (pctil<25)', pctil !== null && pctil < 25 && classifyBandwidthState(pctil) === 'contraccion');
}
// 4) bandwidth creciente → expansión
{
  const cs = closesExpanding(120, 100);
  const pctil = bandwidthPercentile(computeBollingerBandwidthSeries(cs));
  ok('4) creciente → expansión (pctil>75)', pctil !== null && pctil > 75 && classifyBandwidthState(pctil) === 'expansion');
}
// 5) compresión NO asigna dirección
{
  const cs = closesSqueezing(120, 100);
  const { ind, vol } = synWith('1H', cs, 100);
  ok('5) bollinger_estado=contraccion', ind['bollinger_estado'] === 'contraccion');
  ok('5b) familia VOLATILIDAD neutral sin votos', vol.direccion === 'neutral' && vol.aFavor === 0 && vol.enContra === 0);
  ok('5c) señal de contracción NO dice dirección', !vol.senales.some((s) => /contracci[oó]n.*(alcista|bajista)|(alcista|bajista).*contracci[oó]n/i.test(s)));
}
// 6) historial insuficiente → no inventa
{
  const cs = closesOsc(30, 20);
  const bw = computeBollingerBandwidthSeries(cs);
  ok('6) serie corta → percentil null', bw.length < MIN_BANDWIDTH_HISTORY && bandwidthPercentile(bw) === null && classifyBandwidthState(bandwidthPercentile(bw)) === null);
  const ind = computeLayerIndicators('1H', cs, 100);
  ok('6b) capa no expone bollinger_estado', ind['bollinger_estado'] === undefined);
}
// 7) tocar banda inferior ≠ sobreventa
{
  const cs = closesOsc(120, 40);
  const { vol } = synWith('1H', cs, 60);
  const txt = vol.senales.join(' ');
  ok('7) señal menciona banda inferior sin sobreventa', /banda inferior/.test(txt) && !/sobreventa autom[áa]tica/.test(txt));
  ok('7b) sin voto bajista por posición', vol.aFavor === 0 && vol.enContra === 0);
}
// 8) tocar banda superior ≠ sobrecompra
{
  const cs = closesOsc(120, 40);
  const { vol } = synWith('1H', cs, 150);
  const txt = vol.senales.join(' ');
  ok('8) señal menciona banda superior sin sobrecompra', /banda superior/.test(txt) && !/sobrecompra autom[áa]tica/.test(txt));
  ok('8b) sin voto alcista por posición', vol.aFavor === 0 && vol.enContra === 0);
}
// 9) breakout requiere contexto
{
  const cs = closesOsc(120, 40);
  const { vol } = synWith('1H', cs, 160);
  const txt = vol.senales.join(' ');
  ok('9) breakout sin señal automática', /POSICIÓN|no breakout confirmado/.test(txt) && vol.aFavor === 0);
  ok('9b) prompt exige confirmación', /breakout confirmado/.test(ANALYTIC_INSTRUCTIONS));
}
// squeeze
{
  const cs = closesSqueezing(120, 100);
  const ind = computeLayerIndicators('1H', cs, 100);
  ok('S) squeeze expuesto (si/no)', ind['bollinger_squeeze'] !== undefined, `squeeze=${ind['bollinger_squeeze']}`);
}

console.log(`\nBOLLINGER: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
