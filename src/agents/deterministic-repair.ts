/**
 * F.3.1.2 — CAPA DE REPARACIÓN DETERMINISTA entre R2 y el guard final.
 *
 * Problema real v14: el retry dirigido funcionó (payload compacto, sin 413),
 * pero R2 seguía conteniendo números no verificados (2480/2481/2349),
 * contango/backwardation sin term structure, "volumen confirma" sin benchmark
 * y relaciones ABOVE/BELOW invertidas. El guard final lo detectaba y solo
 * podía REFUSAR → refusal. Esta capa repara lo reparable SIN tercer LLM:
 *
 *   R2 → deterministic repair → guard final (re-valida TODO) → respuesta
 *
 * A. NÚMEROS: cláusula con número de mercado NO respaldado por ningún claim →
 *    se ELIMINA (no se inventa reemplazo).
 * B. TERM STRUCTURE: sin term structure → cláusula con contango/backwardation
 *    → se ELIMINA.
 * C. RELACIONES: cláusula que contradice una relación calculada → se
 *    CANONICALIZA con el fact (por encima/arriba ↔ por debajo); si la frase
 *    no es reparable (superó/recuperó/perdió…) → se ELIMINA la cláusula.
 * D. VOLUMEN: sin benchmark → cláusula de "confirmación por volumen" →
 *    se ELIMINA (la descripción neutral respaldada se conserva).
 * E. IDIOMA: translateTechnicalResiduals (idempotente; ya aplicado upstream).
 *
 * PRINCIPIO: es mejor perder una cláusula que rechazar todo el análisis o
 * inventar información. El guard final NO se relaja y re-valida la reparación.
 */

import { parseMarketNumber } from '../utils/numbers.js';
import { isMarketNumberBacked } from '../utils/validator.js';
import type { ClaimSet } from './claims.js';
import type { RelationFact } from './synthesis.js';
import {
  translateTechnicalResiduals,
  REL_CONDITIONAL_RE,
  relationHits,
  findLevelMention,
  VOLUME_CONF_RE,
  negatedVolumeClause,
  type SemanticFacts,
} from './semantic-guard.js';

/** Números candidatos (misma forma que el validator: NUM_RE). */
const NUM_RE = /[−–-]?[\d][\d.,]*(?:[kKmMbB%])?/g;

/** Palabras de mercado: un número en una cláusula con estas es "de mercado". */
const MARKET_WORD_RE =
  /\b(soporte|resistencia|nivel|niveles|m[áa]ximo|m[íi]nimo|piso|techo|zona|banda|vwap|supertrend|pivot|pivots|fib|fibonacci|media|medias|cierre|precio|funding|open interest|\bOI\b|rsi|ruptura|donchian|keltner|bollinger|ema|sma|wma|hma|vwma|atr|adx|mfi|macd|stochastic|stoch|cci|williams|roc|obv|cmf|dominancia|capitalizaci[oó]n|inter[eé]s abierto|quiebre)\b/i;

const TF_RE = /\b(?:1W|1D|4H|1H|15m|5m|1M)\b|\b\d{1,3}\s*[HhMmWwDd]\b/;
const SYMBOL_RE = /\b(?:BTC|ETH|SOL|XRP|DOGE|ADA|DOT|LTC|BNB|AVAX|LINK|ARB|OP|SUI|APT)\b/i;

/** Ventana máxima frase-relación ↔ mención (misma que semantic-guard). */
const RELATION_WINDOW = 90;

