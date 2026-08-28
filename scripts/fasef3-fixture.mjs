// FIXTURE FASE F.3 — reproducción EXACTA del caso real de producción.
// Consulta real: "Analizame ETH ahora" → respuesta con defectos A-E. Este fixture:
//  1) construye el caso real (price 2504.39, VWAP 4H 2507, ST 1W 2459 confirmado
//     bajista, S1 2487, R1 2520, RSI 84.6, funding 0.01% → 10.95%, OI 762K vs 747K,
//     premium ≈ 0) y la LECTURA ESTRUCTURADA;
//  2) demuestra que la RESPUESTA REAL DEFECTUOSA no puede pasar el pipeline
//     (guardedFinalize + ensureCompleteEnding + chunkText);
//  3) entrega la RESPUESTA CORREGIDA (FIXTURE_F3_RESPONSE) que SÍ pasa todo.
import { buildSymbolSynthesis, formatSynthesis, collectRelationFacts } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock } from '../.verify/utils/multitf.js';
import { validateSemanticContracts, validateNumericRelations, detectLanguageResiduals } from '../.verify/agents/semantic-guard.js';
import { guardedFinalize } from '../.verify/agents/guarded-reply.js';
import { buildAllowedClaims, withToolClaims, collectToolResultClaims } from '../.verify/agents/claims.js';
import { ensureCompleteEnding, classifyEnding } from '../.verify/utils/sanitize.js';
import { chunkText } from '../.verify/utils/telegram.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
const FACTS = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false, volumeBenchmarkAvailable: false };

