/**
 * SANITIZACIÓN DE SALIDA + FORMATO PROFESIONAL (auditoría de fidelidad).
 *
 * Problemas reales observados en producción ("Analizame ETH ahora"):
 * 1. Caracteres CJK ("SuperTrend日报") y tokens basura ("tendenciaup",
 *    "parachirurgical", "structure semanal") — ruido del LLM/fallback.
 * 2. `**1D**` literal en Telegram — el reply no usa parse_mode.
 * 3. Cifras sin unidad ("SuperTrend en 2391" en vez de "2.391 USD").
 *
 * Este módulo NO mutila contenido técnico: solo quita caracteres no latinos
 * (CJK), tokens de ruido conocidos, normaliza la puntuación y convierte
 * markdown `**bold**` a `<b>bold</b>` con escape HTML seguro para Telegram.
 */

/** Rango CJK unificado (chino/japonés/coreano) + kana/hangul + fullwidth. */
const CJK_RE =
  /[\u2E80-\u2EFF\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7AF\uF900-\uFAFF\uFF01-\uFF60]/g;

/** Tokens de ruido observados en respuestas reales (reemplazo → limpieza). */
const NOISE_TOKENS: ReadonlyArray<[RegExp, string]> = [
  // "tendencia" pegado a direction del SuperTrend ("tendenciaup")
  [/tendencia\s*(up|down|arriba|abajo)\b/gi, 'tendencia $1'],
  // inglés intercalado obvio que no aporta
  [/\b(parachirurgical|chirurgical)\b/gi, 'quirúrgico'],
  [/\bstructure\b/gi, 'estructura'],
  // residuos de generación en inglés sin significado en es-AR (defecto D):
  // "underway", "commit"/"Commit" suelto, "TODO"/"FIXME" de contexto de sistema.
  [/\bunderway\b/gi, ''],
  [/\bcommit(?:ted)?\b/gi, ''],
  [/\bTODO\b|\bFIXME\b/gi, ''],
  // inglés técnico residual del LLM (FASE F.1): "annualized" → "anualizado".
  [/\bannualized\b/gi, 'anualizado'],
  // muletillas de ruido
  [/^\s*[-*•]\s*$/gm, ''],
];

/**
 * Corrige tokens pegados por punto ("palabra.Palabra" → "palabra. Palabra").
 * ORIGEN REAL del residuo "antes de.Commit." (defecto D): el LLM emitió un
 * punto pegado a la siguiente palabra capitalizada. Esta regla ESTRUCTURAL
 * separa cualquier "minúscula.Mayúscula" (no es un replace de "commit"):
 * - "de.Commit." → "de. Commit."
 * - NO toca números ("2.391"), siglas ("EE.UU."), abreviaturas ("e.g.") ni
 *   decimales ("-0.0007"): requieren minúscula → mayúscula sin espacio.
 */
const GLUED_PUNCT_RE = /([a-záéíóúñü])\.([A-ZÁÉÍÓÚÑÜ])/g;

/** Espacios colgantes / múltiples líneas vacías. */
const WHITESPACE_RE = /\n{3,}/g;

/**
 * Normaliza puntuación residual de la limpieza de tokens:
 * - puntos duplicados ("de..") → uno solo;
 * - espacios múltiples → uno solo.
 * No toca decimales ("2.391") ni abreviaturas ("EE.UU.").
 */
const DUP_PUNCT_RE = /\.{2,}/g;
const DUP_SPACE_RE = /[ \t]{2,}/g;

/**
 * Limpia la salida del LLM: quita caracteres CJK, tokens de ruido, corrige
 * puntuación pegada y normaliza saltos de línea. No toca números, % ni símbolos.
 */
export function sanitizeOutput(text: string): string {
  let out = text.replace(CJK_RE, '');
  for (const [re, rep] of NOISE_TOKENS) out = out.replace(re, rep);
  out = out.replace(GLUED_PUNCT_RE, '$1. $2');
  out = out.replace(DUP_PUNCT_RE, '.');
  out = out.replace(DUP_SPACE_RE, ' ');
  out = out.replace(WHITESPACE_RE, '\n\n').trim();
  return out;
}

