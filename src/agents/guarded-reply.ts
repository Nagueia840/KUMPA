import { validateReply } from '../utils/validator.js';
import type { ClaimSet } from './claims.js';

/**
 * RESPUESTA ANTE VIOLACIÓN (FASE C).
 * 1ª violación → máximo 1 regeneración SIN tools, pidiendo usar solo datos verificados.
 * 2ª violación → negativa segura (no inventar reemplazo).
 */

export type GuardedResult =
  | { status: 'ok'; text: string }
  | { status: 'refused'; reason: string };

export const GUARD_RETRY_PROMPT =
  'Reescribí tu respuesta usando EXCLUSIVAMENTE los datos verificados del contexto (DATOS REALES YA OBTENIDOS y resultados de herramientas). ' +
  'No cites ningún número de mercado ni indicador que no esté respaldado: no estimes, no inventes, no uses tu memoria. ' +
  'Si un dato no está disponible, decilo explícitamente. Respondé con texto únicamente.';

/** Texto seguro cuando el modelo insiste en números sin respaldo. */
export const GUARD_REFUSAL_TEXT =
  'No tengo datos verificados suficientes para darte ese valor con confianza.';

export async function guardedFinalize(
  candidate: string,
  claims: ClaimSet,
  regenerate: () => Promise<string>,
): Promise<GuardedResult> {
  const v1 = validateReply(candidate, claims);
  if (v1.valid) return { status: 'ok', text: candidate };

  // La regeneración puede fallar (400 de tools con tool_choice 'none', 429, red):
  // en ese caso NO se envía la respuesta violadora → negativa segura.
  let retried = '';
  try {
    retried = await regenerate();
  } catch {
    return { status: 'refused', reason: 'regeneración falló (error de proveedor)' };
  }
  const v2 = validateReply(retried, claims);
  if (v2.valid) return { status: 'ok', text: retried };

  return {
    status: 'refused',
    reason: v2.violations.map((v) => v.reason).join(' | ') || 'violación no detallada',
  };
}
