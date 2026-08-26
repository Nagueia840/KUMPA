import { extractTimeframes } from './timeframes.js';
import { extractAllTickers } from './tickers.js';
import { parseMarketNumber } from './numbers.js';
import type { ClaimSet, MarketClaim } from '../agents/claims.js';
import type { TfLabel } from '../config/timeframes.js';

/**
 * POST-VALIDATOR ANTI-ALUCINACIÓN (FASE C).
 * Detecta afirmaciones numéricas de mercado no respaldadas por los datos
 * obtenidos (allowed numeric claims). Conservador:
 * - Solo se auditan números "de mercado" (con etiqueta, %/$/k/M/B, o grandes
 *   dentro de contexto de activo/timeframe). Los números conversacionales
 *   ("3 escenarios", "2 posibilidades") se ignoran.
 * - Un número citado junto a un timeframe debe coincidir con el valor de ESE
 *   marco (no basta que exista en otro). Igual con el activo.
 * - Frases hipotéticas ("si BTC estuviera en 100.000") no se auditan: son
 *   escenarios, no datos observados.
 */

export interface Violation {
  token: string;
  value: number;
  sentence: string;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

/** Marcas de hipótesis/escenario: lo que se discute como supuesto, no como dato. */
const HYPOTHESIS_RE =
  /\b(supongamos|suponiendo|suponga|hipot[eé]ticamente|escenario|asumamos|asumiendo|digamos|por decir|imagin[aá](te|mos)?|si (fuera|estuviera|estuviese|valiera|costara) (el |la |en )?)\b/i;

/** Label → (patrones regex de búsqueda, campos del claim que pueden respaldarlo). */
interface LabelDef {
  match: readonly string[];
  fields: readonly string[];
}

const LABELS: Record<string, LabelDef> = {
  rsi: { match: ['\\brsi\\b'], fields: ['rsi'] },
  sma20: { match: ['\\bsma20\\b', '\\bsma 20\\b', 'media m[oó]vil 20', '\\bmm20\\b'], fields: ['sma20'] },
  sma50: { match: ['\\bsma50\\b', '\\bsma 50\\b', 'media m[oó]vil 50', '\\bmm50\\b'], fields: ['sma50'] },
  sma100: { match: ['\\bsma100\\b'], fields: ['sma100'] },
  sma200: { match: ['\\bsma200\\b'], fields: ['sma200'] },
  ema20: { match: ['\\bema20\\b', '\\bema 20\\b', 'media exponencial 20'], fields: ['ema20'] },
  ema9: { match: ['\\bema9\\b', '\\bema 9\\b'], fields: ['ema9'] },
  macd: { match: ['\\bmacd\\b'], fields: ['macd_linea', 'macd_senal', 'macd_histograma'] },
  atr: { match: ['\\batr\\b'], fields: ['atr'] },
  bollinger: { match: ['\\bbollinger\\b', '\\bbandas\\b'], fields: ['bollinger_inferior', 'bollinger_media', 'bollinger_superior'] },
  superTrend: { match: ['supertrend'], fields: ['superTrend_nivel'] },
  adx: { match: ['\\badx\\b'], fields: ['adx'] },
  mfi: { match: ['\\bmfi\\b', 'flujo de dinero'], fields: ['mfi'] },
  williamsR: { match: ['williams'], fields: ['williamsR'] },
  roc: { match: ['\\broc\\b'], fields: ['roc'] },
  obv: { match: ['\\bobv\\b'], fields: ['obv'] },
  vwap: { match: ['\\bvwap\\b'], fields: ['vwap_sesion'] },
  pivot: { match: ['\\bpivots?\\b', '\\bpivotes?\\b'], fields: ['pivot_p', 'pivot_r1', 'pivot_s1', 'pivot_r2', 'pivot_s2'] },
  soporte: { match: ['\\bsoportes?\\b'], fields: ['pivot_s1', 'pivot_s2'] },
  resistencia: { match: ['\\bresistencias?\\b'], fields: ['pivot_r1', 'pivot_r2'] },
  fib: { match: ['\\bfib\\b', '\\bfibonacci\\b'], fields: ['fib_0_382', 'fib_0_5', 'fib_0_618'] },
  ichimoku: { match: ['\\bichimoku\\b', '\\btenkan\\b', '\\bkijun\\b'], fields: ['ichimoku_tenkan', 'ichimoku_kijun'] },
  precio: { match: ['\\bprecios?\\b', 'cotizaci[oó]n(es)?'], fields: ['precio', 'cierre', 'viva_close'] },
  funding: { match: ['\\bfunding\\b'], fields: ['funding_pct'] },
  cierre: { match: ['\\bcierres?\\b', '\\bclose\\b'], fields: ['cierre'] },
  velaViva: { match: ['vela viva', 'barra actual', 'barra en curso'], fields: ['viva_open', 'viva_high', 'viva_low', 'viva_close'] },
};

const GLOBAL_LABEL_RE =
  /\b(capitalizaci[oó]n|market cap|dominancia|dominance|global|tvl|stablecoin|mercado total|total del mercado)\b/i;

/** Campos tipo oscilador: tolerancia absoluta de 1 unidad (valores ya con 1 decimal). */
const OSCILLATOR_FIELDS = new Set(['rsi', 'mfi', 'williamsR', 'roc', 'adx', 'di_positivo', 'di_negativo']);

/** Regex de tokens numéricos candidatos (con sufijos k/M/B/% y signo). */
const NUM_RE = /[−–-]?[\d][\d.,]*(?:[kKmMbB%])?/g;

/** Tokens que son timeframes ("4H", "15m", "1D", "1W", "1M") — no son números de mercado. */
const TF_TOKEN_RE = /^\d{1,3}\s*[HhMmWwDd]$/i;

function labelRe(pattern: string): RegExp {
  return new RegExp(pattern, 'i');
}

/** Detecta qué grupos de labels aparecen en la frase. */
function detectLabelFields(sentence: string): string[] {
  const matched: string[] = [];
  for (const [key, def] of Object.entries(LABELS)) {
    if (def.match.some((p) => labelRe(p).test(sentence))) matched.push(key);
  }
  return matched;
}

/** Tolerancia según el campo del claim. */
function toleranceFor(claim: MarketClaim): number {
  if (claim.field.startsWith('event:')) return Math.max(0.02, Math.abs(claim.value) * 0.02); // cifras de evento (EPS, CPI...)
  if (claim.field === 'funding_pct') return 0.005; // en %; ±0.005pp
  if (OSCILLATOR_FIELDS.has(claim.field)) return 1;
  // Valores tipo precio/nivel: 0.5% relativo con piso de 1 unidad.
  return Math.max(1, Math.abs(claim.value) * 0.005);
}

function matchValue(value: number, claim: MarketClaim, approx: boolean): boolean {
  const tol = toleranceFor(claim) * (approx ? 3 : 1);
  return Math.abs(value - claim.value) <= tol;
}

function matchAgainst(
  value: number,
  candidates: readonly MarketClaim[],
  labelKeys: readonly string[],
  tfs: readonly TfLabel[],
  approx: boolean,
): boolean {
  // El TIMEFFRAME se mantiene estricto siempre (task 6): un número citado junto a
  // un TF debe coincidir con el valor de ESE marco. El LABEL se relaja en segundo
  // nivel para no false-positivar números reales que comparten cláusula con otro
  // label (ej. "precio 78.429 con funding -0,0004%").
  const byTf = (pool: readonly MarketClaim[]): readonly MarketClaim[] =>
    tfs.length > 0
      ? pool.filter((c) => c.timeframe === undefined || tfs.includes(c.timeframe as TfLabel))
      : pool;
  const byLabel = (pool: readonly MarketClaim[]): readonly MarketClaim[] => {
    if (labelKeys.length === 0) return pool;
    const fields = new Set<string>(labelKeys.flatMap((k) => LABELS[k]?.fields ?? []));
    return pool.filter((c) => fields.has(c.field));
  };

  // Nivel 1: labels + timeframe.
  const labeled = byLabel(candidates);
  if (labeled.length === 0 && labelKeys.length > 0) {
    // El label citado no tiene respaldo en ningún claim del símbolo → violación.
    return false;
  }
  if (byTf(labeled).some((c) => matchValue(value, c, approx))) return true;

  // Nivel 2: solo timeframe (relajar label; el TF sigue estricto).
  if (labelKeys.length > 0 && byTf(candidates).some((c) => matchValue(value, c, approx))) return true;

  return false;
}

function isMarketCandidate(
  token: string,
  value: number,
  hasLabel: boolean,
  hasSymOrGlobal: boolean,
  hasTf: boolean,
): boolean {
  if (!Number.isFinite(value)) return false;
  if (/[%$]$/.test(token) || /[kKmMbB]$/.test(token)) return true;
  if (hasLabel) return true;
  if ((hasSymOrGlobal || hasTf) && Math.abs(value) >= 1000) return true;
  return false;
}

/** Valida la respuesta del LLM contra los claims permitidos. */
export function validateReply(text: string, claims: ClaimSet): ValidationResult {
  if (claims.isEmpty) return { valid: true, violations: [] };
  const violations: Violation[] = [];

  // Normalización previa (bug real detectado en auditoría final):
  // los modelos suelen escribir miles con espacios angostos U+202F/U+00A0
  // ("78 443") y guiones unicode (‑ → -). PASO 1: se eliminan los espacios
  // angostos SOLO entre dígitos (separador de miles). PASO 2: el resto de
  // espacios angostos se convierte a espacio regular (labels "EMA 20", "15 min").
  const normalized = text
    .replace(/[\u2011\u2212]/g, '-')
    .replace(/(?<=\d)[\u202F\u00A0\u2009\u00AD\u2007](?=\d)/g, '')
    .replace(/[\u202F\u00A0\u2009\u00AD\u2007]/g, ' ');

  const textSyms = extractAllTickers(normalized).filter((s) => claims.bySymbol.has(s));

  for (const sentence of normalized.split(/(?<=[.!?])\s+/)) {
    const clean = sentence.trim();
    if (!clean) continue;
    if (HYPOTHESIS_RE.test(clean)) continue; // escenario hipotético → no auditar

    const sentenceSyms = extractAllTickers(clean).filter((s) => claims.bySymbol.has(s));
    // Símbolos mencionados pero SIN claims (activo fallido) → cualquier número de
    // mercado que se les atribuya es sin respaldo.
    const hasUnclaimed = extractAllTickers(clean).some((s) => !claims.bySymbol.has(s));
    const hasGlobal = GLOBAL_LABEL_RE.test(clean);
    // Contexto de evento/macro (CPI, FOMC, EPS...) → habilita claims globales de evento.
    const eventContext = /\b(cpi|fomc|inflaci[oó]n|eps|earnings|resultados|empleo|n[oó]minas?|pce|nfp|macro|tasas?)\b/i.test(clean);
    // Preferencia de activo a nivel frase; si la frase no lo nombra, se usa el del texto.
    const syms = sentenceSyms.length > 0 ? sentenceSyms : textSyms;
    const hasSymOrGlobal = syms.length > 0 || hasGlobal || hasUnclaimed || eventContext;

    // Atribución por CLÁUSULA (separadas por ";" o " y " — la coma NO, porque es
    // separador decimal/miles en formatos AR/INTL): el número se valida contra el
    // timeframe/label de SU cláusula, no contra toda la frase (evita cruces 1D↔4H).
    for (const clause of clean.split(/[;]|\s+y\s+/)) {
      const c = clause.trim();
      if (!c) continue;
      const tfs = extractTimeframes(c).map((r) => r.tf);
      const labelKeys = detectLabelFields(c);
      const hasLabel = labelKeys.length > 0;
      const hasTf = tfs.length > 0;
      const clauseSyms = extractAllTickers(c).filter((s) => claims.bySymbol.has(s));
      // Fallback: si la cláusula ni el texto nombran el activo, se usan los símbolos
      // del contexto (claims del pre-fetch) SOLO cuando hay label/timeframe de
      // mercado — la respuesta suele omitir el nombre ("el RSI está en 78").
      const allClaimSyms = [...claims.bySymbol.keys()].filter((s) => s !== 'GLOBAL');
      const cSyms =
        clauseSyms.length > 0
          ? clauseSyms
          : syms.length > 0
            ? syms
            : hasLabel || hasTf
              ? allClaimSyms
              : [];

      // Símbolos de ENTIDAD (claims 'event:*') por substring: "Nvidia" ↔ claim NVDA.
      const candidates = new Set<MarketClaim>();
      for (const s of cSyms) for (const cl of claims.bySymbol.get(s) ?? []) candidates.add(cl);
      const upper = c.toUpperCase();
      for (const s of claims.bySymbol.keys()) {
        if (s === 'GLOBAL' || s.length < 3) continue;
        if (upper.includes(s) && !cSyms.includes(s)) {
          for (const cl of claims.bySymbol.get(s) ?? []) candidates.add(cl);
        }
      }
      if (hasGlobal) for (const cl of claims.bySymbol.get('GLOBAL') ?? []) candidates.add(cl);
      if (eventContext) for (const cl of claims.bySymbol.get('GLOBAL') ?? []) candidates.add(cl);
      if (candidates.size === 0 && !hasUnclaimed && !hasLabel && !hasTf && !eventContext) {
        continue; // sin activo, contexto global ni label → nada que auditar
      }

      // ¿Hay claims de evento verificados entre los candidatos? (para validar horas)
      const eventSyms = new Set<string>();
      for (const cl of candidates) if (cl.field.startsWith('event:')) eventSyms.add(cl.symbol);

      for (const m of c.matchAll(NUM_RE)) {
        const token = m[0];
        const idx = m.index ?? 0;
        const before = c[idx - 1] ?? '';
        const afterTf = c.slice(idx + token.length).match(/^\s*[HhMmWwDd]/);
        if (TF_TOKEN_RE.test(token)) continue; // token tipo "4H"/"15m"
        if (/[A-Za-z]/.test(before)) continue; // parte de un label tipo EMA20/SMA20
        // Label con parámetro separado por espacio: "EMA 20", "SMA 50", "WMA 9".
        const beforeCtx = c.slice(Math.max(0, idx - 12), idx);
        if (/\b(EMA|SMA|WMA|HMA|MMA|VWAP)\s*$/i.test(beforeCtx)) continue;
        if (afterTf) continue; // dígito pegado a una letra de timeframe ("4H", "15m")
        const value = parseMarketNumber(token);
        if (value === null) continue;

        // HORA DE EVENTO: tokens tipo reloj en cláusula con claims de evento verificados.
        const after = c.slice(idx + token.length, idx + token.length + 14);
        const isClock =
          /^:\d{2}/.test(after) ||
          /(?:a las|a la|las)\s*$/.test(c.slice(Math.max(0, idx - 12), idx)) ||
          /\b(?:hs|horas?|hrs?|am|pm)\b/i.test(after);
        if (isClock && eventSyms.size > 0 && /^\d{1,2}$/.test(token)) {
          // Citar la hora del usuario para CORREGIRLA no es alucinar.
          if (/(dijiste|mencionaste|tu horario|tu hora|no coincide|no es (correcta|as[ií]))/i.test(c)) continue;
          let hour = value;
          if (/\bpm\b/i.test(after) && hour < 12) hour += 12;
          if (/\bam\b/i.test(after) && hour === 12) hour = 0;
          const timeClaims = [...candidates].filter(
            (cl) => cl.field.startsWith('event:time_') && cl.field.endsWith('_hour'),
          );
          if (timeClaims.length === 0) {
            violations.push({
              token,
              value,
              sentence: clean.slice(0, 140),
              reason: `hora ${token} sin hora verificada de evento`,
            });
          } else if (!timeClaims.some((cl) => Math.abs(hour - cl.value) <= 0.01)) {
            violations.push({
              token,
              value,
              sentence: clean.slice(0, 140),
              reason: `hora ${token} no coincide con la hora verificada del evento`,
            });
          }
          continue;
        }

        // NÚMERO DE EVENTO (EPS, CPI, revenue...): en contexto de evento/macro se
        // valida contra claims de evento verificados; sin claims → sin respaldo.
        const isEventNumber = /^\d+([.,]\d{1,2})?$/.test(token);
        if (eventContext && isEventNumber) {
          // Falsos positivos obvios: años ("2026") y trimestres ("Q2").
          if (value >= 1900 && value <= 2100) continue;
          const beforeCtxQ = c.slice(Math.max(0, idx - 6), idx);
          if (value >= 1 && value <= 4 && /\bQ\s*$/i.test(beforeCtxQ)) continue;
          if (!matchAgainst(value, [...candidates], [], [], false)) {
            violations.push({
              token,
              value,
              sentence: clean.slice(0, 140),
              reason: `número ${token} (=${value}) sin respaldo en datos de evento verificados`,
            });
          }
          continue;
        }

        if (!isMarketCandidate(token, value, hasLabel, hasSymOrGlobal, hasTf)) continue;
        // Aproximación coloquial ("unos 250", "aprox", "~") → tolerancia ampliada.
        const approx = /(unos?|aprox\.?|alrededor de|~)\s*$/.test(c.slice(Math.max(0, idx - 14), idx));
        if (!matchAgainst(value, [...candidates], labelKeys, tfs, approx)) {
          violations.push({
            token,
            value,
            sentence: clean.slice(0, 140),
            reason: `número ${token} (=${value}) sin respaldo en los datos verificados`,
          });
        }
      }
    }
  }
  return { valid: violations.length === 0, violations };
}
