// HARNESS FASE F.3 — cierre real sobre evidencia de producción.
// Caso real: ETHUSDT price 2504.39, VWAP 4H 2507 (BELOW), SuperTrend 1W confirmado
// bajista 2459 (live ABOVE), S1 2487 (ABOVE), R1 2520 (BELOW), RSI 84.6, funding
// 0.01% → 10.95% anualizado, OI 762K vs 747K, premium ≈ 0.
// Verifica que los defectos reales sean IMPOSIBLES o detectados:
//  A) "arriba del VWAP 4H (2507)" con hecho BELOW.
//  B) "Little room for error" / "premium sigue flat" / "largapgando molto".
//  C) OI/funding sin atribución direccional ("posicionamiento no se deshizo").
//  D) funding sin benchmark ("históricamente alto/extremo").
//  E) volumen sin benchmark ("con volumen", "ventas confirmadas").
//  F) evidencia acumulativa ("señal de venta" bloqueada).
//  G) truncamiento ("antes de." nunca llega a Telegram).
import { buildSymbolSynthesis, formatSynthesis, priceRelation, collectRelationFacts } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock, buildMultiTfContext } from '../.verify/utils/multitf.js';
import { validateSemanticContracts, validateNumericRelations, detectLanguageResiduals, translateTechnicalResiduals } from '../.verify/agents/semantic-guard.js';
import { guardedFinalize } from '../.verify/agents/guarded-reply.js';
import { buildAllowedClaims, withToolClaims, collectToolResultClaims } from '../.verify/agents/claims.js';
import { ensureCompleteEnding, classifyEnding, truncateSafe } from '../.verify/utils/sanitize.js';
import { chunkText } from '../.verify/utils/telegram.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
const FACTS = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false, volumeBenchmarkAvailable: false };

const F3_REL = [
  { label: 'VWAP 4H', value: 2507, relation: 'BELOW' },
  { label: 'SuperTrend 1W', value: 2459, relation: 'ABOVE' },
  { label: 'S1 4H', value: 2487, relation: 'ABOVE' },
  { label: 'R1 4H', value: 2520, relation: 'BELOW' },
];

// ── A) VWAP: el hecho calculado es autoritativo ──────────────────────────────
ok('A1 priceRelation(2504.39,2507)=BELOW', priceRelation(2504.39, 2507) === 'BELOW');
ok('A2 "arriba del VWAP 4H (2507)" → violación', validateNumericRelations('El precio está otra vez arriba del VWAP 4H (2507).', F3_REL).length > 0);
ok('A3 "recuperó...arriba del VWAP (2507)" → violación', validateNumericRelations('el precio recuperó los 2500 y está otra vez arriba del VWAP 4H (2507 según el último dato).', F3_REL).length > 0);
ok('A4 "superó el VWAP (2507)" → violación', validateNumericRelations('El precio superó el VWAP 4H (2.507 USDT).', F3_REL).length > 0);
ok('A5 "opera por debajo del VWAP (2507)" → OK', validateNumericRelations('El precio opera por debajo del VWAP 4H (2.507 USDT).', F3_REL).length === 0);
ok('A6 condicional "si supera 2507" no se audita', validateNumericRelations('Si el precio supera 2507, el escenario alcista gana peso.', F3_REL).length === 0);
ok('A7 "un cierre por encima de 2.507 confirmaría" no se audita', validateNumericRelations('Un cierre por encima de 2.507 USDT confirmaría la recuperación.', F3_REL).length === 0);
ok('A8 negación "no perdió 2487" no es afirmación', validateNumericRelations('El precio no perdió el soporte de 2487 todavía.', F3_REL).length === 0);
ok('A9 2510>2507 → "debajo del VWAP" violación', validateNumericRelations('El precio cotiza por debajo del VWAP 4H (2507).', [{ label: 'VWAP 4H', value: 2507, relation: 'ABOVE' }]).length > 0);

// ── B) Inglés/italiano/corrupción ────────────────────────────────────────────
ok('B1 Little room for error → poco margen de error', translateTechnicalResiduals('estás operando con Little room for error') === 'estás operando con poco margen de error');
ok('B2 premium sigue flat → premium sigue plano', translateTechnicalResiduals('el premium sigue flat') === 'el premium sigue plano');
ok('B3 flip del régimen → cambio del régimen', translateTechnicalResiduals('flip del régimen') === 'cambio del régimen');
const resB4 = detectLanguageResiduals('muy largapgando molto');
ok('B4 detecta corrupción "largapgando"', resB4.some((x) => x.kind === 'corrupt' && x.token === 'largapgando'));
ok('B5 detecta italiano "molto"', resB4.some((x) => x.kind === 'foreign' && x.token === 'molto'));
ok('B6 texto técnico legítimo sin residuos', detectLanguageResiduals('opera por debajo del VWAP 4H con stop en 2459, funding positivo y largos pagando shorts').length === 0);
ok('B7 "premium sigue flat" pasa post-reparación', validateSemanticContracts(translateTechnicalResiduals('el premium sigue flat'), FACTS).length === 0);

