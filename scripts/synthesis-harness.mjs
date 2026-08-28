// HARNESS FASE F — Síntesis analítica + respuesta local (fixtures coherentes).
// Prueba controlada equivalente a "Analizame ETH ahora" SIN precios reales:
// series con tendencia/ciclos por TF que permiten demostrar jerarquía:
//   macro (1W) alcista → diario (1D) con pullback → 4H perdiendo momentum
//   → 1H/15m recuperando → derivados con funding positivo calibrado.
// Correr: tsc -p tsconfig.verify.json && node scripts/synthesis-harness.mjs
import { buildMultiTfSymbol, attachTfBlock, buildMultiTfContext } from '../.verify/utils/multitf.js';
import { buildSymbolSynthesis, formatSynthesis, readDerivados } from '../.verify/agents/synthesis.js';
import { computeLayerIndicators } from '../.verify/data/layer-indicators.js';

const HOUR = 3_600_000;
const now = Date.now();
const nowAnchor = Math.floor(now / HOUR) * HOUR;

/** Serie de precios con tendencia + onda: permite lecturas diferenciadas por TF. */
function series(n, step, base, driftPerStep, amp, phase) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * step;
    const trend = base + i * driftPerStep;
    const wave = Math.sin(i / 4 + phase) * amp;
    const close = trend + wave;
    out.push({ time: t, open: close - 6, high: close + 18, low: close - 14, close, volume: 100 + (i % 5) * 20 });
  }
  return out;
}

function block(tf, n, step, seriesFn, base) {
  const cs = seriesFn(n, step, base);
  const closes = cs.map((c) => c.close);
  const price = closes[closes.length - 1];
  const ind = computeLayerIndicators(tf, cs, price);
  const b = {
    valido: true, status: 'ok', granularidad_bitget: tf, fuente: 'Bitget',
    velas_total: n, ultima_vela_estado: 'closed', ultima_vela_ts_ms: cs[cs.length - 1].time,
    cierre_ultima_cerrada: price, indicadores_disponibles: [], no_disponible: [],
    indicadores: ind,
  };
  const stDir = ind['superTrend_direccion'];
  if (stDir === 'up') b.superTrend_rol = 'soporte';
  else if (stDir === 'down') b.superTrend_rol = 'resistencia';
  return b;
}

// Fixture con JERARQUÍA (el caso conceptual del requerimiento):
// 1W: tendencia alcista sostenida (drift +4/semana, onda chica)
// 1D: alcista pero con pullback reciente (drift +1, onda grande negativa al final)
// 4H: perdiendo momentum (drift -0.4, onda negativa)
// 1H: recuperando (drift +0.3, onda positiva reciente)
// 15m: timing alcista corto (drift +0.1, onda positiva)
let s = buildMultiTfSymbol('ETH', { price: 2495, fundingPct: '0.0200%', quoteAsset: 'USDT' });
s = attachTfBlock(s, '1W', block('1W', 78, 7 * 24 * HOUR, (n, step, base) => series(n, step, base, 4, 25, 0), 2200));
s = attachTfBlock(s, '1D', block('1D', 220, 24 * HOUR, (n, step, base) => series(n, step, base, 1.2, 40, 2.2), 2400));
s = attachTfBlock(s, '4H', block('4H', 220, 4 * HOUR, (n, step, base) => series(n, step, base, -0.5, 18, 3.1), 2510));
s = attachTfBlock(s, '1H', block('1H', 220, HOUR, (n, step, base) => series(n, step, base, 0.4, 10, 5.5), 2488));
s = attachTfBlock(s, '15m', block('15m', 120, 15 * 60_000, (n, step, base) => series(n, step, base, 0.15, 4, 7), 2490));

const syn = buildSymbolSynthesis(s);
if (!syn) { console.log('FALLO: síntesis null'); process.exit(1); }

console.log('=== SÍNTESIS ESTRUCTURADA (ETH, quote USDT) ===');
console.log(formatSynthesis(syn));
console.log('\n=== FAMILIAS POR TF (detalle) ===');
for (const r of syn.timeframes) {
  console.log(`\n[${r.tf} ${r.capa}] ${r.direccion}`);
  for (const f of r.familias) {
    if (f.senales.length === 0) continue;
    console.log(`  ${f.familia} (${f.direccion} aFavor=${f.aFavor} enContra=${f.enContra}):`);
    for (const sgn of f.senales) console.log(`    · ${sgn}`);
  }
  if (r.niveles.length) console.log(`  Niveles: ${r.niveles.join(' | ')}`);
}

console.log('\n=== DERIVADOS (funding calibrado — defecto E) ===');
console.log(readDerivados(s).senales.join('\n'));

