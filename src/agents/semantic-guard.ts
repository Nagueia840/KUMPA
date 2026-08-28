/**
 * GUARD SEMÁNTICO (FASE F.2 + F.3) — contratos determinísticos sobre la respuesta FINAL.
 *
 * Complementa el guard numérico (validator.ts). Los prompts por sí solos no
 * alcanzan: estos contratos bloquean errores críticos de interpretación que el
 * LLM puede reintroducir:
 *
 *  B — contango/backwardation SOLO si termStructureVerified === true.
 *  C — OI/posicionamiento no identifica longs/shorts sin
 *      evidenceDirectionalPositioning (F.2 + F.3: "el posicionamiento no se
 *      deshizo", "lo que te dice que...", funding→persistencia direccional).
 *  D — funding "altísimo/extremo/históricamente alto/récord/anormal" requiere
 *      benchmark documentado (fundingBenchmarkAvailable).
 *  C2 — VOLUMEN como confirmación requiere benchmark (volumeBenchmarkAvailable):
 *      "con volumen", "volumen confirma", "ventas confirmadas", "señal de venta"
 *      sin benchmark → violación (F.3).
 *  H — prohibido "confirmando presión compradora/vendedora".
 *  I — residuos de inglés/italiano narrativo + texto corrupto/fusionado (F.3):
 *      se DETECTAN por lista de palabras narrativas + reglas de corrupción, no
 *      por una lista de reemplazos; los reemplazos seguros se aplican en
 *      translateTechnicalResiduals ANTES de validar.
 *  J — RELACIONES NUMÉRICAS (F.3, bloqueante): si el hecho calculado dice que el
 *      precio está DEBAJO del VWAP, la respuesta NO puede afirmar "arriba del
 *      VWAP" ni equivalentes. validateNumericRelations compara las afirmaciones
 *      relacionales de la respuesta contra los hechos estructurados.
 */

import type { RelationFact } from './synthesis.js';

export interface SemanticFacts {
  /** ¿Existe term structure verificada (futuros con vencimiento vs spot)? Perps: false. */
  termStructureVerified: boolean;
  /** ¿Existe evidencia direccional de posicionamiento (agresor real)? Perps: false. */
  evidenceDirectionalPositioning: boolean;
  /** ¿Existe benchmark de funding (percentil/z-score/threshold documentado)? */
  fundingBenchmarkAvailable: boolean;
  /** ¿Existe benchmark de volumen (volume vs SMA/percentil/z-score validado)? F.3. */
  volumeBenchmarkAvailable?: boolean;
}

export interface SemanticViolation {
  pattern: string;
  reason: string;
}

const DEFAULT_FACTS: SemanticFacts = {
  termStructureVerified: false,
  evidenceDirectionalPositioning: false,
  fundingBenchmarkAvailable: false,
  volumeBenchmarkAvailable: false,
};

/** Expresiones de OI→dirección prohibidas sin evidencia direccional (C). */
const OI_DIRECTION_RE =
  /\b(?:OI|open interest|inter[eé]s abierto)\b[^.!?]{0,80}\b(?:demuestra|prueba|confirma|implica|indica)\b[^.!?]{0,40}\b(?:longs|compras|largos|posiciones largas)\b/i;

/** Variantes de "apalancamiento largo aumentando" / "nuevos longs entrando" (C). */
const LONG_LEVERAGE_RE =
  /\b(?:apalancamiento largo|nuevos longs|nuevas posiciones largas|compradores apalancados)\b[^.!?]{0,60}\b(?:aumentando|creciendo|entrando|subiendo|ingresando)\b/i;

/**
 * Fin de palabra con letra acentuada: \b NO funciona tras "ó/á/é…" en JS
 * (no son \w), así que "superó", "perdió", "aflojó" requieren lookahead.
 */
const W_END = '(?=[^a-záéíóúüñ]|$)';

