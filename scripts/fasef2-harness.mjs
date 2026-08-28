// HARNESS FASE F.2 — valida T29-T36 + genera FIXTURE DE PRODUCCIÓN (caso real v11).
// Caso real: ETHUSDT price 2496.65, funding 0.01% (8h) → 10.95% anual, OI 760K vs
// 747K, premium 0, RSI 84.6, SuperTrend weekly confirmed bearish 2459, VWAP 4H
// 2507, support 2487.
import { buildSymbolSynthesis, formatSynthesis, priceRelation } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock } from '../.verify/utils/multitf.js';
import { validateSemanticContracts, translateTechnicalResiduals } from '../.verify/agents/semantic-guard.js';
import { guardedFinalize } from '../.verify/agents/guarded-reply.js';
import { buildAllowedClaims, withToolClaims, collectToolResultClaims } from '../.verify/agents/claims.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
const FACTS = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };

// ── T29: priceRelation + síntesis live vs confirmed ──────────────────────────
ok('T29 priceRelation ABOVE', priceRelation(2496.65, 2459) === 'ABOVE');
ok('T29 priceRelation BELOW', priceRelation(2400, 2459) === 'BELOW');
ok('T29 priceRelation AT', priceRelation(2459, 2459) === 'AT');

function weeklyFixture() {
  let s = buildMultiTfSymbol('ETH', { price: 2496.65, fundingPct: '0.0100%', quoteAsset: 'USDT' });
  const ind = { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia', rsi: 84.6 };
  const b = { valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget', velas_total: 78, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2450, indicadores_disponibles: [], no_disponible: [], indicadores: ind };
  s = attachTfBlock(s, '1W', b);
  return s;
}
const synW = buildSymbolSynthesis(weeklyFixture());
const st = synW.timeframes[0].superTrend;
ok('T29 confirmedState bajista', st.confirmedState === 'bajista');
ok('T29 liveRelationToLevel ABOVE', st.liveRelationToLevel === 'ABOVE');
const tendW = synW.timeframes[0].familias.find((f) => f.familia === 'TENDENCIA').senales.join(' ');
ok('T29 señal NO dice "precio vivo bajo el nivel"', !/precio vivo.*bajo el nivel/.test(tendW));
ok('T29 señal dice POR ENCIMA', /POR ENCIMA/.test(tendW));

// ── T30: contango/backwardation ──────────────────────────────────────────────
const v30 = validateSemanticContracts('premium en 0%, así que no hay contango ni backwardation.', FACTS);
ok('T30 bloquea contango', v30.some((x) => x.pattern === 'contango'));
ok('T30 bloquea backwardation', v30.some((x) => x.pattern === 'backwardation'));
ok('T30 frase correcta pasa', validateSemanticContracts('El perpetuo cotiza prácticamente alineado con el índice, sin premium ni discount relevante.', FACTS).length === 0);

// ── T31: OI ──────────────────────────────────────────────────────────────────
ok('T31 bloquea OI→longs', validateSemanticContracts('El OI aumenta y demuestra que los longs están entrando.', FACTS).length > 0);
ok('T31 bloquea apalancamiento largo', validateSemanticContracts('El apalancamiento largo está aumentando.', FACTS).length > 0);
ok('T31 permite exposición abierta', validateSemanticContracts('El OI crece: aumenta la exposición abierta.', FACTS).length === 0);
ok('T31 permite frase con funding', validateSemanticContracts('El OI aumenta mientras el funding es positivo: crece la exposición abierta en un mercado donde los largos pagan a los cortos.', FACTS).length === 0);

// ── T32: funding extremo ─────────────────────────────────────────────────────
ok('T32 bloquea altísimo', validateSemanticContracts('El funding es altísimo.', FACTS).length > 0);
ok('T32 permite costoso para longs', validateSemanticContracts('El funding es positivo y costoso para longs.', FACTS).length === 0);

// ── T33: family coverage (fixture rico multi-TF) ─────────────────────────────
function rich() {
  let s = buildMultiTfSymbol('ETH', { price: 2496.65, fundingPct: '0.0100%', quoteAsset: 'USDT' });
  const mk = (tf, close) => {
    const cs = [];
    const step = tf === '1W' ? 7 * 24 * HOUR : tf === '1D' ? 24 * HOUR : 4 * HOUR;
    const n = tf === '1W' ? 78 : 220;
    for (let i = 0; i < n; i++) { const t = nowAnchor - i * step; cs.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close: close + Math.sin(i / 3) * 5, volume: 10 }); }
    return cs;
  };
  for (const [tf, close] of [['1W', 2380], ['1D', 2496], ['4H', 2505]]) {
    const cs = mk(tf, close);
    const ind = { rsi: 60, superTrend_nivel: close - 20, superTrend_direccion: 'up', vwap_sesion: close - 5, atr: 10, bollinger_inferior: close - 30, bollinger_superior: close + 30, pivot_p: close, pivot_s1: close - 15, pivot_r1: close + 15, mfi: 55, adx: 25, di_positivo: 26, di_negativo: 20 };
    const b = { valido: true, status: 'ok', granularidad_bitget: tf, fuente: 'Bitget', velas_total: cs.length, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: close, indicadores_disponibles: [], no_disponible: [], indicadores: ind };
    s = attachTfBlock(s, tf, b);
  }
  return s;
}
const synR = buildSymbolSynthesis(rich());
ok('T33 familyCoverage trend', synR.familyCoverage.trend);
ok('T33 familyCoverage momentum', synR.familyCoverage.momentum);
ok('T33 familyCoverage volume', synR.familyCoverage.volume);
ok('T33 familyCoverage volatility', synR.familyCoverage.volatility);
ok('T33 familyCoverage structure', synR.familyCoverage.structure);
ok('T33 familyCoverage derivatives', synR.familyCoverage.derivatives);
ok('T33 formato declara cobertura', /Cobertura de familias/.test(formatSynthesis(synR)));

