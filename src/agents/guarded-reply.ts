import { validateReply } from '../utils/validator.js';
import type { ClaimSet } from './claims.js';
import {
  validateSemanticContracts,
  validateNumericRelations,
  translateTechnicalResiduals,
  type SemanticFacts,
} from './semantic-guard.js';
import { repairResponseDeterministic, hasMarketContent } from './deterministic-repair.js';
import type { RelationFact } from './synthesis.js';

/**
 * RESPUESTA ANTE VIOLACIÓN (FASE C + F.2 + F.3 + F.3.1).
 * 1ª violación → máximo 1 regeneración SIN tools, pidiendo usar solo datos verificados.
 * 2ª violación → negativa segura (no inventar reemplazo).
 * F.2: valida CONTRATOS SEMÁNTICOS (contango/backwardation sin term structure,
 * OI→longs, funding extremo, "presión confirmada", inglés residual).
 * F.3: (a) primero REPARA residuos traducibles (translateTechnicalResiduals),
 * luego valida; (b) contrato numérico de RELACIONES (validateNumericRelations):
 * la narración no puede contradecir los hechos calculados (ej. "arriba del
 * VWAP" cuando el hecho dice BELOW); (c) OI/posicionamiento, funding y volumen
 * sin benchmark; (d) detección robusta de inglés/italiano narrativo + corrupción.
 * F.3.1: (a) TARGETED RETRY — el retry recibe las razones EXACTAS de r1
 * (categoría + descripción + RelationFact esperado) para corregir SOLO eso;
 * (b) instrumentación r1/retry/r2 (sin loguear prompts completos ni secretos).
 */

export type GuardedResult =
  | { status: 'ok'; text: string }
  | { status: 'refused'; reason: string };

/** Resumen estructurado y acotado de una violación (para el retry dirigido). */
export interface ViolationSummary {
  category: 'numeric' | 'semantic' | 'relations' | 'language';
  reasons: string[];
}

/** Texto seguro cuando el modelo insiste en números sin respaldo. */
export const GUARD_REFUSAL_TEXT =
  'No tengo datos verificados suficientes para darte ese valor con confianza.';

/** Prompt de regeneración base (extensible con violaciones específicas). */
export const GUARD_RETRY_PROMPT =
  'Reescribí tu respuesta usando EXCLUSIVAMENTE los datos verificados del contexto (DATOS REALES YA OBTENIDOS y resultados de herramientas). ' +
  'No cites ningún número de mercado ni indicador que no esté respaldado: no estimes, no inventes, no uses tu memoria. ' +
  'Contratos SEMÁNTICOS obligatorios: nunca uses "contango" ni "backwardation" (son perpetuos, no hay term structure); ' +
  'el OI y el funding nunca demuestran por sí solos quién abre/cierra posiciones (no digas "entraron longs", "el posicionamiento no se deshizo" ni "históricamente alto de posicionamiento largo"); ' +
  'el funding nunca es "altísimo/extremo/récord/históricamente alto" sin benchmark; ' +
  'sin benchmark de volumen NO uses "con volumen", "volumen confirma" ni "ventas confirmadas": decí "aumentaría la evidencia bajista"; ' +
  'la pérdida de un nivel aumenta o disminuye EVIDENCIA, nunca es "señal de venta"; ' +
  'RESPETÁ las relaciones numéricas calculadas: si el hecho dice que el precio está DEBAJO del VWAP (BELOW), NUNCA digas "arriba del VWAP", "superó el VWAP" ni "recuperó el VWAP"; ' +
  'sin inglés narrativo ni texto mezclado (nada de "flat", "flip", "Little room for error", italiano, palabras fusionadas); ' +
  'Si un dato no está disponible, decilo explícitamente. Respondé con texto únicamente.';

/**
 * F.3.1 — CAMBIO 1: prompt de regeneración DIRIGIDO por las violaciones reales de r1.
 * Compacto y determinístico (no dumps ni prompts completos): categoría +
 * descripción concreta + RelationFact esperado (ya incluido en la razón de
 * relaciones) + instrucción de corregir SOLO eso, conservando lo validado.
 */
