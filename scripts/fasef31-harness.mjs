// HARNESS FASE F.3.1 — cierre quirúrgico del incidente v12
// CAMBIO 1 (targeted retry): el retry recibe las razones EXACTAS de r1.
// CAMBIO 2 (instrumentación): [guard_r1_rejected] [guard_retry_start] [guard_r2_ok|rejected] [guard_retry_provider_error].
// Regresión: respuesta real v11 (update 30098843) rechazada; corregida aceptada.
import { collectRelationFacts } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock } from '../.verify/utils/multitf.js';
import {
  buildTargetedRetryPrompt,
  guardedFinalize,
  GUARD_RETRY_PROMPT,
} from '../.verify/agents/guarded-reply.js';
import { buildAllowedClaims, withToolClaims, collectToolResultClaims } from '../.verify/agents/claims.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
const FACTS = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false, volumeBenchmarkAvailable: false };

// Respuesta REAL v11 (update 30098843, mismo chat + misma query) que v12 rechaza.
const V11_RESPONSE =
  'Precio en 2504.39 USDT. Funding se mantiene en 0.01%, que anualizado es 10.95% — sigues con ese nivel históricamente alto de posicionamiento largo. ' +
  'OI subió ligeramente a 762K ETH y el premium sigue flat.\n\n' +
  'Qué cambió desde la última lectura: el precio recuperó los 2500 y está otra vez arriba del VWAP 4H (2507 según el último dato). Subió ~8 dólares, no es un move enorme pero recuperó terreno. ' +
  'El funding no aflojó, lo que te dice que el posicionamiento no se deshizo.\n\n' +
  'La lectura: con RSI diario en 84.6 y funding 11% estás en un setup donde la gente está muy largapgando molto. Eso puede funcionar un rato, pero no indefinidamente. ' +
  'El SuperTrend semanal en 2459 está a ~45 dólares abajo — mientras no lo pierda, la estructura no se rompe. Arriba tenés el máximo de la vela semanal en 2566 y el máximo histórico del Donchian diario en 2567.\n\n' +
  'Riesgo: si el precio pierde 2487 con volumen, ahí tenés primeras ventas. Abajo de 2459 ya sería un flip del régimen semanal y ahí sí cambia la ecuación.\n\n' +
  'Tesis operativa: la tendencia de fondo es alcista, pero con este funding y este RSI estás operando con Little room for error. Si metés largo, tamaño ajustado y stops claros bajo 2459. Si buscás entrada fresca, esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.';

const CORREGIDA =
  'ETH (USDT) — panorama: 2.504,39 USDT, funding 0,01% (10,95% anualizado, extrapolado), OI en 762K ETH (creciendo desde ~747K), premium prácticamente nulo (alineado con el índice).\n\n' +
  'RÉGIMEN 1W/1D: el SuperTrend semanal confirmado continúa bajista, con referencia en 2.459 USDT, aunque el precio vivo (2.504,39 USDT) cotiza POR ENCIMA de ese nivel: un eventual cambio del estado semanal requiere confirmación del cierre. El momentum diario está extendido (RSI 84,6 en zona de sobreextensión), lo que advierte sobre un posible agotamiento a corto plazo, sin que eso sea señal de venta automática.\n\n' +
  'ESTRUCTURA 4H: recuperó parte del terreno, pero todavía opera por debajo del VWAP 4H (2.507 USDT): eso mejora respecto de la lectura anterior, aunque todavía no alcanza para decir que recuperó aceptación sobre esa referencia. El soporte inmediato está en 2.487 USDT. La volatilidad se mantiene amplia: perseguir precio en esta zona aumenta el riesgo de entrada tardía.\n\n' +
  'CONFLUENCIAS Y CONTRADICCIONES: la tendencia confirmada semanal es bajista mientras el momentum diario está sobrecomprado y el precio vivo supera el nivel de SuperTrend — contradicción entre el estado confirmado (velas cerradas) y la acción intradía. El volumen no acompaña plenamente la extensión del precio.\n\n' +
  'DERIVADOS: el OI aumentó mientras el funding sigue positivo: hay más exposición abierta y mantener largos sigue teniendo costo. Eso no alcanza para saber qué lado está iniciando esas posiciones, ni para calificar el nivel del funding sin un benchmark.\n\n' +
  'ESCENARIO ALCISTA: un cierre semanal por encima de 2.459 USDT confirmaría el cambio del SuperTrend; trigger: cierre 4H sobre 2.525 USDT; invalidación: pérdida de 2.487 USDT.\n\n' +
  'ESCENARIO BAJISTA: si el momentum extendido se revierte y el precio pierde 2.487 USDT, aumentaría la evidencia bajista (la debilidad frente al VWAP 4H gana peso); invalidación: recuperación sobre 2.507 USDT.\n\n' +
  'RIESGO: la contradicción entre el estado confirmado semanal y el precio vivo exige esperar confirmación de cierre; el funding positivo es costoso para los largos, sin que el OI identifique quién entra. Si operás largo, tamaño ajustado y stops claros bajo 2.459 USDT.';