// ── C) OI/funding sin atribución direccional ─────────────────────────────────
ok('C1 "históricamente alto de posicionamiento largo" → violación', validateSemanticContracts('sigues con ese nivel históricamente alto de posicionamiento largo', FACTS).length > 0);
ok('C2 "lo que te dice que el posicionamiento no se deshizo" → violación', validateSemanticContracts('El funding no aflojó, lo que te dice que el posicionamiento no se deshizo.', FACTS).length > 0);
const c3ok = 'El OI aumentó mientras el funding sigue positivo: hay más exposición abierta y mantener largos sigue teniendo costo; no alcanza para saber qué lado está iniciando esas posiciones.';
ok('C3 exposición abierta + coste de mantener largos permitido', validateSemanticContracts(c3ok, FACTS).length === 0);
ok('C4 "OI subió ligeramente a 762K ETH" (hecho) permitido', validateSemanticContracts('OI subió ligeramente a 762K ETH y el premium sigue plano.', FACTS).length === 0);

// ── D) Funding sin benchmark ─────────────────────────────────────────────────
ok('D1 "históricamente alto" sin benchmark → violación', validateSemanticContracts('Funding en 0.01%: el nivel anualizado sería históricamente alto.', FACTS).length > 0);
ok('D2 "récord" sin benchmark → violación', validateSemanticContracts('El funding está en un récord.', FACTS).length > 0);
ok('D3 con benchmark documentado → permitido', validateSemanticContracts('El funding está históricamente alto (percentil 97%).', { ...FACTS, fundingBenchmarkAvailable: true }).length === 0);
ok('D4 "positivo/costoso para largos" permitido', validateSemanticContracts('El funding es positivo y costoso para los largos; anualizado serían ~10.95%.', FACTS).length === 0);

// ── E) Volumen sin benchmark + F) evidencia acumulativa ──────────────────────
ok('E1 "con volumen" → violación', validateSemanticContracts('si el precio pierde 2487 con volumen, ahí tenés primeras ventas.', FACTS).length > 0);
ok('E2 "venta confirmada" → violación', validateSemanticContracts('venta confirmada al perder el soporte.', FACTS).length > 0);
ok('E3 "aumentaría la evidencia bajista" permitido', validateSemanticContracts('Una pérdida de 2487 aumentaría la evidencia bajista.', FACTS).length === 0);
ok('E4 "el volumen no acompaña" (negación) permitido', validateSemanticContracts('El volumen no acompaña plenamente la extensión del precio.', FACTS).length === 0);
ok('E5 con benchmark de volumen → ruptura gana peso', validateSemanticContracts('Si pierde 2487 y la ruptura viene con expansión de volumen validada, la señal bajista gana peso.', { ...FACTS, volumeBenchmarkAvailable: true }).length === 0);
ok('F1 "señal de venta" bloqueada', validateSemanticContracts('Perder 2487 sería una señal de venta.', FACTS).length > 0);
ok('F2 "sin que eso sea señal de venta automática" permitido', validateSemanticContracts('RSI 84,6 advierte de agotamiento, sin que eso sea señal de venta automática.', FACTS).length === 0);

// ── G) Truncamiento end-to-end ───────────────────────────────────────────────
ok('G1 classifyEnding("antes de.") = dangling', classifyEnding('esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.') === 'dangling');
ok('G2 ensureCompleteEnding corta "antes de."', !/antes de\.$/.test(ensureCompleteEnding('esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.')));
ok('G3 "y el timing." también', !/el timing\.$/.test(ensureCompleteEnding('esperaría un pullback y el timing.')));
ok('G4 texto completo NO se mutila', ensureCompleteEnding('La estructura no se rompe. El régimen sigue bajista.') === 'La estructura no se rompe. El régimen sigue bajista.');
ok('G5 truncateSafe corta final colgante', !/antes de\.$/.test(truncateSafe('esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.')));
const chunks = chunkText('El precio opera por debajo del VWAP 4H en 2507 USDT. '.repeat(40), 100);
ok('G6 chunkText no parte oraciones', chunks.length > 1 && chunks.slice(0, -1).every((c) => c.endsWith('.')));

