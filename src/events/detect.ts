import { extractAllTickers } from '../utils/tickers.js';

/**
 * DETECTOR DETERMINISTA DE EVENTOS (FASE D).
 * Decide por regex si la consulta menciona un evento potencialmente relevante
 * para una decisión de trading → dispara web_search obligatoria. Sin LLM.
 * Diseñado para evitar falsos positivos de conversación técnica normal.
 */

export type EventType =
  | 'earnings'
  | 'macro'
  | 'crypto'
  | 'catalizador'
  | 'datos';

export interface EventIntent {
  type: EventType;
  /** Regex que disparó (para testabilidad). */
  matchedPattern: string;
}

export const EVENT_PATTERNS: ReadonlyArray<{ type: EventType; label: string; re: RegExp }> = [
  {
    type: 'earnings',
    label: 'earnings',
    re: /resultados|earnings|presenta (resultados|balance|n[uú]meros)|presenta\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+|\bpresenta\b|balance trimestral|guidance|conference call|investor call|earning[s]? call|dividendos|split|recompra|anuncio corporativo|ganancias trimestrales/i,
  },
  {
    type: 'macro',
    label: 'macro',
    re: /\bFOMC\b|reserva federal|la fed (decide|anuncia|sube|baja|se re[uú]ne)|decisi[oó]n de tasas|tasas? de inter[eé]s|powell|\bCPI\b|\bIPC\b|inflaci[oó]n|\bPCE\b|\bNFP\b|nonfarm|n[oó]minas? (de empleo|no agrícolas)|dato de empleo|desempleo|\bGDP\b|\bPBI\b|dato macro|conferencia de (la )?fed|banco central/i,
  },
  {
    type: 'crypto',
    label: 'crypto',
    re: /\bETF\b|\bSEC\b|regulaci[oó]n|aprobaci[oó]n (de|del) (ETF|spot)|rechazo (de|del) (ETF|spot)|hack(eado)?|exploit|vulnerabilidad|token unlock|\bunlock\b|halving|\bfork\b|delisting|listado en (un )?exchange|quiebra|insolvencia|liquidaci[oó]n (de|del)?\s*(protocolo|exchange|fondo)|anuncio de (protocolo|exchange)/i,
  },
  {
    type: 'catalizador',
    label: 'catalizador',
    re: /aranceles|sanciones|legislaci[oó]n|conflicto|geopol[ií]tica|noticia|evento (macro|de mercado)|anuncio|conferencia|publicaci[oó]n de datos|reporte de (resultados|datos)/i,
  },
  {
    type: 'datos',
    label: 'datos',
    re: /sale (el|la) (dato|n[uú]mero)|publican (el|la) (dato|n[uú]mero)|se publica (el|la) (dato|n[uú]mero)/i,
  },
];

/** Detección determinista: devuelve el primer patrón que matchea o null. */
export function detectEventIntent(text: string): EventIntent | null {
  for (const p of EVENT_PATTERNS) {
    if (p.re.test(text)) return { type: p.type, matchedPattern: p.re.source };
  }
  return null;
}

export interface RelativeDate {
  label: string;
  date: string; // YYYY-MM-DD resuelta
  resolved: boolean;
}

const RELATIVE_DATE_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'ayer', re: /ayer|anoche|la madrugada de hoy/i },
  { label: 'hoy', re: /hoy|esta tarde|esta noche|esta madrugada|ahora|en unas horas|antes de (la )?apertura|premarket|despu[eé]s del cierre|after (market|hours)/i },
  { label: 'mañana', re: /ma[nñ]ana|la semana que viene|esta semana/i },
];

/** Resuelve la fecha de una referencia relativa con la fecha real actual (zona Argentina). */
export function resolveRelativeDate(text: string, nowMs = Date.now()): RelativeDate | null {
  const d = new Date(nowMs);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const today = fmt.format(d); // YYYY-MM-DD
  const shift = (days: number): string => {
    const t = new Date(nowMs + days * 86_400_000);
    return fmt.format(t);
  };

  for (const p of RELATIVE_DATE_PATTERNS) {
    if (p.re.test(text)) {
      if (p.label === 'ayer') return { label: 'ayer', date: shift(-1), resolved: true };
      if (p.label === 'mañana') return { label: 'mañana', date: shift(1), resolved: true };
      return { label: 'hoy', date: today, resolved: true };
    }
  }
  return null;
}

