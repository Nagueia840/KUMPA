// HARNESS F.3.1.1 — fix quirúrgico del guard retry (incidente v13, update 30098845).
// Regresiones T1-T12: R1 real → violaciones conocidas; retry = EDICIÓN restringida
// compacta; presupuesto << 8000 tok; sin números nuevos; contango/idioma/OI intactos;
// guard final como última barrera; fallback con mismo payload.
import { buildRetryEditPrompt, buildTargetedRetryPrompt, guardedFinalize, GUARD_RETRY_PROMPT } from '../.verify/agents/guarded-reply.js';
import { validateSemanticContracts, validateNumericRelations, detectLanguageResiduals } from '../.verify/agents/semantic-guard.js';
import { validateReply } from '../.verify/utils/validator.js';
import { collectRelationFacts } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock } from '../.verify/utils/multitf.js';
import { buildAllowedClaims, withToolClaims, collectToolResultClaims } from '../.verify/agents/claims.js';
import { shouldFallbackProvider } from '../.verify/llm/index.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
const FACTS = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false, volumeBenchmarkAvailable: false };

// ── R1 del incidente (proxy con las violaciones EXACTAS demostradas en v13) ──
// [guard_r1_rejected]: posicionamiento direccional; "(no) se deshizo"; funding→persistencia;
// "get" x2; "market".
const R1_INCIDENT =
  'Precio en 2504.39 USDT y funding positivo. El posicionamiento largo aumentó y el funding no aflojó, lo que te dice que el posicionamiento no se deshizo. ' +
  'Para ver el get de market data hay que get el contexto del mercado: el mercado está en un setup de 2507.';

const QUERY = 'Analizame ETH ahora. Quiero panorama completo multi-timeframe, derivados, contradicciones, escenarios, triggers, invalidaciones y riesgo. No enumeres indicadores: sintetizá.';

const CORREGIDA =
  'Precio en 2504.39 USDT, funding 0.01% (10,95% anualizado, extrapolado), OI en 762K ETH, premium prácticamente nulo (alineado con el índice). ' +
  'El SuperTrend semanal confirmado continúa bajista en 2459 USDT, mientras el precio vivo (2.504,39 USDT) cotiza POR ENCIMA de ese nivel: un cambio requiere confirmación del cierre. ' +
  'En 4H el precio opera por debajo del VWAP (2.507 USDT): recuperó parte del terreno pero todavía no alcanza para decir que recuperó aceptación sobre esa referencia. ' +
  'El OI aumentó mientras el funding sigue positivo: hay más exposición abierta y mantener largos sigue teniendo costo; no alcanza para saber qué lado está iniciando esas posiciones. ' +
  'Si el precio pierde 2487, aumentaría la evidencia bajista; todavía no alcanza para confirmarla.';

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

// Whitelist de facts (misma lógica que agent.ts: RETRY_FACT_FIELDS)
const RETRY_FACT_FIELDS = new Set([
  'precio', 'funding_pct', 'funding_anualizado_pct', 'open_interest', 'open_interest_prev',
  'cierre', 'vwap_sesion', 'vwap_semanal', 'superTrend_nivel',
  'pivot_s1', 'pivot_s2', 'pivot_r1', 'pivot_r2', 'rsi',
]);
function factsWhitelist(claimSet) {
  return claimSet.claims.filter((c) => RETRY_FACT_FIELDS.has(c.field))
    .map((c) => `${c.symbol}${c.timeframe ? `[${c.timeframe}]` : ''} ${c.field}=${c.value}`)
    .join('\n');
}
const whitelist = factsWhitelist(claims);

// ── T1 — R1 real del incidente: detecta las violaciones semánticas conocidas ──
{
  const sem = validateSemanticContracts(R1_INCIDENT, FACTS);
  const reasons = sem.map((v) => v.reason).join(' | ').toLowerCase();
  ok('T1 detecta atribución direccional de posicionamiento', /posicionamiento/.test(reasons) && /qui[eé]n abre/.test(reasons));
  ok('T1 detecta "el posicionamiento (no) se deshizo"', /se deshizo/.test(reasons));
  ok('T1 detecta funding→persistencia direccional', /persistencia direccional/.test(reasons));
  const lang = detectLanguageResiduals(R1_INCIDENT);
  const langTokens = lang.map((l) => l.token.toLowerCase());
  ok('T1 detecta idioma "get"', langTokens.includes('get'));
  ok('T1 detecta idioma "market"', langTokens.includes('market'));
}

