// HARNESS CIERRE FASE F — Niveles multi-TF (T15) + MFI calibrado (T16).
// Replica la lógica de los tests nuevos contra .verify.
import { buildSymbolSynthesis, formatSynthesis, readDerivados } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock, buildMultiTfContext } from '../.verify/utils/multitf.js';
import { computeLayerIndicators } from '../.verify/data/layer-indicators.js';
import { ANALYTIC_INSTRUCTIONS } from '../.verify/config/personality.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;

function mkCandles(n, endTs, step, close = 101, vol = 10) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push({ time: t, open: close - 10, high: close + 30, low: close - 20, close, volume: vol });
  }
  return out;
}
function mkMfiCandles(n, pctSube, base = 100) {
  const out = [];
  let prev = base;
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const sube = (i % 100) < pctSube;
    const close = sube ? prev + 1 : prev - 1;
    out.push({ time: t, open: prev, high: Math.max(prev, close) + 1, low: Math.min(prev, close) - 1, close, volume: 10 });
    prev = close;
  }
  return out;
}
function closesOsc(n, amp, base = 100) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const close = base + Math.sin(i / 3) * amp;
    out.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close, volume: 10 });
  }
  return out;
}
function tfBlock(tf, cs, price) {
  const ind = computeLayerIndicators(tf, cs, price);
  const b = { valido: true, status: 'ok', granularidad_bitget: tf, fuente: 'Bitget', velas_total: cs.length, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: price, indicadores_disponibles: [], no_disponible: [], indicadores: ind };
  const stDir = ind['superTrend_direccion'];
  if (stDir === 'up') b.superTrend_rol = 'soporte';
  else if (stDir === 'down') b.superTrend_rol = 'resistencia';
  return b;
}
function ethMulti() {
  let s = buildMultiTfSymbol('ETH', { price: 2495, fundingPct: '0.0200%', quoteAsset: 'USDT' });
  s = attachTfBlock(s, '1W', tfBlock('1W', mkCandles(78, nowAnchor, 7 * 24 * HOUR, 2380), 2380));
  s = attachTfBlock(s, '1D', tfBlock('1D', mkCandles(220, nowAnchor, 24 * HOUR, 2495), 2495));
  s = attachTfBlock(s, '4H', tfBlock('4H', mkCandles(220, nowAnchor, 4 * HOUR, 2505), 2505));
  s = attachTfBlock(s, '1H', tfBlock('1H', mkCandles(220, nowAnchor, HOUR, 2488), 2488));
  s = attachTfBlock(s, '15m', tfBlock('15m', mkCandles(120, nowAnchor, 15 * 60_000, 2492), 2492));
  return s;
}

// ── T15: NIVELES MULTI-TF ────────────────────────────────────────────────────
const syn15 = buildSymbolSynthesis(ethMulti());
ok('T15 niveles presentes en todos los TF', syn15.timeframes.every((r) => r.niveles.length > 0));
ok('T15 cada nivel lleva su TF (formato "R1 1H: ...")', syn15.timeframes.every((r) => r.niveles.every((n) => n.includes(`${r.tf}:`) && /USDT|USD|USDC/.test(n))));
let unTfOk = true;
for (const r of syn15.timeframes) for (const n of r.niveles) {
  const tfs = ['1W','1D','4H','1H','15m','5m'].filter((tf) => new RegExp(`\\b${tf}:`).test(n));
  if (tfs.length !== 1) unTfOk = false;
}
ok('T15 ningún nivel mezcla dos TF', unTfOk);
const txt15 = formatSynthesis(syn15);
ok('T15 niveles con TF en la lectura', /\b(?:R1|S1|R2|S2|VWAP|SuperTrend|Banda inf|Banda sup|Fib)\s+(?:1W|1D|4H|1H|15m|5m):/.test(txt15));
console.log('\n--- muestra de niveles multi-TF ---');
for (const r of syn15.timeframes) console.log(`  ${r.tf}: ${r.niveles.slice(0, 3).join(' | ')}`);

// ── T16: MFI CALIBRADO ───────────────────────────────────────────────────────
function momOf(cs, price) {
  const ind = computeLayerIndicators('1H', cs, price);
  let s = buildMultiTfSymbol('ETH', { price, fundingPct: '0.0200%', quoteAsset: 'USDT' });
  s = attachTfBlock(s, '1H', tfBlock('1H', cs, price));
  const syn = buildSymbolSynthesis(s);
  return syn.timeframes[0].familias.find((f) => f.familia === 'MOMENTUM');
}

const mfiAlto = computeLayerIndicators('1H', mkMfiCandles(120, 95), 101);
ok('T16-A MFI elevado (>60) en datos', mfiAlto['mfi'] > 60, `mfi=${mfiAlto['mfi']}`);
const momA = momOf(mkMfiCandles(120, 95), 101);
const txtA = momA.senales.join(' ');
ok('T16-A no dice comprar / no voto buy', /flujo monetario positivo y elevado/.test(txtA) && /no constituye por s[íi] solo confirmaci[óo]n de compra/.test(txtA));
ok('T16-A MFI neutral (no vota dirección)', momA.senales.find((s) => s.includes('MFI')) !== undefined);

const mfiBajo = computeLayerIndicators('1H', mkMfiCandles(120, 5), 99);
ok('T16-B MFI bajo (<40) en datos', mfiBajo['mfi'] < 40, `mfi=${mfiBajo['mfi']}`);
const momB = momOf(mkMfiCandles(120, 5), 99);
const txtB = momB.senales.join(' ');
ok('T16-B no dice vender / advertencia', /flujo monetario negativo y deprimido/.test(txtB) && /no constituye por s[íi] solo se[ñn]al de venta/.test(txtB));

ok('T16-C MFI alto = flujo + sobreextensión', /positivo y elevado/.test(txtA) && /zona tradicionalmente extrema|extrema/.test(txtA) && /no constituye por s[íi] solo/.test(txtA));
ok('T16-D MFI no vota (neutras >= 1)', momA.neutras >= 1);
ok('T16-E una sola señal MFI', momA.senales.filter((s) => s.includes('MFI')).length === 1);

// RSI extremo neutral
const csRsi = closesOsc(120, 20);
const indRsi = { ...computeLayerIndicators('1H', csRsi, 101), rsi: 85, mfi: 50 };
let sRsi = buildMultiTfSymbol('ETH', { price: 101, fundingPct: '0.0200%', quoteAsset: 'USDT' });
sRsi = attachTfBlock(sRsi, '1H', { valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget', velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 101, indicadores_disponibles: [], no_disponible: [], indicadores: indRsi });
const synRsi = buildSymbolSynthesis(sRsi);
const momRsi = synRsi.timeframes[0].familias.find((f) => f.familia === 'MOMENTUM');
const rsiSenal = momRsi.senales.find((x) => x.includes('RSI'));
ok('T16 RSI>70 sobreextensión, no venta automática', /sobreextensi[óo]n/.test(rsiSenal) && /no es se[ñn]al de venta por s[íi] solo/.test(rsiSenal));
ok('T16 prompt MFI calibrado', /MFI/.test(ANALYTIC_INSTRUCTIONS) && /no constituye por s[íi] solo/i.test(ANALYTIC_INSTRUCTIONS));

console.log(`\nCIERRE FASE F: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