/** ¿La cláusula contiene un número de mercado NO respaldado por ningún claim? */
function clauseHasUnbackedMarketNumber(clause: string, claims: ClaimSet): boolean {
  for (const m of clause.matchAll(NUM_RE)) {
    const token = m[0];
    const idx = m.index ?? 0;
    if (/^\d{1,3}\s*[HhMmWwDd]$/i.test(token)) continue; // "4H"/"15m"
    const before = clause[idx - 1] ?? '';
    if (/[A-Za-z]/.test(before)) continue; // parte de un label tipo EMA20
    const beforeCtx = clause.slice(Math.max(0, idx - 12), idx);
    if (/\b(EMA|SMA|WMA|HMA|MMA|VWAP)\s*$/i.test(beforeCtx)) continue; // "EMA 20"
    if (/^\s*[HhMmWwDd]/.test(clause.slice(idx + token.length))) continue; // "4H"
    // Quitar puntuación final ("2349." → "2349", "84.6." → "84.6") para parsear.
    const cleanToken = token.replace(/[.,;:!?…)\]"']+$/g, '');
    if (!cleanToken) continue;
    const value = parseMarketNumber(cleanToken);
    if (value === null) continue;
    // ¿es un número de mercado? (sufijo de unidad, palabra de mercado, o cifra
    // grande en contexto de TF/símbolo)
    const market =
      /[%$]$/.test(token) ||
      /[kKmMbB]$/.test(token) ||
      (Math.abs(value) >= 100 && MARKET_WORD_RE.test(clause)) ||
      (Math.abs(value) >= 1000 && (TF_RE.test(clause) || SYMBOL_RE.test(clause)));
    if (!market) continue;
    if (!isMarketNumberBacked(value, claims)) return true;
  }
  return false;
}

/** Frases relacionales reemplazables para canonicalizar a BELOW. */
const REPLACE_TO_BELOW: ReadonlyArray<[RegExp, string]> = [
  [/\bpor encima del\b/gi, 'por debajo del'],
  [/\bpor encima de\b/gi, 'por debajo de'],
  [/\barriba del\b/gi, 'por debajo del'],
  [/\barriba de\b/gi, 'por debajo de'],
  [/\bencima del\b/gi, 'por debajo del'],
  [/\bencima de\b/gi, 'por debajo de'],
];

/** Frases relacionales reemplazables para canonicalizar a ABOVE. */
const REPLACE_TO_ABOVE: ReadonlyArray<[RegExp, string]> = [
  [/\bpor debajo del\b/gi, 'por encima del'],
  [/\bpor debajo de\b/gi, 'por encima de'],
  [/\bdebajo del\b/gi, 'por encima del'],
  [/\bdebajo de\b/gi, 'por encima de'],
];

/**
 * Canonicaliza la relación de la cláusula con el fact CANONICAL.
 * Devuelve la cláusula reparada o null si la frase NO es reparable
 * (→ la cláusula debe ELIMINARSE; nunca se infiere dirección del texto).
 */
function canonicalizeRelation(clause: string, canonical: 'ABOVE' | 'BELOW'): string | null {
  const table = canonical === 'BELOW' ? REPLACE_TO_BELOW : REPLACE_TO_ABOVE;
  for (const [re, repl] of table) {
    if (re.test(clause)) return clause.replace(re, repl).replace(/\bde el\b/gi, 'del');
  }
  if (canonical === 'BELOW') {
    const m = clause.match(/\b(est[aá]|queda|sigue|opera|cotiza|se mantiene|viene|anda)\s+sobre\b/i);
    if (m) {
      return (clause.slice(0, m.index) + clause.slice(m.index).replace(/\bsobre\b/i, 'por debajo de'))
        .replace(/\bde el\b/gi, 'del');
    }
  } else {
    const m = clause.match(/\b(est[aá]|queda|sigue|opera|cotiza|se mantiene|viene|anda)\s+bajo\b/i);
    if (m) {
      return (clause.slice(0, m.index) + clause.slice(m.index).replace(/\bbajo\b/i, 'por encima de'))
        .replace(/\bde el\b/gi, 'del');
    }
  }
  return null; // superó/recuperó/perdió/rompió… → no reparable → descartar
}

function nearestRelationHit(clause: string, mentionIndex: number): { direction: 'ABOVE' | 'BELOW' } | null {
  const hits = relationHits(clause);
  if (hits.length === 0) return null;
  let nearest: { direction: 'ABOVE' | 'BELOW' } | null = null;
  let best = Infinity;
  for (const h of hits) {
    const d = Math.abs(h.index - mentionIndex);
    if (d < best) {
      best = d;
      nearest = { direction: h.direction };
    }
  }
  return best <= RELATION_WINDOW ? nearest : null;
}