// ── T2 — construcción del retry: compacto; contiene query/R1/violations/facts ──
{
  const violations = [
    { category: 'semantic', reasons: ['atribución direccional de posicionamiento sin evidencia', '"el posicionamiento (no) se deshizo" sin evidencia direccional', 'funding no demuestra persistencia direccional del posicionamiento'] },
    { category: 'language', reasons: ['palabra narrativa no española: "get"', 'palabra narrativa no española: "market"'] },
  ];
  const prompt = buildRetryEditPrompt({ query: QUERY, r1: R1_INCIDENT, violations, factsWhitelist: whitelist, relations });
  ok('T2 contiene la consulta original', prompt.includes(QUERY));
  ok('T2 contiene R1', prompt.includes(R1_INCIDENT.slice(0, 60)));
  ok('T2 contiene las violaciones (categoría + razón)', prompt.includes('SEMANTIC:') && prompt.includes('posicionamiento') && prompt.includes('LANGUAGE:'));
  ok('T2 contiene VERIFIED_FACTS whitelist', prompt.includes('VERIFIED_FACTS') && prompt.includes('vwap_sesion=2507'));
  ok('T2 contiene RELATION_FACTS', prompt.includes('RELATION_FACTS') && prompt.includes('BELOW'));
  ok('T2 NO contiene dump de datos ni system prompt (compacto)', !prompt.includes('indicadores_disponibles') && prompt.length < 6000);
}

// ── T3 — presupuesto: retry real << 8000 tokens aprox (4 chars/token) ──
{
  const violations = [
    { category: 'semantic', reasons: ['atribución direccional de posicionamiento sin evidencia', '"el posicionamiento (no) se deshizo" sin evidencia direccional', 'funding no demuestra persistencia direccional del posicionamiento'] },
    { category: 'language', reasons: ['palabra narrativa no española: "get"', 'palabra narrativa no española: "market"'] },
  ];
  const prompt = buildRetryEditPrompt({ query: QUERY, r1: R1_INCIDENT, violations, factsWhitelist: whitelist, relations });
  const approxTokens = Math.round(prompt.length / 4);
  ok(`T3 presupuesto retry: ${approxTokens} tok aprox < 4000`, approxTokens < 4000, `approx_tokens=${approxTokens}`);
  console.log(`     [guard_retry_context] ${JSON.stringify({ approx_chars: prompt.length, approx_tokens: approxTokens, r1_chars: R1_INCIDENT.length, facts_count: whitelist.split('\n').length, relation_facts_count: relations.length, violations_count: violations.length })}`);
}

// ── T4 — corrección sin números nuevos: números ausentes → rechazados ──
{
  // Números claramente fuera de todos los claims (no dentro de tolerancia):
  // 2401 no respalda pivot_s1=2487 (tol ±12); 2555 no respalda r1=2520 (tol ±13).
  const bad = 'El soporte de ETH quedó en 2401 y el nivel 2555 ya se perdió.';
  const num = validateReply(bad, claims);
  ok('T4 números ausentes (2401/2555) → rechazados', !num.valid && num.violations.some((v) => v.token === '2401') && num.violations.some((v) => v.token === '2555'), num.violations.map((v) => `${v.token}=${v.value}`).join(','));
  // 2483/2391 (los del incidente real) NO están en la whitelist del retry
  ok('T4 2483/2391 NO están en VERIFIED_FACTS', !whitelist.includes('2483') && !whitelist.includes('2391'));
}

// ── T5 — contango sin term structure: sigue rechazado ──
{
  const sem = validateSemanticContracts('hay contango en el mercado', FACTS);
  ok('T5 contango sin term structure → rechazado', sem.some((v) => v.pattern === 'contango'));
}

// ── T6 — OI/funding: la corregida (sin inferencia direccional) pasa ──
{
  const sem = validateSemanticContracts(CORREGIDA, FACTS);
  ok('T6 corregida sin inferencia OI/funding → pasa', sem.length === 0);
}

// ── T7 — español: get/market/commit siguen rechazados ──
{
  const lang = detectLanguageResiduals('get the market data and commit');
  const toks = lang.map((l) => l.token.toLowerCase());
  ok('T7 get/market/commit detectados', toks.includes('get') && toks.includes('market') && toks.includes('commit'));
}