// ── T34: confluencias/contradicciones símbolo ────────────────────────────────
ok('T34 hay confluencias o contradicciones', synR.confluenciasSimbolo.length + synR.contradiccionesSimbolo.length > 0);
ok('T34 formato las declara', /Confluencias \(r[ée]gimen\)|Contradicciones \(r[ée]gimen\)/.test(formatSynthesis(synR)));

// ── T35: español ─────────────────────────────────────────────────────────────
ok('T35 funding high → elevado', translateTechnicalResiduals('funding high') === 'funding elevado');
ok('T35 stays long → mantener largos', translateTechnicalResiduals('stays long') === 'mantener largos');
ok('T35 SuperTrend down → traducido', /SuperTrend alcista\/bajista/.test(translateTechnicalResiduals('SuperTrend down')));
ok('T35 flat → premium neutro', /premium neutro\/alineado con índice/.test(translateTechnicalResiduals('premium is flat')));

// ── T36: consistencia numérica ───────────────────────────────────────────────
const synT = buildSymbolSynthesis(weeklyFixture());
ok('T36 priceVsSuperTrend ABOVE', synT.timeframes[0].numericFacts.priceVsSuperTrend === 'ABOVE');
let s36 = buildMultiTfSymbol('ETH', { price: 2496.65, fundingPct: '0.0100%', quoteAsset: 'USDT' });
const b36 = { valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget', velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2496.65, indicadores_disponibles: [], no_disponible: [], indicadores: { vwap_sesion: 2507, pivot_s1: 2487, pivot_r1: 2520 } };
s36 = attachTfBlock(s36, '4H', b36);
const f36 = buildSymbolSynthesis(s36).timeframes[0].numericFacts;
ok('T36 priceVsVwap BELOW', f36.priceVsVwap === 'BELOW');
ok('T36 priceVsS1 ABOVE', f36.priceVsS1 === 'ABOVE');
ok('T36 priceVsR1 BELOW', f36.priceVsR1 === 'BELOW');

// ── Guard integrado con fixture de producción ────────────────────────────────
const toolClaims = collectToolResultClaims({ symbol: 'ETH', price: 2496.65, quoteAsset: 'USDT', fundingBitgetPct: 0.01, openInterestBitget: 760000, annualizedFundingPct: 10.95, premiumPct: 0 }, 'ETH');
// claims del pre-fetch: SuperTrend nivel 2459 (confirmado semanal)
let pre = buildMultiTfSymbol('ETH', { price: 2496.65, fundingPct: '0.0100%', quoteAsset: 'USDT' });
pre = attachTfBlock(pre, '1W', { valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget', velas_total: 78, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2450, indicadores_disponibles: [], no_disponible: [], indicadores: { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia' } });
const claims = withToolClaims(buildAllowedClaims({ ETHUSDT: pre }), toolClaims);
const bad = 'El OI de 760000 ETH demuestra que los longs están entrando, el funding es altísimo, y el precio se mantiene bajo el SuperTrend de 2459. No hay contango.';
const good = 'El perpetuo cotiza prácticamente alineado con el índice. El OI crece: aumenta la exposición abierta. El funding es positivo y costoso para longs. El SuperTrend semanal confirmado sigue bajista con referencia 2459 USDT, aunque el precio vivo (2496.65 USDT) cotiza por encima; un cambio requiere confirmación del cierre.';
const g1 = await guardedFinalize(bad, claims, async () => good);
ok('GUARD integrado rechaza violadora y acepta la corregida', g1.status === 'ok' && g1.text.includes('alineado con el índice'));

console.log(`\nFASE F.2 (T29-T36 + guard): ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