export function buildTargetedRetryPrompt(violations: ViolationSummary[]): string {
  if (violations.length === 0) return GUARD_RETRY_PROMPT;
  const lines: string[] = [];
  for (const v of violations) {
    const cat = v.category.toUpperCase();
    for (const reason of v.reasons) {
      lines.push(`${cat}: ${reason}`);
    }
  }
  return (
    'Tu respuesta anterior fue RECHAZADA por el control de calidad. Corregí SOLAMENTE estas violaciones:\n' +
    lines.join('\n') +
    '\n- Conservá TODOS los números y hechos ya validados (no los modifiques ni los inventes).\n' +
    '- No inventes datos ni relaciones nuevos.\n' +
    '- Respetá los contratos semánticos y numéricos del contexto.\n' +
    '- Respondé SOLO con el texto corregido, sin explicaciones.'
  );
}

/** Entrada para el retry de EDICIÓN RESTRINGIDA (F.3.1.1): nada más que esto. */
export interface RetryEditInput {
  /** Consulta original del usuario. */
  query: string;
  /** Respuesta R1 (a editar, no a rehacer). */
  r1: string;
  /** Violaciones exactas de r1 (categoría + razones). */
  violations: ViolationSummary[];
  /** Whitelist compacta de números/hechos verificados permitidos. */
  factsWhitelist: string;
  /** Relaciones calculadas (label/valor/relación). */
  relations: readonly RelationFact[];
}

/**
 * F.3.1.1 — retry como EDICIÓN RESTRINGIDA de R1 (no regeneración abierta).
 * Payload compacto y autosuficiente en UN mensaje de usuario: consulta + R1 +
 * violaciones + whitelist de facts + relations + reglas críticas. NO reenvía
 * system prompt, historial, tool schemas ni dumps de datos.
 */
export function buildRetryEditPrompt(input: RetryEditInput): string {
  const relLines =
    input.relations.length > 0
      ? input.relations.map((r) => `- precio vs ${r.label} (${r.value}) → ${r.relation}`).join('\n')
      : '- (sin relaciones calculadas disponibles)';
  return [
    'Editá la respuesta anterior (R1). Corregí ÚNICAMENTE las violaciones indicadas. Conservá el contenido válido.',
    'No rehagas el análisis desde cero. No introduzcas números, niveles, datos ni conceptos de mercado nuevos.',
    'Usá únicamente números y hechos presentes en VERIFIED_FACTS o ya presentes en R1.',
    'Si un dato necesario no está verificado, omitilo.',
    'No infieras dirección de participantes desde OI/funding.',
    'Sin term structure verificada, no uses contango ni backwardation.',
    'Respondé en español, sin palabras en inglés. No menciones estas instrucciones.',
    '',
    'CONSULTA ORIGINAL:',
    input.query,
    '',
    'RESPUESTA ANTERIOR (R1):',
    input.r1,
    '',
    'VIOLACIONES A CORREGIR:',
    buildTargetedRetryPrompt(input.violations),
    '',
    'VERIFIED_FACTS (números permitidos):',
    input.factsWhitelist,
    '',
    'RELATION_FACTS (relaciones calculadas):',
    relLines,
    '',
    'Respondé SOLO con el texto corregido.',
  ].join('\n');
}

function getViolationSummary(
  candidate: string,
  claims: ClaimSet,
  facts: SemanticFacts,
  relations: readonly RelationFact[],
): ViolationSummary[] {
  const results: ViolationSummary[] = [];

  const num = validateReply(candidate, claims);
  if (!num.valid) {
    results.push({
      category: 'numeric',
      reasons: num.violations.map((v) => v.reason),
    });
  }

  const sem = validateSemanticContracts(candidate, facts);
  if (sem.length > 0) {
    results.push({
      category: 'semantic',
      reasons: sem.map((v) => v.reason),
    });
  }

  const rel = validateNumericRelations(candidate, relations);
  if (rel.length > 0) {
    results.push({
      category: 'relations',
      reasons: rel.map((v) => v.reason),
    });
  }

  return results;
}