// ── Integración: fixture real completo ───────────────────────────────────────
const toolClaims = collectToolResultClaims({ symbol: 'ETH', price: 2504.39, quoteAsset: 'USDT', fundingBitgetPct: 0.01, openInterestBitget: 762000, openInterestPrev: 747000, annualizedFundingPct: 10.95, premiumPct: 0 }, 'ETH');
let pre = buildMultiTfSymbol('ETH', { price: 2504.39, fundingPct: '0.0100%', quoteAsset: 'USDT' });
pre = attachTfBlock(pre, '1W', { valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget', velas_total: 78, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2450, indicadores_disponibles: [], no_disponible: [], indicadores: { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia' } });
pre = attachTfBlock(pre, '1D', { valido: true, status: 'ok', granularidad_bitget: '1D', fuente: 'Bitget', velas_total: 220, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2504.39, indicadores_disponibles: [], no_disponible: [], indicadores: { rsi: 84.6 } });
pre = attachTfBlock(pre, '4H', { valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget', velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2504.39, indicadores_disponibles: [], no_disponible: [], indicadores: { vwap_sesion: 2507, pivot_s1: 2487, pivot_r1: 2520 } });
const claims = withToolClaims(buildAllowedClaims({ ETHUSDT: pre }), toolClaims);
const relationFacts = collectRelationFacts({ ETHUSDT: pre });
ok('I1 collectRelationFacts recolecta VWAP 4H BELOW', relationFacts.some((f) => f.label === 'VWAP 4H' && f.relation === 'BELOW'));
ok('I2 recolección incluye SuperTrend 1W ABOVE', relationFacts.some((f) => f.label === 'SuperTrend 1W' && f.relation === 'ABOVE'));

const realResponse = [
  'Precio en 2504.39 USDT. Funding se mantiene en 0.01%, que anualizado es 10.95% — sigues con ese nivel históricamente alto de posicionamiento largo.',
  'OI subió ligeramente a 762K ETH y el premium sigue flat.',
  'el precio recuperó los 2500 y está otra vez arriba del VWAP 4H (2507 según el último dato).',
  'El funding no aflojó, lo que te dice que el posicionamiento no se deshizo.',
  'con este funding y este RSI estás operando con Little room for error.',
  'si el precio pierde 2487 con volumen, ahí tenés primeras ventas.',
  'esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.',
].join('\n\n');

const gBad = await guardedFinalize(realResponse, claims, async () => realResponse, FACTS, relationFacts);
ok('I3 respuesta real defectuosa → refused (no puede pasar)', gBad.status === 'refused');

const corregida =
  'Precio en 2504.39 USDT, funding 0.01% (10,95% anualizado, extrapolado), OI en 762K ETH (creciendo desde ~747K), premium prácticamente nulo (alineado con el índice). ' +
  'El SuperTrend semanal confirmado continúa bajista en 2459 USDT, mientras el precio vivo (2.504,39 USDT) cotiza POR ENCIMA de ese nivel: un cambio requiere confirmación del cierre. ' +
  'En 4H el precio opera por debajo del VWAP (2.507 USDT): recuperó parte del terreno pero todavía no alcanza para decir que recuperó aceptación sobre esa referencia. ' +
  'El OI aumentó mientras el funding sigue positivo: hay más exposición abierta y mantener largos sigue teniendo costo; no alcanza para saber qué lado está iniciando esas posiciones. ' +
  'Si el precio pierde 2487, aumentaría la evidencia bajista; todavía no alcanza para confirmarla.';
const gGood = await guardedFinalize(realResponse, claims, async () => corregida, FACTS, relationFacts);
const finalText = ensureCompleteEnding(gGood.status === 'ok' ? gGood.text : corregida);
ok('I4 regeneración corregida → ok', gGood.status === 'ok');
ok('I5 final sin contradicción VWAP', !/arriba del VWAP/.test(finalText) && /por debajo del VWAP/.test(finalText));
ok('I6 final sin residuos narrativos', !/Little room for error|flat|flip/.test(finalText));
ok('I7 final sin inferencias OI/funding', !/posicionamiento no se deshizo|históricamente alto/.test(finalText));
ok('I8 final sin "con volumen"', !/con volumen/.test(finalText));
ok('I9 final no termina en oración rota', classifyEnding(finalText) === 'complete' && !/antes de\.$/.test(finalText));
ok('I10 síntesis declara relaciones calculadas', /Relaciones \(hechos calculados/.test(formatSynthesis(buildSymbolSynthesis(pre))));

console.log(`\nFASE F.3 (evidencia real): ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
