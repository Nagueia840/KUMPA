// HARNESS F.3.1.2 — capa determinista entre R2 y el guard final (incidente v14).
// Canónico: R2 con 2480/2481/2349, contango, backwardation, "volumen confirma",
// "por encima del SuperTrend 1H" (canonical BELOW), "por debajo del SuperTrend 4H"
// (canonical ABOVE) → repair determinista → guard final OK. SIN tercer LLM.
import { repairResponseDeterministic } from '../.verify/agents/deterministic-repair.js';
import { guardedFinalize } from '../.verify/agents/guarded-reply.js';
import { validateReply } from '../.verify/utils/validator.js';
import { validateSemanticContracts, validateNumericRelations } from '../.verify/agents/semantic-guard.js';
import { collectRelationFacts } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock } from '../.verify/utils/multitf.js';
import { buildAllowedClaims, withToolClaims, collectToolResultClaims } from '../.verify/agents/claims.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
const FACTS = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false, volumeBenchmarkAvailable: false };

// ── Fixture v14 (ETH price 2504.39) ──
let pre = buildMultiTfSymbol('ETH', { price: 2504.39, fundingPct: '0.0100%', quoteAsset: 'USDT' });
const mk = (tf, close, ind) => ({
  valido: true, status: 'ok', granularidad_bitget: tf, fuente: 'Bitget', velas_total: 78,
  ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: close,
  indicadores_disponibles: [], no_disponible: [], indicadores: ind,
});
pre = attachTfBlock(pre, '1W', mk('1W', 2450, { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia' }));
pre = attachTfBlock(pre, '1D', mk('1D', 2504.39, { rsi: 84.6 }));
pre = attachTfBlock(pre, '4H', mk('4H', 2504.39, { superTrend_nivel: 2499, superTrend_direccion: 'up', superTrend_rol: 'soporte', vwap_sesion: 2507, pivot_s1: 2500, pivot_r1: 2520 }));
pre = attachTfBlock(pre, '1H', mk('1H', 2504.39, { superTrend_nivel: 2512, superTrend_direccion: 'down', superTrend_rol: 'resistencia' }));

const toolClaims = collectToolResultClaims(
  { symbol: 'ETH', price: 2504.39, quoteAsset: 'USDT', fundingBitgetPct: 0.01, openInterestBitget: 762000, openInterestPrev: 747000, annualizedFundingPct: 10.95, premiumPct: 0 },
  'ETH',
);
const claims = withToolClaims(buildAllowedClaims({ ETHUSDT: pre }), toolClaims);
const relations = collectRelationFacts({ ETHUSDT: pre });

// ── R2 canónico (violaciones EXACTAS del incidente v14) ──
const R2_V14 =
  'El precio está por encima del SuperTrend 1H (2512) y por debajo del SuperTrend 4H (2499). ' +
  'El soporte quedó en 2480 y el máximo en 2481, con un piso en 2349. ' +
  'Hay contango y backwardation en el mercado. ' +
  'El volumen confirma la ruptura. ' +
  'El precio opera por debajo del VWAP 4H (2507) y el RSI diario está en 84.6.';

// R1 defectuoso que dispara el retry (estilo v14)
const R1_V14 =
  'Precio en 2504.39 USDT. El posicionamiento largo aumentó y el funding no aflojó: el posicionamiento no se deshizo. ' +
  'El precio está por encima del SuperTrend 1H (2512).';

const repaired = repairResponseDeterministic(R2_V14, claims, FACTS, relations);
console.log('=== REPARADO (canónico v14) ===');
console.log(repaired);
console.log('');

// ── Canónico: repair elimina/corrige; guard final = OK ──
ok('C1 sin números nuevos (2480/2481/2349 eliminados)', !/2480|2481|2349/.test(repaired));
ok('C2 sin contango/backwardation', !/contango|backwardation/i.test(repaired));
ok('C3 sin "volumen confirma"', !/volumen confirma|con volumen/i.test(repaired));
ok('C4 SuperTrend 1H canonicalizado a BELOW', /por debajo del SuperTrend 1H \(2512\)/.test(repaired));
ok('C5 SuperTrend 4H canonicalizado a ABOVE', /por encima del SuperTrend 4H \(2499\)/.test(repaired));
ok('C6 contenido válido conservado (VWAP BELOW + RSI 84.6)', /por debajo del VWAP 4H \(2507\)/.test(repaired) && /RSI diario está en 84\.6/.test(repaired));
const numOk = validateReply(repaired, claims);
ok('C7 guard numérico post-reparación = OK', numOk.valid);
ok('C8 guard semántico post-reparación = OK', validateSemanticContracts(repaired, FACTS).length === 0);
ok('C9 guard de relaciones post-reparación = OK', validateNumericRelations(repaired, relations).length === 0);

// ── Integración: guardedFinalize con retry → R2 con violaciones → repair → ok ──
{
  let retryCalls = 0;
  const g = await guardedFinalize(R1_V14, claims, async () => { retryCalls++; return R2_V14; }, FACTS, relations);
  ok('C10 guardedFinalize → ok tras reparación', g.status === 'ok');
  ok('C11 sin tercer retry (regen llamada 1 vez)', retryCalls === 1);
  ok('C12 texto final = reparado (sin números/relaciones invertidas)', g.status === 'ok' && !/2480|2481|2349|contango|backwardation/i.test(g.text) && /por debajo del SuperTrend 1H/.test(g.text) && /por encima del SuperTrend 4H/.test(g.text));
}

// ── Tests 1-10 ──
// 1) número permitido se conserva
ok('T1 número permitido (84.6) se conserva', /84\.6/.test(repaired));
// 2) número no permitido se elimina sin crear otro
{
  const numsAfter = (repaired.match(/\b\d{3,4}(?:[.,]\d+)?\b/g) || []).map((t) => parseFloat(t.replace(/[.,](\d{2})$/, '.$1')));
  const unbacked = numsAfter.filter((v) => !claims.claims.some((c) => Math.abs(v - c.value) <= Math.max(1, Math.abs(c.value) * 0.005)));
  ok('T2 números no permitidos eliminados sin crear otros', unbacked.length === 0, JSON.stringify(unbacked));
}
// 3) contango sin term structure desaparece
ok('T3 contango/backwardation ausentes', !/contango|backwardation/i.test(repaired));
// 4) premium/discount válido se conserva
{
  const r2Premium = R2_V14 + ' El premium está prácticamente nulo (alineado con el índice).';
  const repP = repairResponseDeterministic(r2Premium, claims, FACTS, relations);
  ok('T4 premium/discount válido se conserva', /premium está prácticamente nulo/.test(repP));
}
// 5) relation incorrecta se canonicaliza
ok('T5 relación invertida canonicalizada (1H→BELOW, 4H→ABOVE)', /por debajo del SuperTrend 1H/.test(repaired) && /por encima del SuperTrend 4H/.test(repaired));
// 6) relation correcta no se toca
ok('T6 relación correcta no se toca', /por debajo del VWAP 4H \(2507\)/.test(repaired));
// 7) volumen sin benchmark se neutraliza
ok('T7 "volumen confirma" eliminado', !/volumen confirma/.test(repaired));
// 8) contenido sano no cambia
{
  const sano = 'El precio opera por debajo del VWAP 4H (2507) y el RSI diario está en 84.6.';
  ok('T8 contenido sano no cambia', repairResponseDeterministic(sano, claims, FACTS, relations) === sano);
}
// 9) violación NO reparable sigue rechazada por el guard
{
  const r2NoReparable = R2_V14 + ' El posicionamiento no se deshizo.';
  const repNR = repairResponseDeterministic(r2NoReparable, claims, FACTS, relations);
  const sem = validateSemanticContracts(repNR, FACTS);
  ok('T9 violación no reparable (posicionamiento) sigue detectada por el guard', sem.some((v) => /posicionamiento/.test(v.reason)));
  const g = await guardedFinalize(R1_V14, claims, async () => r2NoReparable, FACTS, relations);
  ok('T9b guardedFinalize → refused (no reparable)', g.status === 'refused');
}
// 10) no hay tercer retry
{
  let calls = 0;
  const g = await guardedFinalize(R1_V14, claims, async () => { calls++; return R2_V14; }, FACTS, relations);
  ok('T10 sin tercer retry (1 sola regeneración)', calls === 1 && g.status === 'ok');
}

console.log(`\nFASE F.3.1.2 (capa determinista v14): ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