function buildFixture() {
  const toolClaims = collectToolResultClaims(
    { symbol: 'ETH', price: 2504.39, quoteAsset: 'USDT', fundingBitgetPct: 0.01, openInterestBitget: 762000, openInterestPrev: 747000, annualizedFundingPct: 10.95, premiumPct: 0 },
    'ETH',
  );
  let pre = buildMultiTfSymbol('ETH', { price: 2504.39, fundingPct: '0.0100%', quoteAsset: 'USDT' });
  pre = attachTfBlock(pre, '1W', { valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget', velas_total: 78, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2450, indicadores_disponibles: [], no_disponible: [], indicadores: { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia' } });
  pre = attachTfBlock(pre, '1D', { valido: true, status: 'ok', granularidad_bitget: '1D', fuente: 'Bitget', velas_total: 220, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2504.39, indicadores_disponibles: [], no_disponible: [], indicadores: { rsi: 84.6 } });
  pre = attachTfBlock(pre, '4H', { valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget', velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2504.39, indicadores_disponibles: [], no_disponible: [], indicadores: { vwap_sesion: 2507, pivot_s1: 2487, pivot_r1: 2520 } });
  const claims = withToolClaims(buildAllowedClaims({ ETHUSDT: pre }), toolClaims);
  const relations = collectRelationFacts({ ETHUSDT: pre });
  return { claims, relations };
}

const { claims, relations } = buildFixture();

// ── A) TARGETED RETRY: r1 rechazado → el retry recibe las razones EXACTAS ──
{
  let receivedViolations = null;
  const r = await guardedFinalize(V11_RESPONSE, claims, async (violations) => {
    receivedViolations = violations ?? null;
    return CORREGIDA;
  }, FACTS, relations);

  ok('A1 first draft defectuosa → rejected y retry llamado', r.status === 'ok' && receivedViolations !== null);
  ok('A2 el retry recibe violaciones de r1', Array.isArray(receivedViolations) && receivedViolations.length > 0);

  const allReasons = (receivedViolations ?? []).flatMap((v) => v.reasons).join(' | ').toLowerCase();
  ok('A3 incluye relación VWAP BELOW (contradicción "arriba del VWAP")', /arriba del vwap|vwap 4h/.test(allReasons) && /below/.test(allReasons));
  ok('A4 incluye semántica posicionamiento/funding', /posicionamiento/.test(allReasons));
  ok('A5 incluye idioma (molto/move/setup)', /molto|move|setup/.test(allReasons));

  // El prompt dirigido contiene las causas exactas
  const prompt = buildTargetedRetryPrompt(receivedViolations ?? []);
  ok('A6 prompt dirigido contiene categoría RELATIONS', /RELATIONS:/.test(prompt));
  ok('A7 prompt dirigido contiene la descripción concreta de VWAP', /VWAP 4H \(2507\).*BELOW/i.test(prompt));
  ok('A8 prompt dirigido NO contiene la respuesta completa (compacto)', !prompt.includes(V11_RESPONSE.slice(0, 120)));
}

// ── B) Regeneración corregida → ok ──
{
  const r = await guardedFinalize(V11_RESPONSE, claims, async () => CORREGIDA, FACTS, relations);
  ok('B1 regeneración corregida → ok', r.status === 'ok');
}

// ── C) Retry que repite contradicción → refused ──
{
  const r = await guardedFinalize(V11_RESPONSE, claims, async () => 'El precio está otra vez arriba del VWAP 4H (2507) y el funding es altísimo.', FACTS, relations);
  ok('C1 retry repite contradicción → refused', r.status === 'refused');
}

// ── D) Retry provider error → refused ──
{
  const r = await guardedFinalize(V11_RESPONSE, claims, async () => { throw new Error('provider timeout'); }, FACTS, relations);
  ok('D1 retry provider error → refused con razón de proveedor', r.status === 'refused' && /proveedor/.test(r.reason));
}

// ── E) Regresión: respuesta real v11 rechazada (sin corregir) ──
{
  const r = await guardedFinalize(V11_RESPONSE, claims, async () => V11_RESPONSE, FACTS, relations);
  ok('E1 respuesta real v11 (regen idéntica) → refused', r.status === 'refused');
}

// ── F) Sin violaciones → retry NO se llama (prompt base) ──
{
  let retryCalled = false;
  const r = await guardedFinalize(CORREGIDA, claims, async () => { retryCalled = true; return 'x'; }, FACTS, relations);
  ok('F1 respuesta válida → ok sin retry', r.status === 'ok' && !retryCalled);
}

console.log(`\nFASE F.3.1 (cierre quirúrgico incidente v12): ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);