export interface ClaimedTime {
  hour: number;
  minute: number;
  hasAmPm: boolean;
  pm: boolean;
  timezone?: string;
}

const CLAIMED_TIME_RE =
  /(?:a las|a la|las)\s*(\d{1,2})(?::(\d{2}))?\s*(?:hs|horas?)?\s*(am|pm)?\s*(ET|EST|EDT|PT|PST|PDT|UTC|GMT)?/i;

/** Extrae la hora dicha por el usuario (si existe) y su timezone. */
export function extractClaimedTime(text: string): ClaimedTime | null {
  const m = text.match(CLAIMED_TIME_RE);
  if (!m?.[1]) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const hasAmPm = Boolean(m[3]);
  const pm = /pm/i.test(m[3] ?? '');
  if (hasAmPm && pm && hour < 12) hour += 12;
  if (hasAmPm && !pm && hour === 12) hour = 0;
  return { hour, minute, hasAmPm, pm, timezone: m[4] };
}

export interface EventInfo {
  type: EventType;
  entity: string | null;
  relativeDate: RelativeDate | null;
  claimedTime: ClaimedTime | null;
  claimedTimeZone: string | null;
  /** Sub-evento que el usuario menciona (release vs conference call) — para
   *  comparar su hora contra el sub-evento verificado correspondiente. */
  claimedSubEvent?: 'call' | 'release';
  userAsset: string | null;
  rawClaim: string;
}

const ENTITY_PRE_RE =
  /(?<=^|[.!?]\s)\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+|\s+(?:de|del|la|el)?\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)\s+(presenta|reporta|anuncia|publica|saca|sale|earnings|resultados)/;
const ENTITY_POST_RE =
  /(?:presenta|reporta|anuncia|publica|saca|sale)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+|\s+(?:de|del|la|el)?\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/;
/** Frase nominal: "Tesla earnings", "resultados de Nvidia" (sin verbo). */
const ENTITY_NOUN_RE =
  /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+|\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)\s+(?:earnings|resultados|guidance)|\b(?:earnings|resultados)\s+de\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+|\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/;

/** Extracción determinista de entidad/evento/fecha/hora. Lo incierto queda null. */
export function extractEventInfo(text: string, nowMs = Date.now()): EventInfo {
  const intent = detectEventIntent(text);
  const type = intent?.type ?? 'catalizador';
  const pre = text.match(ENTITY_PRE_RE);
  const post = text.match(ENTITY_POST_RE);
  const noun = text.match(ENTITY_NOUN_RE);
  let entity: string | null =
    pre?.[1]?.trim() ??
    post?.[1]?.trim() ??
    noun?.[1]?.trim() ??
    noun?.[2]?.trim() ??
    null;
  if (entity && entity.length > 24) entity = null; // captura excesiva → descartar
  if (!entity && /\bFOMC\b|reserva federal|la fed\b|powell/i.test(text)) entity = 'FOMC';
  if (!entity && /\bCPI\b|\bIPC\b|inflaci[oó]n/i.test(text)) entity = 'CPI';
  if (!entity && /\bNFP\b|empleo|nonfarm/i.test(text)) entity = 'NFP';
  if (!entity && /\bETF\b/i.test(text)) entity = 'ETF';
  if (!entity && type === 'crypto' && /\bSEC\b/i.test(text)) entity = 'SEC';

  const claimedTime = extractClaimedTime(text);
  const claimedSubEvent = /\b(conference call|earnings call|investor call|webcast)\b/i.test(text)
    ? 'call'
    : /\b(press release|earnings release|release de resultados|comunicado de resultados|resultados publicados)\b/i.test(text)
      ? 'release'
      : undefined;
  return {
    type,
    entity,
    relativeDate: resolveRelativeDate(text, nowMs),
    claimedTime,
    claimedTimeZone: claimedTime?.timezone ?? null,
    claimedSubEvent,
    userAsset: extractAllTickers(text)[0] ?? null,
    rawClaim: text.slice(0, 160),
  };
}

/** Etiqueta de búsqueda según tipo de evento. */
export function eventSearchLabel(type: EventType): string {
  switch (type) {
    case 'earnings':
      return 'earnings results';
    case 'macro':
      return 'decision announcement';
    case 'crypto':
      return 'news';
    default:
      return 'news announcement';
  }
}