/** F.3 — "posicionamiento largo aumentó/creció/subió/entró/persiste" sin evidencia. */
const POSITIONING_ATTRIBUTION_RE =
  new RegExp(`\\bposicionamiento\\b[^.!?]{0,60}\\b(?:largo|largos|long|longs|alcista)\\b[^.!?]{0,80}\\b(?:aument[oó]|creci[oó]|subi[oó]|entr[ao]n|se sum[oó]|no se deshizo|se deshizo|se mantiene|persiste|sigue)${W_END}`, 'i');

/** F.3 — "el posicionamiento (no) se deshizo / se mantuvo" como conclusión direccional. */
const POSITIONING_STATE_RE =
  /\bposicionamiento\b[^.!?]{0,40}\b(?:no se deshizo|se deshizo|se mantuvo|se mantiene|persiste|sigue igual)\b/i;

/** F.3 — "lo que te dice / eso te dice / nos dice que ... posicionamiento". */
const INFERENCE_TELL_RE =
  /\b(?:lo que te dice|lo que nos dice|eso te dice|eso indica|esto indica|esto te dice|te dice que|nos dice que)\b[^.!?]{0,90}\bposicionamiento\b/i;

/** F.3 — funding "no aflojó / sigue positivo" → "el posicionamiento no se deshizo".
 *  Solo dispara con "posicionamiento" explícito (no con "mantener largos", que
 *  es el coste de mantener, permitido). */
const FUNDING_DIRECTION_PERSISTENCE_RE =
  new RegExp(`\\bfunding\\b[^.!?]{0,60}\\b(?:no afloj[oó]|sin aflojar|sigue positivo|se mantiene positivo|no baja)${W_END}[^.!?]{0,90}\\bposicionamiento\\b`, 'i');

/** F.3 — "los longs siguen / persisten" como conclusión direccional sin evidencia. */
const LONGS_PERSIST_RE =
  /\blongs\b[^.!?]{0,30}\b(?:siguen|persisten|se mantienen|no se van|no salen|est[áa]n entrando)\b/i;

/** funding con calificativo extremo sin benchmark (D). */
const FUNDING_EXTREME_RE =
  /\bfunding\b[^.!?]{0,40}\b(?:alt[ií]simo|extremadamente alto|excesivo|extremo)\b/i;

/**
 * F.3 — calificativos de extremo sin benchmark (históricamente alto, récord,
 * anormal, sin precedentes, muy por encima de lo habitual) en contexto de
 * funding/posicionamiento/OI/premium/anualizado. "máximo histórico del Donchian"
 * NO matchea (es "máximo", no "históricamente alto").
 */
const EXTREME_WORD_RE =
  /\b(?:hist[oó]ricamente (?:alto|alta|elevado|elevada|extremo|extrema)|nivel hist[oó]rico|r[eé]cord|anormal|sin precedentes|muy por encima de lo habitual|nunca visto)\b/i;
const BENCHMARK_CTX_RE =
  /\b(funding|posicionamiento|inter[eé]s abierto|\bOI\b|premium|apalancamiento|anualizado|anualizaci[oó]n)\b/i;

/** "confirmando presión compradora/vendedora" (H). */
const PRESSURE_CONFIRMED_RE =
  /\bconfirmando presi[oó]n (?:compradora|vendedora)\b/i;

/** F.3 — volumen como confirmación SIN benchmark (C2). */
/** F.3.1.2 — reutilizados por deterministic-repair (capa entre R2 y el guard final). */
export const VOLUME_CONF_RE =
  /\bcon volumen\b|\bvolumen\b[^.!?]{0,35}\b(?:fuerte|alto|elevado|masivo|excepcional|confirma|acompaña)\b|\bconfirma(?:do|da)? (?:por|con) volumen\b|\bruptura\b[^.!?]{0,30}\bcon\b[^.!?]{0,30}\bvolumen\b|\b(?:acompañad[ao])\b[^.!?]{0,25}\bvolumen\b|\bventa\b[^.!?]{0,20}\bconfirmada\b/i;

/** ¿La cláusula de volumen está NEGADA ("el volumen no acompaña")? → permitida. */
export function negatedVolumeClause(text: string): boolean {
  return /\b(?:no|sin)\b[^.!?]{0,30}\bvolumen\b|\bvolumen\b[^.!?]{0,20}\bno\b/i.test(text);
}