export async function guardedFinalize(
  candidate: string,
  claims: ClaimSet,
  regenerate: (violations?: ViolationSummary[]) => Promise<string>,
  semanticFacts: SemanticFacts = {
    termStructureVerified: false,
    evidenceDirectionalPositioning: false,
    fundingBenchmarkAvailable: false,
    volumeBenchmarkAvailable: false,
  },
  relations: readonly RelationFact[] = [],
): Promise<GuardedResult> {
  // F.3 — reparar primero los residuos traducibles ("premium sigue flat" →
  // "premium sigue plano") y validar sobre el texto reparado. Si el residuo NO
  // es traducible ("molto", "largapgando"), la validación lo detecta y regenera.
  const translated = translateTechnicalResiduals(candidate);
  const r1 = getViolationSummary(translated, claims, semanticFacts, relations);

  if (r1.length === 0) {
    console.log(`[guard_r1_ok]`);
    return { status: 'ok', text: translateTechnicalResiduals(candidate) };
  }

  console.log(`[guard_r1_rejected] ${JSON.stringify({
    categories: r1.map((v) => v.category),
    reasons: r1.flatMap((v) => v.reasons),
  })}`);

  // F.3.1 — el retry recibe las violaciones EXACTAS de r1 (categoría + razón +
  // RelationFact esperado) para corregir SOLO eso. La regeneración puede fallar
  // (400 de tools con tool_choice 'none', 429, red): en ese caso NO se envía la
  // respuesta violadora → negativa segura.
  // NOTA (F.3.1.1): `violations` cuenta CATEGORÍAS con violaciones (r1.length),
  // no razones individuales; las razones completas viajan en el array r1 al
  // callback (sin pérdida de información). `reasons_count` se agrega para
  // observabilidad inequívoca.
  const r1ReasonsCount = r1.flatMap((v) => v.reasons).length;
  console.log(`[guard_retry_start] ${JSON.stringify({ reason: 'r1_rejected', violations: r1.length, reasons_count: r1ReasonsCount })}`);
  let retriedText = '';
  try {
    retriedText = await regenerate(r1);
  } catch (e) {
    console.log(`[guard_retry_provider_error] ${JSON.stringify({ error: String(e) })}`);
    return { status: 'refused', reason: 'regeneración falló (error de proveedor)' };
  }

  const translated2 = translateTechnicalResiduals(retriedText);
  const r2 = getViolationSummary(translated2, claims, semanticFacts, relations);

  if (r2.length === 0) {
    console.log(`[guard_r2_ok]`);
    return { status: 'ok', text: translated2 };
  }

  // F.3.1.2 — CAPA DETERMINISTA entre R2 y el guard final (sin tercer LLM):
  // repara lo reparable (números no verificados → elimina cláusula; contango/
  // backwardation sin term structure → elimina; volumen sin benchmark →
  // neutraliza; relaciones invertidas → canonicaliza con el fact). El guard
  // final re-valida TODO después de la reparación (no se relaja). Si el repair
  // deja un texto vacío o sin contenido de mercado (solo fragmentos como
  // "Reitero"), NO es una respuesta válida → refused.
  const repaired = repairResponseDeterministic(translated2, claims, semanticFacts, relations);
  const repairedTrimmed = repaired.trim();
  // Si el repair deja un texto vacío o sin contenido de mercado (solo fragmentos
  // como "Reitero"), NO es una respuesta válida → refused; la razón conserva las
  // violaciones ORIGINALES de r2 (por qué R2 fue rechazado).
  const degenerate =
    repairedTrimmed.length === 0 || !hasMarketContent(repairedTrimmed, claims, relations);
  const r2r = degenerate ? r2 : getViolationSummary(repairedTrimmed, claims, semanticFacts, relations);
  if (r2r.length === 0) {
    console.log(`[guard_r2_repaired_ok] ${JSON.stringify({ approx_chars: repairedTrimmed.length })}`);
    return { status: 'ok', text: repairedTrimmed };
  }

  console.log(`[guard_r2_rejected] ${JSON.stringify({
    categories: r2r.map((v) => v.category),
    reasons: r2r.flatMap((v) => v.reasons),
  })}`);

  return {
    status: 'refused',
    reason: r2r.flatMap((v) => v.reasons).join(' | '),
  };
}
