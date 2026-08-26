import { parseMarketNumber } from '../utils/numbers.js';
import type { MarketClaim } from '../agents/claims.js';
import type { EventVerification } from './verify.js';

/**
 * CONTEXTO DE EVENTOS PARA EL LLM + CLAIMS (FASE D).
 * - Bloque compacto con lo verificado (máx 2-3 fuentes), hora de Argentina,
 *   corrección del horario del usuario si corresponde.
 * - Claims de evento con procedencia 'event': los números de fuentes verificadas
 *   pasan al guard con separación semántica (nunca validan indicadores de mercado
 *   y nunca se mezclan entre activos/entidades).
 */

/** Reglas de prompt para eventos (se agregan al system prompt cuando hay evento). */
export const EVENT_INSTRUCTIONS = `
REGLAS DE EVENTOS/VERIFICACIÓN:
- Distinguí SIEMPRE "EVENTO VERIFICADO/PARTIAL/NO VERIFICADO" según la sección EVENTO del contexto. Nunca presentes una afirmación del usuario como hecho verificado.
- Si el evento no está verificado: decilo ("no pude verificarlo") y seguí con el análisis técnico si los datos de mercado están disponibles.
- Citá horarios solo de "event_time_argentina" verificado. Si timingVerified es false, NO des una hora: decí que no se pudo verificar la hora oficial.
- Si el horario del usuario no coincide con el verificado, corregilo breve y naturalmente citando la fuente.
- No uses el horario incorrecto del usuario para el análisis.
- Una hipótesis del usuario (ej "supongamos CPI 0,5%") se discute como escenario hipotético, jamás como dato observado.
`;

/** Extrae números de una fuente verificada (determinista, conservador). */
function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?[\d][\d.,]*(?:[kKmMbB%])?/g)) {
    const raw = m[0];
    const after = text.slice(m.index ?? 0 + raw.length, (m.index ?? 0) + raw.length + 14);
    let n = parseMarketNumber(raw);
    if (n === null) continue;
    // Escala por palabra: "91 billion" → 91e9 (el modelo puede citar "91B").
    if (!/[kKmMbB]$/.test(raw)) {
      if (/\b(billion|bn|mil millones)\b/i.test(after)) n *= 1e9;
      else if (/\b(million|mn|millones)\b/i.test(after)) n *= 1e6;
      else if (/\b(thousand)\b/i.test(after)) n *= 1e3;
    }
    if (raw.length >= 2 && raw.length <= 14) out.push(n);
  }
  return out.slice(0, 10);
}

/**
 * Construye los claims de evento permitidos (solo de fuentes verificadas).
 * - Números: EPS, revenue, CPI, tasas, etc. (símbolo = entidad o GLOBAL).
 * - Hora de Argentina verificada: field 'event:time_argentina' (valor = hora).
 * Los claims con field 'event:*' NO matchean labels de mercado en el validator
 * (separación semántica) y están acotados a su símbolo (entidad).
 */
export function buildEventClaims(v: EventVerification): MarketClaim[] {
  if (v.state !== 'EVENT_VERIFIED' && v.state !== 'EVENT_PARTIALLY_VERIFIED') return [];
  const symbol = (v.entity ?? 'GLOBAL').toUpperCase();
  const claims: MarketClaim[] = [];

  for (const s of v.sources) {
    const numbers = extractNumbers(`${s.title} ${s.snippet}`);
    for (const n of numbers) {
      claims.push({
        symbol,
        field: `event:${s.subEvent ?? 'source'}`,
        value: n,
        source: 'event',
      });
    }
  }

  if (v.timingVerified && v.eventTimeArgentina) {
    const hour = Number(v.eventTimeArgentina.split(':')[0]);
    const minute = Number(v.eventTimeArgentina.split(':')[1]);
    if (Number.isFinite(hour)) {
      claims.push({ symbol, field: 'event:time_argentina_hour', value: hour, source: 'event' });
      claims.push({ symbol, field: 'event:time_argentina_minute', value: minute, source: 'event' });
    }
  }
  // Hora ORIGINAL del evento (ej "4:20 PM ET") — el modelo puede citarla en ET/PT
  // además de la hora de Argentina; ambas son válidas con su timezone.
  if (v.timingVerified && v.eventTimeOriginal) {
    const oh = Number(v.eventTimeOriginal.split(':')[0]);
    const om = Number(v.eventTimeOriginal.split(':')[1]);
    if (Number.isFinite(oh)) {
      claims.push({ symbol, field: 'event:time_original_hour', value: oh, source: 'event' });
      claims.push({ symbol, field: 'event:time_original_minute', value: om, source: 'event' });
    }
  }
  return claims;
}

/** Bloque compacto de contexto del evento para el LLM (máx 3 fuentes). */
export function buildEventContext(v: EventVerification): string {
  const lines: string[] = [`EVENTO DETECTADO: ${v.entity ?? '(sin entidad)'} — ${v.eventType}`];
  lines.push(`VERIFICACIÓN: ${v.state}${v.reason ? ` (${v.reason})` : ''}`);
  lines.push(`QUERY USADA: ${v.query}`);
  if (v.eventDate) lines.push(`FECHA: ${v.eventDate}`);
  if (v.eventTimeOriginal) lines.push(`HORA OFICIAL: ${v.eventTimeOriginal} ${v.eventTimezoneOriginal ?? ''}`.trim());
  if (v.timingVerified && v.eventTimeArgentina) {
    lines.push(`HORA ARGENTINA: ${v.eventDateArgentina} ${v.eventTimeArgentina} (America/Argentina/Buenos_Aires)`);
  } else if (v.eventDate) {
    lines.push('HORA: no verificada (solo fecha confirmada)');
  }
  lines.push(`ESTADO TEMPORAL: ${v.eventStatus}${v.countdownMs !== null ? ` (faltan ~${Math.max(1, Math.round(v.countdownMs / 60000))} min)` : ''}`);
  if (v.userClaimedTime) {
    const claim = `${String(v.userClaimedTime.hour).padStart(2, '0')}:${String(v.userClaimedTime.minute).padStart(2, '0')}${v.userClaimedTime.timezone ? ' ' + v.userClaimedTime.timezone : ''}`;
    const match = v.timeClaimMatches === null ? 'sin evidencia para comparar' : v.timeClaimMatches ? 'coincide' : 'NO coincide';
    lines.push(`HORA DICHA POR USUARIO: ${claim} (${match})`);
  }
  lines.push('FUENTES:');
  for (const s of v.sources.slice(0, 3)) {
    lines.push(
      `- ${s.title} | ${s.url} | ${s.priority}${s.eventTimeOriginal ? ` | ${s.eventTimeOriginal} ${s.eventTimezoneOriginal ?? ''}` : ''}${s.subEvent ? ` | ${s.subEvent}` : ''}${s.publishedAt ? ` | publicado ${s.publishedAt}` : ''}`,
    );
  }
  return lines.join('\n');
}