/** F.3 — conclusiones binarias (evidencia acumulativa, NO interruptores). */
const BINARY_SIGNAL_RE =
  /\bseñal de venta\b|\bseñal de compra\b|\bventa confirmada\b|\bventas confirmadas\b|\bcompra confirmada\b|\bpresi[oó]n (?:vendedora|compradora) confirmada\b|\bah[ií] ten[eé]s (?:primeras )?(?:ventas|compras)\b/i;

/** Inglés técnico residual traducible (I). */
const EN_RESIDUAL_RES: ReadonlyArray<[RegExp, string]> = [
  [/\bfunding high\b/i, 'funding elevado'],
  [/\bstays long\b/i, 'mantener largos'],
  [/\bSuperTrend (?:up|down)\b/i, 'SuperTrend alcista/bajista'],
  [/\bpremium is flat\b|\bpremium flat\b|\bis flat\b/i, 'premium neutro/alineado con índice'],
  // F.3 — residuos narrativos observados en producción.
  [/\bLittle room for error\b/i, 'poco margen de error'],
  [/\bflip\b/gi, 'cambio'],
  [/\bflipe[oó](?=[^a-záéíóúüñ]|$)/gi, 'cambió'],
  [/\bflat\b/gi, 'plano'],
];

// ── F.3 — DETECCIÓN ROBUSTA DE RESIDUOS LINGÜÍSTICOS ────────────────────────
// No es una lista de reemplazos: es un DETECTOR. Se tokeniza la respuesta y se
// marcan tokens que (a) son palabras narrativas inglesas/italianas inequívocas
// (sin colisión con español), o (b) son texto corrupto/fusionado (bigramas
// imposibles en español, letras triples, o contienen una palabra bloqueada
// fusionada). La terminología técnica legítima (funding, VWAP, SuperTrend, RSI,
// OI, long/short, stop, trigger, pullback...) está en ALLOWLIST y nunca se marca.

const TECHNICAL_ALLOWLIST = new Set([
  'rsi', 'vwap', 'supertrend', 'funding', 'premium', 'oi', 'long', 'longs', 'short',
  'shorts', 'stop', 'stops', 'trigger', 'pullback', 'momentum', 'atr', 'adx', 'mfi',
  'macd', 'cci', 'roc', 'ema', 'sma', 'wma', 'hma', 'vwma', 'stochastic', 'stoch',
  'stochrsi', 'ichimoku', 'tenkan', 'kijun', 'bollinger', 'keltner', 'donchian',
  'obv', 'cmf', 'pivot', 'pivots', 'fib', 'fibs', 'fibonacci', 'usdt', 'usdc',
  'usd', 'btc', 'eth', 'sol', 'xrp', 'doge', 'ada', 'dot', 'ltc', 'bnb', 'avax',
  'link', 'arb', 'op', 'sui', 'apt', 'tia', 'sei', 'inj', 'wld', 'pepe', 'bonk',
  'shib', 'etf', 'cpi', 'fomc', 'nfp', 'fed', 'nvidia', 'tesla', 'apple',
  'microsoft', 'google', 'amazon', 'meta', 'tsm', 'aapl', 'msft', 'googl', 'amzn',
  'nvda', 'tsla', 'earnings', 'revenue', 'ipo', 'tvl', 'defi', 'nft', 'staking',
  'airdrop', 'dca', 'pnl', 'roi', 'ath', 'atl', 'crowding', 'timeframe', 'snapshot',
]);

/**
 * Palabras narrativas inglesas/italianas INEQUÍVOCAS (no son español).
 * Palabras que colisionan con español ("a", "en", "con", "por", "para", "de",
 * "del", "al", "el", "la", "los", "las", "un", "una", "y", "o", "que", "como",
 * "cuando", "si", "no", "es", "son", "era", "fue", "ha", "hay", "puede", "más",
 * "menos", "muy", "este", "esta", "eso", "esto", "error", "simple", "real"…)
 * NO están acá: un token se marca solo si es inequívocamente extranjero.
 */