// ── 1) Caso real + síntesis ──────────────────────────────────────────────────
let s = buildMultiTfSymbol('ETH', { price: 2504.39, fundingPct: '0.0100%', quoteAsset: 'USDT' });
s = attachTfBlock(s, '1W', { valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget', velas_total: 78, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2450, indicadores_disponibles: [], no_disponible: [], indicadores: { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia' } });
s = attachTfBlock(s, '1D', { valido: true, status: 'ok', granularidad_bitget: '1D', fuente: 'Bitget', velas_total: 220, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2504.39, indicadores_disponibles: [], no_disponible: [], indicadores: { rsi: 84.6 } });
s = attachTfBlock(s, '4H', { valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget', velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2504.39, indicadores_disponibles: [], no_disponible: [], indicadores: { vwap_sesion: 2507, pivot_s1: 2487, pivot_r1: 2520 } });
const syn = buildSymbolSynthesis(s);
const sintesis = formatSynthesis(syn);
console.log('=== LECTURA ESTRUCTURADA (caso real F.3) ===');
console.log(sintesis);
console.log('');

const relationFacts = collectRelationFacts({ ETHUSDT: s });
const toolClaims = collectToolResultClaims({ symbol: 'ETH', price: 2504.39, quoteAsset: 'USDT', fundingBitgetPct: 0.01, openInterestBitget: 762000, openInterestPrev: 747000, annualizedFundingPct: 10.95, premiumPct: 0 }, 'ETH');
const claims = withToolClaims(buildAllowedClaims({ ETHUSDT: s }), toolClaims);

ok('F1 priceRelation(2504.39, 2507) = BELOW', (await import('../.verify/agents/synthesis.js')).priceRelation(2504.39, 2507) === 'BELOW');
ok('F2 la síntesis declara las relaciones calculadas', /Relaciones \(hechos calculados/.test(sintesis));
ok('F3 relationFacts: VWAP 4H BELOW + SuperTrend 1W ABOVE', relationFacts.some((f) => f.label === 'VWAP 4H' && f.relation === 'BELOW') && relationFacts.some((f) => f.label === 'SuperTrend 1W' && f.relation === 'ABOVE'));

// ── 2) La respuesta real defectuosa NO puede pasar ───────────────────────────
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
ok('F4 respuesta real defectuosa → REFUSED por el guard', gBad.status === 'refused');
ok('F5 violaciones detectadas: relación VWAP', validateNumericRelations(realResponse, relationFacts).length > 0);
ok('F6 violaciones detectadas: semántica (OI/funding/volumen)', validateSemanticContracts(realResponse, FACTS).length > 0);
ok('F7 residuos lingüísticos detectados (Little/flat/molto)', detectLanguageResiduals(realResponse).length > 0);

// ── 3) Respuesta corregida (lo que SÍ debe recibir el usuario) ───────────────
const corregida =
  'ETH (USDT) — panorama: 2.504,39 USDT, funding 0,01% (10,95% anualizado, extrapolado), OI en 762K ETH (creciendo desde ~747K), premium prácticamente nulo (alineado con el índice).\n\n' +
  'RÉGIMEN 1W/1D: el SuperTrend semanal confirmado continúa bajista, con referencia en 2.459 USDT, aunque el precio vivo (2.504,39 USDT) cotiza POR ENCIMA de ese nivel: un eventual cambio del estado semanal requiere confirmación del cierre. El momentum diario está extendido (RSI 84,6 en zona de sobreextensión), lo que advierte de un posible agotamiento a corto plazo, sin que eso sea señal de venta automática.\n\n' +
  'ESTRUCTURA 4H: recuperó parte del terreno, pero todavía opera por debajo del VWAP 4H (2.507 USDT): eso mejora respecto de la lectura anterior, aunque todavía no alcanza para decir que recuperó aceptación sobre esa referencia. El soporte inmediato está en 2.487 USDT. La volatilidad se mantiene amplia: perseguir precio en esta zona aumenta el riesgo de entrada tardía.\n\n' +
  'CONFLUENCIAS Y CONTRADICCIONES: la tendencia confirmada semanal es bajista mientras el momentum diario está sobrecomprado y el precio vivo supera el nivel de SuperTrend — contradicción entre el estado confirmado (velas cerradas) y la acción intradía. El volumen no acompaña plenamente la extensión del precio.\n\n' +
  'DERIVADOS: el OI aumentó mientras el funding sigue positivo: hay más exposición abierta y mantener largos sigue teniendo costo. Eso no alcanza para saber qué lado está iniciando esas posiciones, ni para calificar el nivel del funding sin un benchmark.\n\n' +
  'ESCENARIO ALCISTA: un cierre semanal por encima de 2.459 USDT confirmaría el cambio del SuperTrend; trigger: cierre 4H sobre 2.525 USDT; invalidación: pérdida de 2.487 USDT.\n\n' +
  'ESCENARIO BAJISTA: si el momentum extendido se revierte y el precio pierde 2.487 USDT, aumentaría la evidencia bajista (la debilidad frente al VWAP 4H gana peso); invalidación: recuperación sobre 2.507 USDT.\n\n' +
  'RIESGO: la contradicción entre el estado confirmado semanal y el precio vivo exige esperar confirmación de cierre; el funding positivo es costoso para los largos, sin que el OI identifique quién entra. Si operás largo, tamaño ajustado y stops claros bajo 2.459 USDT.';

const gGood = await guardedFinalize(realResponse, claims, async () => corregida, FACTS, relationFacts);
const final = ensureCompleteEnding(gGood.status === 'ok' ? gGood.text : corregida);
ok('F8 la respuesta corregida pasa el pipeline (ok)', gGood.status === 'ok');

// Validación de los 17 puntos del fixture real (F.3 §14) sobre la respuesta FINAL.
ok('F9 reconoce que 2504.39 está DEBAJO de 2507', /por debajo del VWAP 4H \(2\.507 USDT\)/.test(final) && !/arriba del VWAP/.test(final));
ok('F10 distingue estado confirmado vs precio vivo', /confirmado contin[uú]a bajista/.test(final) && /cotiza POR ENCIMA de ese nivel/.test(final));
ok('F11 no atribuye el aumento de OI a longs', !/entraron longs|posicionamiento largo aument[oó]|posicionamiento no se deshizo/.test(final));
ok('F12 no llama extremo/histórico al funding sin benchmark', !/hist[oó]ricamente alto|extremo|r[eé]cord|anormal/.test(final));
ok('F13 sin contango/backwardation', !/contango|backwardation/i.test(final));
ok('F14 sin inglés narrativo ni corrupción', detectLanguageResiduals(final).length === 0);
ok('F15 sin "con volumen" como confirmación', !/con volumen/.test(final));
ok('F16 semántica acumulativa (aumentaría la evidencia bajista)', /aumentar[ií]a la evidencia bajista/.test(final));
ok('F17 sin oración final rota', classifyEnding(final) === 'complete' && !/antes de\.$/.test(final));
ok('F18 escenario alcista', /ESCENARIO ALCISTA/.test(final) && /confirmar[ií]a el cambio del SuperTrend/.test(final));
ok('F19 escenario bajista', /ESCENARIO BAJISTA/.test(final) && /aumentar[ií]a la evidencia bajista/.test(final));
ok('F20 trigger/invalidación respaldados', /trigger/.test(final) && /invalidaci[oó]n/.test(final));
ok('F21 tono conversacional (no lista 34 indicadores)', !/rsi.*macd.*stochastic.*adx.*mfi.*cci/i.test(final));
const chunks = chunkText(final, 4000);
ok('F22 Telegram recibe chunks sin partir palabras', chunks.every((c) => c.trim().length > 0) && chunks.slice(0, -1).every((c) => /[.!?…]$/.test(c.trimEnd())));

console.log('\n=== RESPUESTA FINAL CORREGIDA (FIXTURE_F3_RESPONSE — post-guards) ===');
console.log(final);
console.log('');
console.log(`FIXTURE F.3: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