// Verificaciones deterministas de la síntesis
const checks = [
  ['régimen definido (1W/1D)', syn.regimen !== 's/d'],
  ['estructura definida (4H/1H)', syn.estructura !== 's/d'],
  ['timing definido (15m/5m)', syn.ejecucion !== 's/d'],
  ['niveles con unidad USDT', syn.timeframes.some((r) => r.niveles.some((n) => n.includes('USDT')))],
  ['hay confluencias', syn.timeframes.some((r) => r.confluencias.length > 0)],
  ['contradicciones visibles (no ocultas)', syn.timeframes.some((r) => r.contradicciones.length > 0) || syn.contradiccionesInterTf.length > 0],
  ['funding calibrado (longs pagan shorts)', /longs pagan shorts/.test(readDerivados(s).senales.join(' '))],
  ['funding NO afirma presión compradora (dice que NO la demuestra)', /NO presi[oó]n compradora/.test(readDerivados(s).senales.join(' '))],
  ['SuperTrend en español (alcista/bajista, no up/down crudo)', !/superTrend (up|down)/i.test(formatSynthesis(syn))],
  ['lectura global sintetiza jerarquía', syn.lecturaGlobal.length > 10],
];
console.log('\n=== CHECKS ===');
let fails = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) fails++; }

// ── RESPUESTA LOCAL (prueba controlada; el LLM real la redacta en producción).
// Demuestra que el pipeline entrega TODO lo que la respuesta final necesita:
// macro, estructura, momentum, volumen, volatilidad, derivados, niveles,
// escenarios con triggers e invalidaciones, y riesgo — con unidades correctas.
console.log('\n=== RESPUESTA LOCAL (pipeline → síntesis → lectura analítica) ===');
const nivel = (r, i) => r.niveles[i] ?? '—';
const tf = (t) => syn.timeframes.find((r) => r.tf === t);
const r1w = tf('1W'); const r1d = tf('1D'); const r4h = tf('4H'); const r1h = tf('1H'); const r15m = tf('15m');
console.log(`ETH (USDT) — lectura local basada en la síntesis determinista:

Régimen (1W/1D): ${syn.regimen}. La tendencia semanal sigue ${r1w?.direccion ?? 's/d'} con SuperTrend ${r1w?.confluencias.includes('TENDENCIA') ? 'alcista' : 'mixto'}; el diario muestra un pullback (momentum ${r1d ? r1d.contradicciones.includes('MOMENTUM') ? 'enfriándose' : 'alineado' : 's/d'}). Zonas de valor semanales: ${r1w?.niveles.slice(0, 2).join(' · ') ?? '—'}.

Estructura 4H/1H: ${syn.estructura}. El 4H ${r4h ? (r4h.direccion === 'bajista' ? 'está perdiendo momentum (contradice al régimen)' : r4h.direccion) : 's/d'}; el 1H ${r1h ? (r1h.direccion === 'alcista' ? 'recupera' : r1h.direccion) : 's/d'}. Niveles: ${r4h?.niveles.slice(0, 3).join(' · ') ?? '—'}.

Timing 15m/5m: ${syn.ejecucion}. La ejecución corta ${r15m ? (r15m.direccion === 'alcista' ? 'acompaña la recuperación de 1H' : 'todavía no confirma') : 's/d'}.

Volumen: ${r1h?.familias.find((f) => f.familia === 'VOLUMEN')?.senales.join('; ') || 's/d'}.
Volatilidad: ${r1d?.familias.find((f) => f.familia === 'VOLUMEN') ? '' : ''}${r1d?.familias.find((f) => f.familia === 'VOLATILIDAD')?.senales.join('; ') || 's/d'}.
Derivados: ${readDerivados(s).senales.join('; ') || 's/d'}.

Escenarios:
• Alcista: el régimen semanal se mantiene y el 1H recupera por encima de ${r1h?.niveles[2] ?? '—'}; trigger: cierre 4H sobre ${r4h?.niveles[2] ?? '—'}.
• Bajista: si el pullback diario profundiza y el 4H rompe ${r4h?.niveles[0] ?? '—'}; invalidación del alcista: cierre diario bajo ${r1d?.niveles[0] ?? '—'}.
• Lateral: entre ${r1d?.niveles[0] ?? '—'} y ${r1d?.niveles[2] ?? '—'} mientras el momentum no se defina.

Riesgo principal: la contradicción entre el régimen alcista y el momentum intermedio bajista — el timing aún no confirma entrada. Sin datos de premium/OI en esta prueba, el cuadro de posicionamiento queda parcial.`);
console.log('\nHARNESS OK' + (fails === 0 ? ' (0 fallos)' : ` (${fails} FALLOS)`));
if (fails > 0) process.exit(1);