const LANGUAGE_BLOCKLIST = new Set([
  'the', 'and', 'with', 'from', 'that', 'this', 'these', 'those', 'but', 'are',
  'was', 'were', 'will', 'would', 'could', 'should', 'have', 'had', 'been',
  'being', 'your', 'our', 'their', 'there', 'here', 'where', 'when', 'what',
  'which', 'who', 'how', 'why', 'because', 'while', 'until', 'about', 'above',
  'below', 'between', 'during', 'against', 'without', 'within', 'through',
  'across', 'under', 'over', 'again', 'also', 'even', 'still', 'already', 'just',
  'only', 'very', 'much', 'most', 'less', 'least', 'too', 'enough', 'maybe',
  'perhaps', 'really', 'actually', 'almost', 'always', 'never', 'often',
  'sometimes', 'today', 'tomorrow', 'yesterday', 'now', 'then', 'than', 'so',
  'such', 'both', 'each', 'every', 'either', 'neither', 'other', 'another',
  'same', 'different', 'little', 'room', 'flat', 'flip', 'up', 'down', 'stays',
  'stay', 'high', 'low', 'bullish', 'bearish', 'setup', 'pressure',
  'confirmation', 'confirmed', 'signal', 'price', 'market', 'support',
  'resistance', 'trend', 'volume', 'close', 'closed', 'break', 'broke', 'broken',
  'loss', 'gains', 'move', 'moved', 'moving', 'coming', 'going', 'getting',
  'looking', 'see', 'saw', 'seen', 'say', 'said', 'says', 'think', 'thought',
  'know', 'known', 'want', 'wanted', 'need', 'needed', 'make', 'made', 'take',
  'took', 'give', 'gave', 'get', 'got', 'put', 'set', 'let', 'find', 'found',
  'keep', 'kept', 'hold', 'held', 'show', 'shown', 'tell', 'told', 'ask',
  'asked', 'help', 'helped', 'work', 'worked', 'start', 'started', 'end',
  'ended', 'time', 'timing', 'way', 'thing', 'things', 'point', 'part', 'side',
  'level', 'place', 'case', 'fact', 'word', 'name', 'number', 'money', 'year',
  'day', 'week', 'month', 'hour', 'minute', 'second', 'good', 'bad', 'big',
  'small', 'new', 'old', 'right', 'wrong', 'sure', 'clear', 'easy', 'hard',
  'safe', 'important', 'true', 'false', 'correct', 'does', 'did', 'do', 'can',
  'may', 'might', 'must', 'shall', 'underway', 'commit', 'committed', 'open',
  'interest',
  // italiano narrativo
  'molto', 'bene', 'grazie', 'perché', 'che', 'non', 'è', 'gli', 'dei', 'delle',
  'ancora', 'già', 'troppo', 'così', 'dove', 'sono', 'sei', 'hanno', 'ho',
  'abbiamo', 'questa', 'questo', 'per', 'mai', 'sempre', 'chi', 'come',
]);

/** Bigramas imposibles en español (corrupción/fusión: "largapgando"). */
const CORRUPT_BIGRAMS = [
  'pg', 'qq', 'zq', 'qz', 'zx', 'xz', 'wx', 'xw', 'vj', 'jv', 'kj', 'jk', 'wg',
  'gw', 'fb', 'bf', 'qc', 'cq', 'qx', 'xq', 'qk', 'kq', 'vv', 'jj', 'kk', 'ww',
];
const TRIPLE_LETTER_RE = /([a-zñáéíóúü])\1{2,}/i;

export interface LanguageResidual {
  token: string;
  kind: 'foreign' | 'corrupt';
}

/** Normaliza frases técnicas multi-palabra antes de tokenizar. */
function normalizePhrases(text: string): string {
  return text
    .replace(/\bopen interest\b/gi, ' oi ')
    .replace(/\bstop loss\b/gi, ' stop ')
    .replace(/\ball time high\b/gi, ' ath ')
    .replace(/\ball time low\b/gi, ' atl ')
    .replace(/\btime frame\b/gi, ' timeframe ');
}