/** Repara (o descarta) una cláusula. keep=false → la cláusula se elimina. */
function repairClause(
  rawClause: string,
  claims: ClaimSet,
  facts: SemanticFacts,
  relations: readonly RelationFact[],
): { keep: boolean; text: string } {
  const clause = rawClause.trim();
  if (!clause) return { keep: false, text: rawClause };

  // B. TERM STRUCTURE: sin term structure → contango/backwardation se eliminan.
  if (facts.termStructureVerified !== true && /\bcontango\b|\bbackwardation\b/i.test(clause)) {
    return { keep: false, text: clause };
  }

  // D. VOLUMEN: sin benchmark → "confirmación por volumen" se elimina.
  if (facts.volumeBenchmarkAvailable !== true && VOLUME_CONF_RE.test(clause) && !negatedVolumeClause(clause)) {
    return { keep: false, text: clause };
  }

  // C. RELACIONES: canonicalizar con el fact; frases no reparables → descartar.
  let c = clause;
  if (!REL_CONDITIONAL_RE.test(c)) {
    for (const fact of relations) {
      if (fact.relation === 'AT') continue;
      const mention = findLevelMention(c, fact, relations);
      if (mention === null) continue;
      const nearest = nearestRelationHit(c, mention);
      if (!nearest) continue;
      const contradicts =
        (nearest.direction === 'ABOVE' && fact.relation === 'BELOW') ||
        (nearest.direction === 'BELOW' && fact.relation === 'ABOVE');
      if (!contradicts) continue;
      const repaired = canonicalizeRelation(c, fact.relation);
      if (repaired === null) return { keep: false, text: c };
      c = repaired;
    }
  }

  // A. NÚMEROS: cláusula con número de mercado sin respaldo → eliminar.
  if (clauseHasUnbackedMarketNumber(c, claims)) {
    return { keep: false, text: c };
  }

  return { keep: true, text: c };
}

/**
 * F.3.1.2 — ¿el texto reparado conserva contenido de mercado real (número,
 * palabra de mercado o mención de una relación)? Un repair que deja solo
 * fragmentos degenerados ("Reitero", "Ok") no es una respuesta válida.
 */
export function hasMarketContent(
  text: string,
  claims: ClaimSet,
  relations: readonly RelationFact[],
): boolean {
  if (MARKET_WORD_RE.test(text)) return true;
  if (/\d/.test(text)) return true;
  for (const r of relations) {
    const word = r.label.split(/\s+/)[0];
    if (word && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) return true;
  }
  return claims.claims.length === 0; // sin claims, cualquier texto es lo único posible
}

/**
 * Repara determinísticamente R2 ANTES del guard final. Elimina cláusulas con
 * números no verificados, contango/backwardation sin term structure y
 * "confirmación por volumen" sin benchmark; canonicaliza relaciones invertidas.
 * Preserva el contenido válido; nunca inventa información; no llama al LLM.
 */
export function repairResponseDeterministic(
  text: string,
  claims: ClaimSet,
  facts: SemanticFacts,
  relations: readonly RelationFact[],
): string {
  // E. idioma: reparaciones existentes (idempotente; ya aplicado upstream).
  const translated = translateTechnicalResiduals(text);
  const sentences = translated.split(/(?<=[.!?])\s+/);
  const rebuiltSentences: string[] = [];
  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    const parts = sentence.split(/([;:—–]|\s+(?:y|pero|aunque|sin embargo|porque|sino)\s+|,\s+)/);
    const results = parts.map((p, i) =>
      i % 2 === 0 ? repairClause(p, claims, facts, relations) : { keep: true, text: p },
    );
    const rebuilt: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      if (i % 2 === 0) {
        const res = results[i];
        if (res !== undefined && res.keep) rebuilt.push(res.text.trim());
      } else {
        const prev = results[i - 1];
        const next = results[i + 1];
        if (prev !== undefined && next !== undefined && prev.keep && next.keep) rebuilt.push(part);
      }
    }
    const sentenceOut = rebuilt.join('').replace(/\s{2,}/g, ' ').trim();
    if (sentenceOut) rebuiltSentences.push(sentenceOut);
  }
  return rebuiltSentences.join(' ').replace(/\s{2,}/g, ' ').trim();
}