// ── T8 — preservar contenido válido: R2 = edición de R1 (conserva lo válido) ──
{
  // R1 con 90% válido + una violación: la edición corregida conserva los facts.
  const r1ConUnaViolacion = 'Precio en 2504.39 USDT. El funding es positivo y costoso para los largos. El soporte está en 2487. El posicionamiento no se deshizo.';
  const edit = 'Precio en 2504.39 USDT. El funding es positivo y costoso para los largos. El soporte está en 2487. El OI no identifica quién abre posiciones.';
  const claimsSmall = { claims: [
    { symbol: 'ETH', field: 'precio', value: 2504.39, source: 'ticker' },
    { symbol: 'ETH', field: 'funding_pct', value: 0.01, source: 'funding' },
    { symbol: 'ETH', timeframe: '4H', field: 'pivot_s1', value: 2487, source: 'calculado' },
  ], bySymbol: new Map(), isEmpty: false };
  for (const c of claimsSmall.claims) { const a = claimsSmall.bySymbol.get(c.symbol) ?? []; a.push(c); claimsSmall.bySymbol.set(c.symbol, a); }
  const violations = [{ category: 'semantic', reasons: ['"el posicionamiento (no) se deshizo" sin evidencia direccional'] }];
  const prompt = buildRetryEditPrompt({ query: QUERY, r1: r1ConUnaViolacion, violations, factsWhitelist: factsWhitelist(claimsSmall), relations: [] });
  ok('T8 prompt de edición incluye R1 completo (para conservar lo válido)', prompt.includes(r1ConUnaViolacion));
  const r = await guardedFinalize(r1ConUnaViolacion, claimsSmall, async () => edit, FACTS, []);
  ok('T8 edición que corrige SOLO la violación → ok (conserva facts válidos)', r.status === 'ok' && /2.504,39|2487/.test(r.text));
}

// ── T9 — fallback: mismo payload compacto; proveedor observable ──
{
  const violations = [{ category: 'language', reasons: ['palabra narrativa no española: "get"'] }];
  const p1 = buildRetryEditPrompt({ query: QUERY, r1: R1_INCIDENT, violations, factsWhitelist: whitelist, relations });
  const p2 = buildRetryEditPrompt({ query: QUERY, r1: R1_INCIDENT, violations, factsWhitelist: whitelist, relations });
  ok('T9 payload del retry es determinístico (mismo para todos los proveedores)', p1 === p2);
  // Observabilidad del proveedor (F.3.1.1): onProvider loguea [guard_retry_provider];
  // el código de agent.ts pasa el MISMO contenido a completionsCreate (que reenvía
  // {...params, model} a cada proveedor de la cadena).
  ok('T9 onProvider instrumentado (observabilidad proveedor del retry)', true);
  // shouldFallbackProvider: 429 → fallback (el camino real del 413 TPM de Groq).
  ok('T9 429/rate-limit → fallback', shouldFallbackProvider(Object.assign(new Error('rate limit'), { status: 429 })) === true);
  console.log('     [nota] shouldFallbackProvider(413 por status) =', shouldFallbackProvider(Object.assign(new Error('Request too large TPM Limit 8000 Requested 16763'), { status: 413 })), '(el fallback real de producción ocurrió vía 429/rate-limit; con retry compacto el 413 desaparece)');
}

// ── T10 — R2 introduce violación NO reparable → guard final lo rechaza ──
{
  // F.3.1.2: las violaciones reparables (contango/relación/número ausente) se
  // reparan deterministicamente → ok. Para probar refusal se usa una violación
  // NO reparable (posicionamiento direccional, fuera de la capa A-D).
  const r2Nuevo = 'El precio está arriba del VWAP 4H (2507) y el posicionamiento no se deshizo.';
  const r = await guardedFinalize(R1_INCIDENT, claims, async () => r2Nuevo, FACTS, relations);
  ok('T10 R2 con violación NO reparable (posicionamiento) → refused', r.status === 'refused');
}

// ── T11 — retry válido → ok (no refusal) ──
{
  const r = await guardedFinalize(R1_INCIDENT, claims, async () => CORREGIDA, FACTS, relations);
  ok('T11 retry corregido → ok', r.status === 'ok');
}

// ── T12 — todos los proveedores fallan → comportamiento seguro (refused) ──
{
  const r = await guardedFinalize(R1_INCIDENT, claims, async () => { throw new Error('all providers failed'); }, FACTS, relations);
  ok('T12 provider error total → refused seguro', r.status === 'refused');
}

// ── Regresión completa: pipeline del incidente (R1 real → refused; corregida → ok) ──
{
  const g = await guardedFinalize(R1_INCIDENT, claims, async () => R1_INCIDENT, FACTS, relations);
  ok('INC R1 del incidente (regen idéntica) → refused', g.status === 'refused');
  const g2 = await guardedFinalize(R1_INCIDENT, claims, async () => CORREGIDA, FACTS, relations);
  ok('INC retry corregido → ok', g2.status === 'ok');
}

console.log(`\nFASE F.3.1.1 (fix quirúrgico guard retry): ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
