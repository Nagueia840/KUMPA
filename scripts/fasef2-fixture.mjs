// FIXTURE F.2 — caso real v11 + respuesta final simulada + validación 17 puntos.
// Datos: ETHUSDT price 2496.65, funding 0.01% (8h) → 10.95% anual, OI 760K vs
// 747K, premium 0, RSI 84.6, SuperTrend weekly confirmed bearish 2459, VWAP 4H
// 2507, support 2487.
import { buildSymbolSynthesis, formatSynthesis } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock } from '../.verify/utils/multitf.js';
import { validateSemanticContracts, translateTechnicalResiduals } from '../.verify/agents/semantic-guard.js';
import { truncateSafe } from '../.verify/utils/sanitize.js';
import { ANALYTIC_INSTRUCTIONS } from '../.verify/config/personality.js';

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
const FACTS = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };

// ── Construcción del símbolo con el caso real v11 ────────────────────────────
let s = buildMultiTfSymbol('ETH', { price: 2496.65, fundingPct: '0.0100%', quoteAsset: 'USDT' });
// 1W: confirmed bearish, level 2459, live 2496.65 (ABOVE)
s = attachTfBlock(s, '1W', {
  valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget', velas_total: 78,
  ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2450,
  indicadores_disponibles: [], no_disponible: [],
  indicadores: { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia' },
});
// 1D: RSI 84.6 + medias + momentum extendido
s = attachTfBlock(s, '1D', {
  valido: true, status: 'ok', granularidad_bitget: '1D', fuente: 'Bitget', velas_total: 220,
  ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2496.65,
  indicadores_disponibles: [], no_disponible: [],
  indicadores: { rsi: 84.6, macd_linea: 5, macd_senal: 3, macd_histograma: 2, ema20: 2480, sma50: 2460, atr: 30, bollinger_inferior: 2440, bollinger_media: 2490, bollinger_superior: 2540, mfi: 78, stochastic_k: 88 },
});
// 4H: VWAP 2507, soporte 2487
s = attachTfBlock(s, '4H', {
  valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget', velas_total: 220,
  ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2496.65,
  indicadores_disponibles: [], no_disponible: [],
  indicadores: { vwap_sesion: 2507, pivot_s1: 2487, pivot_r1: 2525, superTrend_nivel: 2490, superTrend_direccion: 'up', superTrend_rol: 'soporte' },
});

const syn = buildSymbolSynthesis(s);
console.log('=== SÍNTESIS ESTRUCTURADA (caso v11) ===');
console.log(formatSynthesis(syn));

// ── Respuesta final SIMULADA (lo que el pipeline produce tras LLM+guards) ───
const respuesta = `ETH (USDT) — panorama: 2.496,65 USDT, funding 0,01% (10,95% anualizado, extrapolado), OI en 760K ETH (creciendo desde ~747K), premium prácticamente nulo (alineado con el índice).

RÉGIMEN 1W/1D: el SuperTrend semanal confirmado continúa bajista, con referencia en 2.459 USDT, aunque el precio vivo (2.496,65 USDT) cotiza POR ENCIMA de ese nivel: un eventual cambio del estado semanal requiere confirmación del cierre correspondiente. El momentum diario está extendido (RSI 84,6 con osciladores en zona de sobreextensión), lo que advierte sobre un posible agotamiento a corto plazo, sin que eso sea señal de venta automática.

ESTRUCTURA 4H: el precio opera por debajo del VWAP 4H (2.507 USDT), lo que marca debilidad relativa contextual, con soporte inmediato en 2.487 USDT. La volatilidad se mantiene amplia, por lo que perseguir precio en esta zona aumenta el riesgo de entrada tardía.

CONFLUENCIAS Y CONTRADICCIONES: la tendencia confirmada semanal es bajista mientras el momentum diario está sobrecomprado y el precio vivo supera el nivel de SuperTrend — una contradicción entre el estado confirmado (velas cerradas) y la acción intradía. El volumen no acompaña plenamente la extensión del precio.

ESCENARIO ALCISTA: un cierre semanal por encima de 2.459 USDT confirmaría el cambio del SuperTrend; trigger: cierre 4H sobre 2.525 USDT; invalidación: pérdida de 2.487 USDT.

ESCENARIO BAJISTA: si el momentum extendido se revierte y el precio pierde 2.487 USDT, la debilidad frente al VWAP 4H gana peso; invalidación: recuperación sobre 2.507 USDT.

RIESGO: la contradicción entre el estado confirmado semanal y el precio vivo exige esperar confirmación de cierre; el funding positivo es costoso para longs (los largos pagan a los cortos), sin que el OI identifique quién entra.`;

// ── Validación de los 17 puntos del fixture ──────────────────────────────────
const sem = validateSemanticContracts(respuesta, FACTS);
const traducida = translateTechnicalResiduals(respuesta);

ok('1. NO dice precio debajo de 2459', !/precio[^.]{0,60}bajo (?:el nivel de )?2\.459/.test(respuesta));
ok('2. Explica confirmed bearish vs live price above', /confirmado contin[uú]a bajista/.test(respuesta) && /POR ENCIMA/.test(respuesta) && /requiere confirmaci[oó]n del cierre/.test(respuesta));
ok('3. NO usa contango/backwardation', !/contango|backwardation/i.test(respuesta));
ok('4. NO dice OI demuestra longs', !/OI[^.]{0,60}demuestra[^.]{0,40}longs/i.test(respuesta));
ok('5. NO dice apalancamiento largo aumentando', !/apalancamiento largo/.test(respuesta));
ok('6. Funding positivo conserva semántica', /los largos pagan a los cortos/.test(respuesta) && !/presi[oó]n compradora/.test(respuesta));
ok('7. No llama altísimo/extremo', !/alt[ií]simo|extremadamente|excesivo/.test(respuesta));
ok('8. USDT presente en niveles', /2\.459 USDT/.test(respuesta) && /2\.487 USDT/.test(respuesta) && /2\.507 USDT/.test(respuesta));
ok('9. Familias representadas (tendencia/momentum/volumen/volatilidad/estructura/derivados)', /SuperTrend/.test(respuesta) && /RSI/.test(respuesta) && /VWAP/.test(respuesta) && /volatilidad/.test(respuesta) && /soporte/.test(respuesta) && /funding/.test(respuesta));
ok('10. Hay confluencias', /CONFLUENCIAS/.test(respuesta));
ok('11. Hay contradicciones', /contradicci[oó]n/.test(respuesta));
ok('12. Escenario alcista', /ESCENARIO ALCISTA/.test(respuesta));
ok('13. Escenario bajista', /ESCENARIO BAJISTA/.test(respuesta));
ok('14. Trigger/invalidación', /trigger/.test(respuesta) && /invalidaci[oó]n/.test(respuesta));
ok('15. No enumera 34 indicadores', (respuesta.match(/\b(?:RSI|MACD|CCI|Stochastic|ADX|OBV|CMF|ATR|Bollinger|Keltner|Donchian|Ichimoku|MFI)\b/g) || []).length <= 4);
ok('16. Sin inglés residual', /funding high|stays long|SuperTrend (up|down)|premium is flat/i.test(respuesta) === false);
ok('17. Sin oración truncada', truncateSafe(respuesta) === respuesta);

// Guard semántico sobre la respuesta
ok('GUARD semántico: 0 violaciones', sem.length === 0);
ok('translate no altera', traducida === respuesta);

console.log(`\nFIXTURE F.2: ${pass} PASS / ${fail} FAIL`);
console.log('\n=== RESPUESTA FIXTURE COMPLETA (simulada, post-guards) ===');
console.log(respuesta);
process.exit(fail === 0 ? 0 : 1);
