/**
 * Normalización de timezones (FASE D).
 * Convierte abreviaturas (ET/EST/EDT/PT/PST/PDT/UTC/GMT) a zonas IANA y
 * calcula la hora de America/Argentina/Buenos_Aires con reglas DST reales
 * vía Intl (sin offsets fijos — ET no es siempre "-2" de Argentina).
 */

/** Abreviatura → zona IANA (DST resuelto por Intl según la fecha). */
const TZ_ABBREV: Record<string, string> = {
  ET: 'America/New_York',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  PT: 'America/Los_Angeles',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  UTC: 'UTC',
  GMT: 'UTC',
};

const ARGENTINA_TZ = 'America/Argentina/Buenos_Aires';

/** Resuelve una abreviatura a zona IANA; null si no se reconoce. */
export function ianaFromAbbrev(abbrev: string): string | null {
  const key = abbrev.trim().toUpperCase();
  return TZ_ABBREV[key] ?? null;
}

/** Offset (ms) de `iana` en el instante `epochMs` (correcto por DST). */
export function tzOffsetMsAt(iana: string, epochMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return asUtc - (epochMs - (epochMs % 60_000));
}

export interface WallTime {
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  minute: number;
}

/** Interpreta hora de pared en `iana` y devuelve ms UTC (2 pasadas para DST). */
export function wallTimeToUtc(wall: WallTime, iana: string): number | null {
  const guess = Date.parse(`${wall.date}T${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}:00Z`);
  if (Number.isNaN(guess)) return null;
  let epoch = guess - tzOffsetMsAt(iana, guess);
  // Segunda pasada: corrige si el guess cruzó una transición de DST.
  epoch = guess - tzOffsetMsAt(iana, epoch);
  return epoch;
}

export interface ArgentinaTime {
  utcMs: number;
  date: string; // YYYY-MM-DD (Argentina)
  time: string; // HH:MM (Argentina)
  offsetFromUtcHours: number;
}

/**
 * Convierte (fecha + hora + timezone original) a hora de Argentina.
 * Devuelve null si algo falta o es inválido (nunca inventa componentes).
 */
export function toArgentinaTime(wall: WallTime, tz: string): ArgentinaTime | null {
  const iana = ianaFromAbbrev(tz);
  if (!iana) return null;
  const utcMs = wallTimeToUtc(wall, iana);
  if (utcMs === null) return null;

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const offset = tzOffsetMsAt(ARGENTINA_TZ, utcMs) / 3_600_000;

  return {
    utcMs,
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    offsetFromUtcHours: offset,
  };
}

/** ¿La abreviatura es de la costa este/PT/UTC? (para decidir si la hora mencionada es local del evento). */
export function isKnownTimezone(abbrev: string): boolean {
  return ianaFromAbbrev(abbrev) !== null;
}
