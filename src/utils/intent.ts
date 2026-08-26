import {
  INTENT_POLICIES,
  MAX_TFS_PER_REQUEST,
  TF_META,
  type Intent,
  type TfLabel,
} from '../config/timeframes.js';
import { extractTimeframes, type TimeframeRequest } from './timeframes.js';

/**
 * Política por intención (FASE A): decide qué timeframes usar cuando el usuario
 * NO especifica ninguno. Determinista (regex), barata y testeable.
 *
 * Regla clave (aprobada): si el usuario especifica TF, SE RESPETAN tal cual;
 * nunca se sustituye un TF pedido por otro (no fallback silencioso a 1D).
 */

/** Patrones de intención, en orden de precedencia (el primero que matchea gana). */
const INTENT_PATTERNS: ReadonlyArray<{ intent: Intent; re: RegExp }> = [
  { intent: 'alerta', re: /avis|alerta|cuando (supere|baje|toque|rompa)/i },
  { intent: 'scalp', re: /scalp|scalping|r[aá]pid[oa]|timing|intrad[ií]a corto/i },
  { intent: 'entrada', re: /entrar|entrada|setup|comprar|vender|operar|operaci[oó]n|entr[ií]a|tomar (posici[oó]n|ganancia)/i },
  { intent: 'swing', re: /swing|medio plazo/i },
  { intent: 'niveles', re: /soporte|resistencia|nivel(es)?|zona de decisi[oó]n/i },
  { intent: 'vwap', re: /vwap|precio promedio ponderado/i },
  { intent: 'tendencia', re: /tendencia|estructura|r[eé]gimen/i },
  { intent: 'analisis_completo', re: /completo|panorama|an[aá]lisis (completo|general|total)/i },
  { intent: 'general', re: /c[oó]mo ves|qu[eé] ves|mir[aá]|analiza(me)?|contame|qu[eé] dec[ií]s/i },
];

/** Detecta la intención principal del mensaje. Default: 'general'. */
export function detectIntent(text: string): Intent {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  return 'general';
}

/** Une la política en una lista plana de TF (contexto → estructura → ejecución), con tope. */
export function policyTimeframes(intent: Intent): TfLabel[] {
  const policy = INTENT_POLICIES[intent];
  return [...policy.contexto, ...policy.estructura, ...policy.ejecucion].slice(0, MAX_TFS_PER_REQUEST);
}

/**
 * Resolución final de timeframes para un mensaje:
 * 1) Si hay TF explícitos → se usan esos (sin sustitución).
 * 2) Si no → política por intención.
 */
export function resolveTimeframes(text: string): TimeframeRequest[] {
  const explicit = extractTimeframes(text);
  if (explicit.length > 0) return explicit;
  return policyTimeframes(detectIntent(text)).map((tf) => ({
    tf,
    bitget: TF_META[tf].bitget,
    source: 'policy' as const,
  }));
}