/**
 * Detecta residuos lingüísticos impropios (inglés/italiano narrativo) y texto
 * corrupto/fusionado. Devuelve los tokens problemáticos (vacío = OK).
 */
export function detectLanguageResiduals(text: string): LanguageResidual[] {
  const out: LanguageResidual[] = [];
  const normalized = normalizePhrases(text);
  const tokens = normalized.split(/[^a-záéíóúüñ]+/i).filter((t) => t.length > 0);
  for (const raw of tokens) {
    const tok = raw.toLowerCase().replace(/(usdt|usdc)$/i, '');
    if (tok.length === 0 || /\d/.test(tok)) continue; // números/timeframes no son lenguaje
    if (TECHNICAL_ALLOWLIST.has(tok)) continue;
    if (LANGUAGE_BLOCKLIST.has(tok)) {
      out.push({ token: raw, kind: 'foreign' });
      continue;
    }
    // Corrupción: bigramas imposibles en español o letras triples ("largapgando").
    // NOTA: NO se detecta "palabra extranjera fusionada por substring" — "volumen"
    // contiene "volume" y "plenamente" contiene "name": el substring es ruidoso.
    const corrupt = TRIPLE_LETTER_RE.test(tok) || CORRUPT_BIGRAMS.some((bg) => tok.includes(bg));
    if (corrupt) out.push({ token: raw, kind: 'corrupt' });
  }
  return out;
}

// ── F.3 — CONTRATO NUMÉRICO DE RELACIONES (autoridad de NumericFacts) ────────

/** Marcas de condicional/escenario: la relación se discute como supuesto.
 *  F.3.1.2 — exportada para la capa de reparación determinista. */
export const REL_CONDITIONAL_RE =
  /\b(si\b|siempre que|cuando|en caso de|asumiendo|suponiendo|requerir|requiere|requería|requeriría|confirmar|confirmaría|confirmase|confirme|debería|deberías|necesitaría|un cierre|una vela|eventual|trigger|invalidaci[oó]n|podría|podrían|puede que|cambiaría|cambiará|para que|esperaría|esperarías|habría que|si busc[aá]s|si quer[eé]s|si met[eé]s|si entra|si perd[eé]s|si supera|si rompe|si cae|si pierde|tendría que|sería|podemos|puede)\b/i;

/** Frases que AFIRMAN "precio por encima del nivel" (sujeto precio implícito/explicito).
 *  "d(?:e|el)" cubre la elisión "arriba del VWAP" (de+el); los verbos con tilde
 *  usan ${W_END} (el \b no funciona tras "ó"). */
const ABOVE_PHRASES: ReadonlyArray<RegExp> = [
  /\barriba d(?:e|el)\b/i,
  /\bpor encima d(?:e|el)\b/i,
  /\bencima d(?:e|el)\b/i,
  /\bsupera\b|\bsuper[oó](?=[^a-záéíóúüñ]|$)/i,
  /\brecupera\b|\brecuper[oó](?=[^a-záéíóúüñ]|$)/i,
  /\bqued[oó](?=[^a-záéíóúüñ]|$)\s+arriba\b/i,
  /\b(?:est[aá]|queda|sigue|opera|cotiza|se mantiene|viene|anda)\s+sobre\b/i,
];

/** Frases que AFIRMAN "precio por debajo del nivel". "bajo" suelto NO cuenta
 *  (ambiguo: "stops claros bajo 2459" describe colocación, no posición del precio). */
const BELOW_PHRASES: ReadonlyArray<RegExp> = [
  /\bpor debajo d(?:e|el)\b/i,
  /\bdebajo d(?:e|el)\b/i,
  /\bperdi[oó](?=[^a-záéíóúüñ]|$)\b|\bpierde\b/i,
  /\bcay[oó](?=[^a-záéíóúüñ]|$)\s+bajo\b/i,
  /\brompi[oó](?=[^a-záéíóúüñ]|$)\s+a la baja\b/i,
  /\b(?:est[aá]|queda|sigue|opera|cotiza|se mantiene|viene|anda)\s+(?:bajo|por debajo)\b/i,
];

