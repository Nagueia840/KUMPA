import { TF_META, TF_ORDER, type TfLabel } from '../config/timeframes.js';

/**
 * Parser de timeframes en lenguaje natural (español + notación de trading).
 * FASE A: solo detección determinista; el fetching multi-TF llega en Fase B.
 */
export interface TimeframeRequest {
  tf: TfLabel;
  /** String exacto para Bitget (1M/1W/1D/4H/1H/15m/5m). */
  bitget: string;
  source: 'explicit' | 'policy';
}

/** Expresiones de tiempo RELATIVO ("hace 4 horas", "dentro de 15 min") que NO son timeframes. */
const TIME_AGO_RE =
  /\b(hace|hac[ií]a|hacia|atr[aá]s|dentro de)\s+\d+\s*(min(utos?)?|hs?|horas?|d[ií]as?|semanas?|meses?)\b/gi;

/** "1M usd/dólares" = un millón, no el timeframe mensual. */
const MILLION_RE = /\b\d+M\s*(de\s+)?(usd|usdt|d[oó]lares?)\b/gi;

/** Alias ordenados; 1M es case-sensitive (M mayúscula = mensual; 1m = minuto, fuera de política). */
const ALIASES: ReadonlyArray<{ tf: TfLabel; patterns: readonly RegExp[] }> = [
  { tf: '1M', patterns: [/\b1M\b/, /\bmensual(es)?\b/i, /\bmes(es)?\b/i] },
  { tf: '1W', patterns: [/\b1[Ww]\b/, /\bsemanal(es)?\b/i, /\bsemana(s)?\b/i] },
  { tf: '1D', patterns: [/\b1[Dd]\b/, /\bdiari[oa]s?\b/i, /\bd[ií]a\b/i, /\bdaily\b/i] },
  { tf: '4H', patterns: [/\b4\s*h(oras?|s)?\b/i, /\bcuatro\s+horas?\b/i] },
  { tf: '1H', patterns: [/\b1\s*h(oras?|s)?\b/i, /\buna\s+hora\b/i, /\b60\s*min(utos?)?\b/i] },
  { tf: '15m', patterns: [/\b15\s*m(in(utos?)?)?\b/i, /\bquince\s+minutos?\b/i] },
  { tf: '5m', patterns: [/\b5\s*m(in(utos?)?)?\b/i, /\bcinco\s+minutos?\b/i] },
];

/**
 * Extrae TODOS los timeframes explícitos mencionados en el texto.
 * Devuelve [] si no hay ninguno (ahí se aplica la política por intención).
 * Resultado ordenado de grueso a fino (TF_ORDER) y sin duplicados.
 */
export function extractTimeframes(text: string): TimeframeRequest[] {
  const scrubbed = text.replace(TIME_AGO_RE, ' ').replace(MILLION_RE, ' ');
  const found = new Set<TfLabel>();
  for (const alias of ALIASES) {
    for (const re of alias.patterns) {
      if (re.test(scrubbed)) {
        found.add(alias.tf);
        break;
      }
    }
  }
  return TF_ORDER.filter((tf) => found.has(tf)).map((tf) => ({
    tf,
    bitget: TF_META[tf].bitget,
    source: 'explicit' as const,
  }));
}