/** Escapa caracteres HTML reservados (para parse_mode HTML de Telegram). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Convierte markdown `**bold**` a `<b>bold</b>` con escape HTML de todo lo que
 * no sea un tag generado. Seguro para parse_mode 'HTML' de Telegram: escapa
 * `&`, `<`, `>` del resto del texto (números, %, guiones y paréntesis intactos).
 */
export function markdownBoldToHtml(text: string): string {
  // Fase 1: marcar los pares **...** con placeholders para no escaparlos.
  const parts: string[] = [];
  let rest = text;
  let bold = false;
  let idx = rest.indexOf('**');
  while (idx !== -1) {
    parts.push(escapeHtml(rest.slice(0, idx)));
    parts.push(bold ? '</b>' : '<b>');
    bold = !bold;
    rest = rest.slice(idx + 2);
    idx = rest.indexOf('**');
  }
  parts.push(escapeHtml(rest));
  if (bold) {
    // par sin cerrar → el último <b> sobra
    const last = parts.pop() ?? '';
    parts.push(last.replace(/<b>$/, ''));
  }
  return parts.join('');
}

/** Da unidad a un número de precio/nivel según contexto (precio → USD). */
export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 's/d';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD`;
}

/**
 * TRUNCAMIENTO CONTROLADO (FASE F.1): cierra semánticamente un texto que el
 * PROVEEDOR cortó por límite de tokens. Esta función SOLO debe invocarse cuando
 * isLengthTruncation(finishReason) === true (el call-site en agent.ts lo
 * garantiza): la DETECCIÓN la decide finish_reason, esta función solo decide
 * CÓMO cerrar el texto. NO infiere truncamiento por longitud del texto.
 *
 * Reglas:
 * 1. Conserva la mayor porción semánticamente completa.
 * 2. Corta en límite seguro de párrafo (\n\n) u oración (".", "!", "?", "…").
 * 3. Elimina el fragmento final incompleto (nunca deja palabra/ora. rota).
 * 4. Agrega el aviso canónico de truncamiento.
 * 5. Fallback: si no hay ningún límite completo, conserva el texto (nunca vacío)
 *    y agrega el aviso.
 */
export const TRUNCATION_NOTICE =
  '\n\n(Análisis recortado por límite de longitud; puedo continuar si querés.)';

/** ¿El texto termina en un límite de oración/párrafo completo? */
const ENDS_COMPLETE_RE = /[.!?…]["'”»]?\s*$/;

/**
 * F.3 — PALABRAS FUNCIONALES DE CIERRE (clase cerrada del español) que NO pueden
 * terminar una oración: preposiciones, conjunciones y artículos. NO es una
 * blacklist de fragmentos observados ("antes de.", "y el timing"): es una
 * propiedad lingüística general — una oración no termina en "de", "el", "que"…
 * Detecta "antes de.", "porque el", "mientras que" y cualquier variante nueva.
 */
const DANGLING_FINAL_WORDS = new Set([
  'de', 'del', 'al', 'a', 'en', 'con', 'sin', 'para', 'por', 'sobre', 'bajo',
  'entre', 'hasta', 'hacia', 'desde', 'ante', 'contra', 'tras', 'según',
  'y', 'o', 'e', 'u', 'ni', 'pero', 'aunque', 'que', 'porque', 'si', 'cuando',
  'mientras', 'como', 'pues', 'sino', 'un', 'una', 'unos', 'unas', 'el', 'la',
  'los', 'las', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'su', 'sus', 'mi', 'tu', 'cual', 'cuyo', 'cada', 'muy', 'tan', 'tal',
]);

/** Coordinador + artículo(+sustantivo) al final: "y el timing", "porque el…". */
const DANGLING_COORD_RE =
  /\b(?:y|o|e|u|ni|pero|aunque|porque|que|si|cuando|mientras|como|pues|sino)\s+(?:el|la|los|las|un|una|unos|unas|este|esta|ese|esa|su|sus|mi|tu|al|del)(?:\s+\S+)?$/i;

function lastWords(sentence: string, n: number): string[] {
  return sentence
    .replace(/["'”»)\].,;:!?…]+$/g, '')
    .trimEnd()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-n);
}

/**
 * Clasifica el final del texto:
 * - 'complete': termina en oración cerrada y sin palabra colgante.
 * - 'dangling': termina con puntuación pero la última(s) palabra(s) no cierran
 *   la oración ("antes de.", "y el timing.", "porque el.").
 * - 'mid-sentence': no termina en puntuación (fragmento crudo).
 */
export function classifyEnding(text: string): 'complete' | 'dangling' | 'mid-sentence' {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return 'complete';
  if (trimmed.endsWith(TRUNCATION_NOTICE)) return 'complete';
  if (!ENDS_COMPLETE_RE.test(trimmed)) return 'mid-sentence';
  const sentence = trimmed.replace(ENDS_COMPLETE_RE, '');
  const words = lastWords(sentence, 3);
  if (words.length === 0) return 'complete';
  const last = (words[words.length - 1] ?? '').toLowerCase();
  if (DANGLING_FINAL_WORDS.has(last)) return 'dangling';
  if (DANGLING_COORD_RE.test(sentence)) return 'dangling';
  return 'complete';
}

/** ¿El texto termina de forma completa (para truncateSafe)? */
function isCompleteEnding(text: string): boolean {
  return classifyEnding(text) === 'complete';
}

/** Última posición de una oración completa (no colgante) dentro del texto. */
function lastCompleteSentenceEnd(text: string): number {
  const sentRe = /[.!?…](?=\s|$)/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = sentRe.exec(text)) !== null) {
    const candidate = text.slice(0, m.index + 1);
    if (isCompleteEnding(candidate)) last = m.index + 1;
  }
  return last;
}

/**
 * F.3 — GARANTÍA DE CIERRE para la ruta NO-length (finish_reason 'stop' u otro):
 * si el texto termina en oración colgante o a mitad de oración, recorta a la
 * última oración completa y agrega el aviso. Un texto completo (aunque largo)
 * NUNCA se mutila. También se usa como red final sobre el camino de length.
 */
export function ensureCompleteEnding(text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return trimmed;
  const kind = classifyEnding(trimmed);
  if (kind === 'complete') return trimmed;
  const end = lastCompleteSentenceEnd(trimmed);
  if (end >= 1) return trimmed.slice(0, end).trimEnd() + TRUNCATION_NOTICE;
  // Sin ninguna oración completa: no mutilar más; cerrar con aviso (nunca vacío).
  return trimmed + TRUNCATION_NOTICE;
}

export function truncateSafe(text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return trimmed;

  // 1) El texto ya termina en oración/párrafo completo (y no colgante):
  //    devolverlo INTACTO. (La decisión de avisar por truncamiento la toma el
  //    call-site, que conoce finish_reason — truncateSafe no debe mutilar una
  //    oración válida.)
  if (isCompleteEnding(trimmed)) return trimmed;

  // 2) Cortar en el último párrafo COMPLETO (\n\n seguido de límite de oración).
  const paraIdx = trimmed.lastIndexOf('\n\n');
  if (paraIdx >= 1) {
    const head = trimmed.slice(0, paraIdx).trimEnd();
    if (isCompleteEnding(head)) return head + TRUNCATION_NOTICE;
  }

  // 3) Cortar en la última oración COMPLETA (., !, ?, … seguido de espacio/fin).
  const end = lastCompleteSentenceEnd(trimmed);
  if (end >= 1) return trimmed.slice(0, end).trimEnd() + TRUNCATION_NOTICE;

  // 4) Fallback: sin límite completo, conservar el texto (no vacío) + aviso.
  return trimmed + TRUNCATION_NOTICE;
}

/**
 * DETECCIÓN DE TRUNCAMIENTO: ¿el finish_reason del proveedor indica que la
 * generación se cortó por límite de tokens? (OpenAI: 'length'; otros proveedores
 * usan 'max_tokens' o similares.)
 */
export function isLengthTruncation(finishReason: unknown): boolean {
  if (typeof finishReason !== 'string') return false;
  const r = finishReason.toLowerCase();
  return r === 'length' || r === 'max_tokens' || r === 'max_tokens_reached';
}