function hasNegationBefore(text: string, idx: number, window = 10): boolean {
  const before = text.slice(Math.max(0, idx - window), idx).toLowerCase();
  return /\b(no|sin|nunca|jam[aá]s|tampoco)\b/.test(before);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Candidatos textuales del nivel (valor + separadores de miles + etiqueta).
 *  F.3.1.2 — exportada para la capa de reparación determinista. */
export function levelCandidates(f: RelationFact): string[] {
  const digits = String(Math.round(f.value));
  const candidates = [digits];
  if (digits.length >= 4) {
    const p = digits.length - 3;
    candidates.push(digits.slice(0, p) + '.' + digits.slice(p));
    candidates.push(digits.slice(0, p) + ',' + digits.slice(p));
  }
  const labelWord = f.label.split(/\s+/)[0];
  if (labelWord) candidates.push(labelWord);
  return candidates;
}

/** F.3.1.2 — exportada para la capa de reparación determinista. */
export interface RelationHit {
  direction: 'ABOVE' | 'BELOW';
  index: number;
}

/** Todas las frases relacionales (arriba/abajo) de la oración con su posición.
 *  F.3.1.2 — exportada para la capa de reparación determinista. */
export function relationHits(sentence: string): RelationHit[] {
  const hits: RelationHit[] = [];
  for (const re of ABOVE_PHRASES) {
    const m = re.exec(sentence);
    if (m && !hasNegationBefore(sentence, m.index)) hits.push({ direction: 'ABOVE', index: m.index });
  }
  for (const re of BELOW_PHRASES) {
    const m = re.exec(sentence);
    if (m && !hasNegationBefore(sentence, m.index)) hits.push({ direction: 'BELOW', index: m.index });
  }
  return hits;
}

/** Ventana máxima frase-relación ↔ mención del nivel (caracteres). */
const RELATION_WINDOW = 90;

/**
 * Separadores de cláusula: la frase relacional debe estar en la MISMA cláusula
 * que la mención del nivel ("por debajo del VWAP (2.507 USDT): recuperó parte
 * del terreno" → el "recuperó" está en otra cláusula y NO se atribuye al VWAP).
 * La coma con espacio ("USDT, mientras") separa; la coma decimal/miles sin
 * espacio ("2.504,39", "2,507") NO.
 * F.3.1.2 — exportada para la capa de reparación determinista.
 */
export const CLAUSE_SPLIT_RE = /[;:—–]|\s+(?:y|pero|aunque|sin embargo|porque|sino)\s+|,\s+/;

/**
 * F.3 (bloqueante) — verifica que la narración NO contradiga las relaciones
 * numéricas calculadas (NumericFacts/priceRelation). Para cada mención del
 * nivel se toma la frase relacional MÁS CERCANA dentro de la MISMA cláusula
 * (ventana ±90): "por debajo del VWAP (2.507 USDT): recuperó parte del terreno"
 * → la frase más cercana a "2.507" es "por debajo del" (BELOW), no el
 * "recuperó" de la cláusula siguiente. Si el hecho dice BELOW, "arriba de",
 * "superó", "recuperó el nivel" → violación. Las oraciones condicionales/
 * escenario ("si pierde X", "un cierre por encima de X confirmaría") NO se
 * auditan: describen supuestos, no el estado actual.
 */
export function validateNumericRelations(
  text: string,
  relations: readonly RelationFact[],
): SemanticViolation[] {
  if (relations.length === 0) return [];
  const violations: SemanticViolation[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    if (REL_CONDITIONAL_RE.test(s)) continue;
    for (const clause of s.split(CLAUSE_SPLIT_RE)) {
      const c = clause.trim();
      if (!c) continue;
      const hits = relationHits(c);
      if (hits.length === 0) continue;
      for (const fact of relations) {
        if (fact.relation === 'AT') continue;
        const mention = findLevelMention(c, fact, relations);
        if (mention === null) continue;
        let nearest: RelationHit | null = null;
        let best = Number.MAX_SAFE_INTEGER;
        for (const h of hits) {
          const d = Math.abs(h.index - mention);
          if (d < best) { best = d; nearest = h; }
        }
        if (!nearest || best > RELATION_WINDOW) continue;
        if ((nearest.direction === 'ABOVE' && fact.relation === 'BELOW') || (nearest.direction === 'BELOW' && fact.relation === 'ABOVE')) {
          violations.push({
            pattern: `relación ${fact.label}`,
            reason: `la respuesta afirma "${nearest.direction === 'ABOVE' ? 'por encima' : 'por debajo'} de" ${fact.label} (${fact.value}) pero el hecho calculado es ${fact.relation}`,
          });
        }
      }
    }
  }
  return violations;
}

/**
 * F.3.1.2 — resuelve la mención de un nivel en una cláusula SIN ambigüedad de
 * label compartido ("SuperTrend 1H" y "SuperTrend 4H" comparten la palabra
 * "SuperTrend"): prioridad 1) valor numérico, 2) label completo ("SuperTrend
 * 4H"), 3) palabra de label SOLO si ningún otro fact con la misma palabra tiene
 * su valor/label completo presente en la cláusula (si hay desambiguación, la
 * palabra suelta NO se atribuye a otros timeframes).
 */
export function findLevelMention(
  clause: string,
  fact: RelationFact,
  relations: readonly RelationFact[],
): number | null {
  // 1) valor numérico (más específico).
  const digits = String(Math.round(fact.value));
  const values = [digits];
  if (digits.length >= 4) {
    const p = digits.length - 3;
    values.push(digits.slice(0, p) + '.' + digits.slice(p));
    values.push(digits.slice(0, p) + ',' + digits.slice(p));
  }
  for (const v of values) {
    const m = new RegExp(escapeRe(v), 'i').exec(clause);
    if (m) return m.index;
  }
  // 2) label completo ("SuperTrend 4H", "VWAP 4H").
  const full = new RegExp(`\\b${escapeRe(fact.label)}\\b`, 'i').exec(clause);
  if (full) return full.index;
  // 3) palabra de label — solo si la cláusula no desambigua con otro fact.
  const labelWord = fact.label.split(/\s+/)[0];
  if (labelWord) {
    const sameWord = relations.filter((f) => f !== fact && f.label.split(/\s+/)[0] === labelWord);
    const disambiguated = sameWord.some((f) => {
      const d = String(Math.round(f.value));
      const p = d.length >= 4 ? d.length - 3 : -1;
      const vRe = new RegExp(
        `${escapeRe(d)}${p >= 0 ? `|${escapeRe(d.slice(0, p))}[.,]${escapeRe(d.slice(p))}` : ''}`,
        'i',
      );
      return vRe.test(clause) || new RegExp(`\\b${escapeRe(f.label)}\\b`, 'i').test(clause);
    });
    if (!disambiguated) {
      const m = new RegExp(`\\b${escapeRe(labelWord)}\\b`, 'i').exec(clause);
      if (m) return m.index;
    }
  }
  return null;
}

/** Aplica la validación semántica; devuelve las violaciones (vacío = OK). */
export function validateSemanticContracts(
  text: string,
  facts: SemanticFacts = DEFAULT_FACTS,
): SemanticViolation[] {
  const violations: SemanticViolation[] = [];

  if (!facts.termStructureVerified) {
    if (/\bcontango\b/i.test(text)) {
      violations.push({ pattern: 'contango', reason: 'contango sin term structure verificada (perpetuo)' });
    }
    if (/\bbackwardation\b/i.test(text)) {
      violations.push({ pattern: 'backwardation', reason: 'backwardation sin term structure verificada (perpetuo)' });
    }
  }

  if (!facts.evidenceDirectionalPositioning) {
    if (OI_DIRECTION_RE.test(text)) {
      violations.push({ pattern: 'OI→longs', reason: 'OI no identifica longs/shorts sin evidencia direccional' });
    }
    if (LONG_LEVERAGE_RE.test(text)) {
      violations.push({ pattern: 'apalancamiento largo', reason: 'apalancamiento largo aumentando sin evidencia direccional' });
    }
    if (POSITIONING_ATTRIBUTION_RE.test(text)) {
      violations.push({ pattern: 'posicionamiento direccional', reason: 'atribución direccional de posicionamiento sin evidencia (OI/funding no identifican quién abre/cierra)' });
    }
    if (POSITIONING_STATE_RE.test(text)) {
      violations.push({ pattern: 'posicionamiento persistente', reason: '"el posicionamiento (no) se deshizo" sin evidencia direccional' });
    }
    if (INFERENCE_TELL_RE.test(text)) {
      violations.push({ pattern: 'inferencia "te dice que"', reason: 'inferencia de posicionamiento a partir de OI/funding sin evidencia' });
    }
    if (FUNDING_DIRECTION_PERSISTENCE_RE.test(text)) {
      violations.push({ pattern: 'funding→persistencia', reason: 'funding no demuestra persistencia direccional del posicionamiento' });
    }
    if (LONGS_PERSIST_RE.test(text)) {
      violations.push({ pattern: 'longs persistentes', reason: '"longs siguen/persisten" sin evidencia direccional' });
    }
  }

  if (!facts.fundingBenchmarkAvailable) {
    if (FUNDING_EXTREME_RE.test(text)) {
      violations.push({ pattern: 'funding extremo', reason: 'funding "altísimo/extremo" sin benchmark documentado' });
    }
    if (EXTREME_WORD_RE.test(text) && BENCHMARK_CTX_RE.test(text)) {
      violations.push({ pattern: 'extremo sin benchmark', reason: '"históricamente alto/extremo/récord/anormal" sin benchmark documentado' });
    }
  }

  if (facts.volumeBenchmarkAvailable !== true) {
    if (VOLUME_CONF_RE.test(text) && !negatedVolumeClause(text)) {
      violations.push({ pattern: 'volumen sin benchmark', reason: 'volumen como confirmación sin benchmark cuantitativo' });
    }
  }

  if (BINARY_SIGNAL_RE.test(text) && !negatedBinarySignal(text)) {
    violations.push({ pattern: 'señal binaria', reason: 'conclusión binaria (señal de venta/compra, venta confirmada) — la evidencia es acumulativa' });
  }

  if (PRESSURE_CONFIRMED_RE.test(text)) {
    violations.push({ pattern: 'presión confirmada', reason: 'prohibido "confirmando presión compradora/vendedora" con solo VWAP/funding/OI/osciladores' });
  }

  for (const [re, label] of EN_RESIDUAL_RES) {
    if (re.test(text)) violations.push({ pattern: label, reason: 'inglés técnico residual traducible' });
  }

  // F.3 — residuos lingüísticos narrativos / corrupción (post-reparación).
  const residuals = detectLanguageResiduals(text);
  for (const r of residuals) {
    violations.push({
      pattern: r.kind === 'corrupt' ? 'texto corrupto' : 'lengua extranjera',
      reason: r.kind === 'corrupt'
        ? `texto corrupto/fusionado: "${r.token}"`
        : `palabra narrativa no española: "${r.token}"`,
    });
  }

  return violations;
}

/** ¿"señal de venta/compra" está negada ("sin que eso sea señal de venta")? */
function negatedBinarySignal(text: string): boolean {
  return /\b(?:no|sin|nunca|jam[aá]s|tampoco)\b[^.!?]{0,35}\bseñal de (?:venta|compra)\b/i.test(text);
}

/** Devuelve una copia del texto con los residuos de inglés técnico corregidos. */
export function translateTechnicalResiduals(text: string): string {
  let out = text;
  for (const [re, repl] of EN_RESIDUAL_RES) out = out.replace(re, repl);
  return out;
}

export { DEFAULT_FACTS };
