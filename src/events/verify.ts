import type { ExaClient } from '../data/web/exa.js';
import { withTimeout } from '../agents/fetch-multitf.js';
import { toArgentinaTime, ianaFromAbbrev } from './timezone.js';
import {
  eventSearchLabel,
  type ClaimedTime,
  type EventInfo,
  type EventType,
} from './detect.js';

/**
 * VERIFICACIÓN DETERMINISTA DE EVENTOS (FASE D) vía Exa.
 * - query construida con entidad + tipo + fecha resuelta (no búsqueda genérica);
 * - scoring de relevancia (entidad + tipo + fecha + dominio);
 * - extracción de fecha/hora/timezone desde snippets;
 * - estados: VERIFIED / PARTIALLY / UNVERIFIED / UNVERIFIABLE / CONFLICTING;
 * - release vs conference call como sub-eventos (no contradicción);
 * - conversión a America/Argentina/Buenos_Aires con DST real;
 * - estado temporal (UPCOMING/NOW/DONE) y countdown programático.
 */

export type VerificationState =
  | 'EVENT_VERIFIED'
  | 'EVENT_PARTIALLY_VERIFIED'
  | 'EVENT_UNVERIFIED'
  | 'EVENT_UNVERIFIABLE'
  | 'EVENT_CONFLICTING_SOURCES';

export type EventTemporalStatus =
  | 'UPCOMING'
  | 'HAPPENING_NOW'
  | 'ALREADY_HAPPENED'
  | 'DATE_KNOWN_TIME_UNKNOWN'
  | 'UNVERIFIED';

export type SourcePriority = 'oficial' | 'alta' | 'media';

export interface EventSourceInfo {
  title: string;
  url: string;
  publishedAt?: string;
  eventDate?: string;
  eventTimeOriginal?: string;
  eventTimezoneOriginal?: string;
  snippet: string;
  score: number;
  priority: SourcePriority;
  subEvent?: 'release' | 'call';
}

export interface EventVerification {
  state: VerificationState;
  reason?: string;
  query: string;
  entity: string | null;
  eventType: EventType;
  sources: EventSourceInfo[];
  eventDate: string | null;
  eventTimeOriginal: string | null;
  eventTimezoneOriginal: string | null;
  eventDatetimeUtcMs: number | null;
  eventTimeArgentina: string | null;
  eventDateArgentina: string | null;
  timingVerified: boolean;
  userClaimedTime: ClaimedTime | null;
  timeClaimMatches: boolean | null;
  dateClaimMatches: boolean | null;
  /** Hora de Argentina por sub-evento verificado (release vs conference call). */
  subEventTimesArgentina?: { release?: string; call?: string };
  eventStatus: EventTemporalStatus;
  countdownMs: number | null;
  latencyMs: number;
}

const OFFICIAL_RE =
  /\.gov\b|federalreserve\.gov|bls\.gov|bea\.gov|sec\.gov|investor\.|ir\.|nasdaq\.com|nyse\.com|\.ir\.|press[.-]release/i;
const HIGH_MEDIA_RE =
  /reuters\.com|bloomberg\.com|cnbc\.com|marketwatch\.com|wsj\.com|ft\.com|apnews\.com|barrons\.com|fortune\.com|coindesk\.com|cointelegraph\.com|theblock\.co|axios\.com/i;

const TYPE_KEYWORDS: Record<EventType, RegExp> = {
  earnings: /earnings|results|resultados|guidance|eps|revenue|balance|call/i,
  macro: /fomc|fed|federal reserve|tasas|rates|cpi|inflation|inflaci[oó]n|pce|nfp|payroll|empleo|gdp|pbi|decisi[oó]n/i,
  crypto: /etf|sec|regulaci|hack|exploit|unlock|halving|fork|quiebra|listado|delisting|aproba|rechaza/i,
  catalizador: /aranceles|sanciones|legislaci[oó]n|geopol|noticia|anuncio|conferencia/i,
  datos: /data|dato|report|release|publicaci[oó]n/i,
};

const TIME_RE = /\b(\d{1,2}):(\d{2})\s*(?:[ap]\.?m\.?)?\s*(ET|EST|EDT|PT|PST|PDT|UTC|GMT)?/i;
const TIME_AMPM_RE = /\b(\d{1,2}):?(\d{2})?\s*([ap]\.?m\.?)\s*(ET|EST|EDT|PT|PST|PDT|UTC|GMT)?/i;

const SUBEVENT_CALL_RE = /conference call|earnings call|investor call|call de resultados|webcast/i;
const SUBEVENT_RELEASE_RE = /press release|earnings release|results (released|published)|comunicado de resultados|reportados? (resultados)/i;

/** Fecha de hoy en zona Argentina (YYYY-MM-DD). */
function todayArt(nowMs: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(nowMs));
}

/** Query orientada al evento (entidad + tipo + fecha), no genérica. */
export function buildEventSearchQuery(info: EventInfo, nowMs = Date.now()): string {
  const parts: string[] = [];
  // Entidades que ya nombran el evento en su label (FOMC/CPI/NFP/ETF/SEC) no se duplican.
  const selfLabeling = ['FOMC', 'CPI', 'NFP', 'ETF', 'SEC'];
  if (info.entity && !selfLabeling.includes(info.entity.toUpperCase())) parts.push(info.entity);
  switch (info.type) {
    case 'earnings':
      parts.push('earnings results');
      break;
    case 'macro':
      if (info.entity === 'FOMC') parts.push('FOMC decision');
      else if (info.entity === 'CPI') parts.push('CPI report');
      else if (info.entity === 'NFP') parts.push('nonfarm payrolls report');
      else parts.push('economic data release');
      break;
    default:
      parts.push(eventSearchLabel(info.type));
  }
  if (info.relativeDate?.resolved) {
    parts.push(info.relativeDate.date);
  } else if (info.type === 'macro' || info.type === 'earnings') {
    // Evento macro/earnings sin fecha explícita → se busca el del período actual.
    parts.push(todayArt(nowMs));
  }
  return parts.join(' ');
}

/** Prioridad de fuente: dominio de la propia entidad (ej nvidia.com para Nvidia) = oficial. */
function domainPriority(url: string, entity?: string | null): SourcePriority {
  if (entity && entity.length >= 3 && url.toLowerCase().includes(entity.toLowerCase())) return 'oficial';
  if (OFFICIAL_RE.test(url)) return 'oficial';
  if (HIGH_MEDIA_RE.test(url)) return 'alta';
  return 'media';
}

/** Puntaje de relevancia determinista: entidad + tipo + fecha + título + dominio.
 *  Devuelve además flags de entidad/tipo para exigir AMBOS (relevancia estricta). */
export function scoreResult(
  title: string,
  text: string,
  url: string,
  info: EventInfo,
): { score: number; entityMatched: boolean; typeMatched: boolean } {
  let score = 0;
  let entityMatched = false;
  const haystack = `${title} ${text}`;
  const entity = info.entity;
  if (entity) {
    const entityRe = new RegExp(`\\b${escapeRe(entity)}\\b|\\b${escapeRe(entity).toUpperCase()}\\b`, 'i');
    entityMatched =
      entityRe.test(haystack) || haystack.toLowerCase().includes(entity.toLowerCase());
    if (entityMatched) score += 2;
  }
  const typeMatched = TYPE_KEYWORDS[info.type].test(haystack);
  if (typeMatched) score += 2;
  if (info.relativeDate?.resolved) {
    if (haystack.includes(info.relativeDate.date)) score += 1;
    else if (info.relativeDate.label === 'hoy' && /\btoday\b|hoy\b/i.test(haystack)) score += 1;
    else if (info.relativeDate.label === 'mañana' && /\btomorrow\b|ma[nñ]ana\b/i.test(haystack)) score += 1;
  }
  if (entity && title.toLowerCase().includes(entity.toLowerCase())) score += 1;
  const priority = domainPriority(url, entity);
  if (priority === 'oficial') score += 2;
  else if (priority === 'alta') score += 1;
  return { score, entityMatched, typeMatched };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Normaliza una fecha textual a YYYY-MM-DD (meses en inglés/español). */
function normalizeDate(raw: string): string | null {
  const iso = raw.match(/(20\d{2}-\d{2}-\d{2})/);
  if (iso?.[1]) return iso[1];
  const m = raw.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?/i);
  if (m) {
    const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const month = months[m[0]!.slice(0, 3).toLowerCase()];
    const year = m[2] ?? String(new Date().getUTCFullYear());
    if (month) return `${year}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  return null;
}

function extractTime(raw: string): { time: string; tz: string | null } | null {
  const m = raw.match(TIME_AMPM_RE) ?? raw.match(TIME_RE);
  if (!m?.[1]) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (m[3]) {
    if (/pm/i.test(m[3]) && hour < 12) hour += 12;
    if (/am/i.test(m[3]) && hour === 12) hour = 0;
  }
  return {
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    tz: m[4] ? m[4].toUpperCase() : null,
  };
}

function subEventOf(text: string): 'call' | 'release' | undefined {
  if (SUBEVENT_CALL_RE.test(text)) return 'call';
  if (SUBEVENT_RELEASE_RE.test(text)) return 'release';
  return undefined;
}

export interface VerifyOptions {
  timeoutMs?: number;
  nowMs?: number;
  maxSources?: number;
}

const DEFAULT_TIMEOUT = 4000;

/**
 * Verifica un evento: búsqueda Exa obligatoria + evaluación determinista.
 * Nunca "verifica" por coincidencia débil: exige entidad+tipo (score ≥ 3).
 */
export async function verifyEvent(
  exa: Pick<ExaClient, 'search'>,
  info: EventInfo,
  opts: VerifyOptions = {},
): Promise<EventVerification> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const now = opts.nowMs ?? Date.now();
  const query = buildEventSearchQuery(info, now);
  const t0 = Date.now();

  let results: Awaited<ReturnType<typeof exa.search>>;
  try {
    results = await withTimeout(exa.search(query, 5), timeoutMs, 'event search');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return baseVerification(info, query, 'EVENT_UNVERIFIABLE', `exa: ${msg}`, t0);
  }

  const evaluated = results
    .map((r) => {
      const text = (r.text ?? '') + ' ' + (r.highlights ?? []).join(' ');
      const scored = scoreResult(r.title ?? '', text, r.url ?? '', info);
      return {
        title: r.title ?? '',
        url: r.url ?? '',
        publishedAt: r.publishedDate,
        snippet: text.slice(0, 300),
        score: scored.score,
        entityMatched: scored.entityMatched,
        typeMatched: scored.typeMatched,
        priority: domainPriority(r.url ?? '', info.entity),
        subEvent: subEventOf(text),
        eventDate: normalizeDate(text) ?? undefined,
        time: extractTime(text),
      };
    })
    // Relevancia ESTRICTA: se exige entidad Y tipo confirmados (no coincidencia débil).
    .filter((e) => e.score >= 3 && e.entityMatched && e.typeMatched)
    .sort((a, b) => b.score - a.score);

  if (evaluated.length === 0) {
    return baseVerification(info, query, 'EVENT_UNVERIFIED', 'sin resultados relevantes', t0);
  }

  // Fecha: prioridad a la fuente mejor puntuada con fecha.
  const withDate = evaluated.find((e) => e.eventDate);
  const eventDate = withDate?.eventDate ?? null;

  // Horarios por sub-evento (release vs call no son contradicción).
  const pickTime = (sub?: 'call' | 'release'): { time: string; tz: string | null; source: string } | null => {
    const candidates = evaluated.filter((e) => e.subEvent === sub || (!e.subEvent && sub === undefined));
    if (candidates.length === 0) return null;
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    return best?.time ? { time: best.time.time, tz: best.time.tz, source: best.url } : null;
  };
  const callTime = pickTime('call');
  const releaseTime = pickTime('release');
  const genericTime = pickTime(undefined);
  const primary = releaseTime ?? callTime ?? genericTime;

  // Conflicto: dos fuentes relevantes con horarios distintos y sin sub-evento que lo explique.
  const times = new Map<string, { time: string; tz: string | null; priority: SourcePriority }>();
  for (const e of evaluated) {
    if (e.time) times.set(e.url, { time: e.time.time, tz: e.time.tz, priority: e.priority });
  }
  const distinct = [...new Set([...times.values()].map((v) => `${v.time} ${v.tz ?? ''}`))];
  const conflict =
    distinct.length > 1 &&
    !(callTime && releaseTime) && // release + call con horarios distintos = sub-eventos, no conflicto
    [...times.values()].filter((v) => v.priority === 'oficial').length === 0;

  const sources: EventSourceInfo[] = evaluated.slice(0, opts.maxSources ?? 3).map((e) => ({
    title: e.title,
    url: e.url,
    publishedAt: e.publishedAt,
    eventDate: e.eventDate,
    eventTimeOriginal: e.time?.time,
    eventTimezoneOriginal: e.time?.tz ?? undefined,
    snippet: e.snippet.slice(0, 200),
    score: e.score,
    priority: e.priority,
    subEvent: e.subEvent,
  }));

  // Conversión a Argentina (solo con fecha+hora+timezone suficientemente confiable).
  let eventDatetimeUtcMs: number | null = null;
  let eventTimeArgentina: string | null = null;
  let eventDateArgentina: string | null = null;
  let timingVerified = false;
  if (eventDate && primary?.time) {
    const tz = primary.tz ?? (callTime?.tz ?? releaseTime?.tz) ?? 'ET'; // default razonable para US markets
    if (ianaFromAbbrev(tz)) {
      const [h, mi] = primary.time.split(':').map(Number) as [number, number];
      const arg = toArgentinaTime({ date: eventDate, hour: h, minute: mi }, tz);
      if (arg) {
        eventDatetimeUtcMs = arg.utcMs;
        eventTimeArgentina = arg.time;
        eventDateArgentina = arg.date;
        timingVerified = true;
      }
    }
  }

  // Hora de Argentina por sub-evento (release vs call): permite comparar la hora
  // dicha por el usuario contra el sub-evento que él mencionó, no solo el primario.
  const subEventTimesArgentina: { release?: string; call?: string } = {};
  if (eventDate) {
    const toArg = (t: { time: string; tz: string | null } | null): string | null => {
      if (!t?.time) return null;
      const tz = t.tz ?? 'ET';
      if (!ianaFromAbbrev(tz)) return null;
      const [h, mi] = t.time.split(':').map(Number) as [number, number];
      const arg = toArgentinaTime({ date: eventDate, hour: h, minute: mi }, tz);
      return arg ? arg.time : null;
    };
    const relArg = toArg(releaseTime);
    const callArg = toArg(callTime);
    if (relArg) subEventTimesArgentina.release = relArg;
    if (callArg) subEventTimesArgentina.call = callArg;
  }

  let state: VerificationState;
  if (conflict) {
    state = 'EVENT_CONFLICTING_SOURCES';
  } else if (eventDate && timingVerified) {
    state = 'EVENT_VERIFIED';
  } else if (eventDate) {
    state = 'EVENT_PARTIALLY_VERIFIED';
  } else {
    state = 'EVENT_PARTIALLY_VERIFIED';
  }

  const v = baseVerification(info, query, state, undefined, t0);
  v.sources = sources;
  v.eventDate = eventDate;
  v.eventTimeOriginal = primary?.time ?? null;
  v.eventTimezoneOriginal = primary?.tz ?? null;
  v.eventDatetimeUtcMs = eventDatetimeUtcMs;
  v.eventTimeArgentina = eventTimeArgentina;
  v.eventDateArgentina = eventDateArgentina;
  v.timingVerified = timingVerified;
  if (Object.keys(subEventTimesArgentina).length > 0) {
    v.subEventTimesArgentina = subEventTimesArgentina;
  }

  // Estado temporal + countdown (programático, nunca del LLM).
  if (eventDatetimeUtcMs !== null) {
    const diffMs = eventDatetimeUtcMs - now;
    if (diffMs < -30 * 60_000) v.eventStatus = 'ALREADY_HAPPENED';
    else if (diffMs <= 30 * 60_000) v.eventStatus = 'HAPPENING_NOW';
    else {
      v.eventStatus = 'UPCOMING';
      v.countdownMs = diffMs;
    }
  } else if (eventDate) {
    v.eventStatus = 'DATE_KNOWN_TIME_UNKNOWN';
  } else {
    v.eventStatus = 'UNVERIFIED';
  }

  v.timeClaimMatches = computeTimeClaimMatch(info, v, now);
  v.dateClaimMatches =
    info.relativeDate?.resolved && eventDate !== null ? info.relativeDate.date === eventDate : null;
  return v;
}

/** Compara la hora dicha por el usuario con la hora verificada (true/false/null).
 *  FIX (auditoría final): si el usuario menciona un sub-evento (release/call) y
 *  existe su hora Argentina verificada, se compara contra ESE sub-evento, no solo
 *  contra el primario. Con timing verificado SIEMPRE devuelve boolean (nunca null). */
function computeTimeClaimMatch(info: EventInfo, v: EventVerification, nowMs: number): boolean | null {
  const claimed = info.claimedTime;
  if (!claimed) return null;
  if (!v.timingVerified) return null;

  let verifiedTime = v.eventTimeArgentina;
  if (info.claimedSubEvent && v.subEventTimesArgentina?.[info.claimedSubEvent]) {
    verifiedTime = v.subEventTimesArgentina[info.claimedSubEvent]!;
  }
  if (verifiedTime === null) return null;

  let claimedInArgentina: { hour: number; minute: number } | null = null;
  if (info.claimedTimeZone) {
    const arg = toArgentinaTime({ date: v.eventDate ?? todayArg(nowMs), hour: claimed.hour, minute: claimed.minute }, info.claimedTimeZone);
    if (arg) claimedInArgentina = { hour: Number(arg.time.split(':')[0]), minute: Number(arg.time.split(':')[1]) };
  } else {
    // Sin timezone explícita: se asume que el usuario (argentino) habla en hora local.
    claimedInArgentina = { hour: claimed.hour, minute: claimed.minute };
  }
  if (!claimedInArgentina) return null;
  const [vh, vm] = verifiedTime.split(':').map(Number) as [number, number];
  const claimedMin = claimedInArgentina.hour * 60 + claimedInArgentina.minute;
  const verifiedMin = vh * 60 + vm;
  return Math.abs(claimedMin - verifiedMin) <= 30;
}

function todayArg(nowMs: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(nowMs));
}

function baseVerification(
  info: EventInfo,
  query: string,
  state: VerificationState,
  reason: string | undefined,
  t0: number,
): EventVerification {
  return {
    state,
    reason,
    query,
    entity: info.entity,
    eventType: info.type,
    sources: [],
    eventDate: null,
    eventTimeOriginal: null,
    eventTimezoneOriginal: null,
    eventDatetimeUtcMs: null,
    eventTimeArgentina: null,
    eventDateArgentina: null,
    timingVerified: false,
    userClaimedTime: info.claimedTime,
    timeClaimMatches: null,
    dateClaimMatches: null,
    eventStatus: 'UNVERIFIED',
    countdownMs: null,
    latencyMs: Date.now() - t0,
  };
}

/** Evento que no se puede verificar (sin Exa o fallo previo) — estado explícito. */
export function unverifiableEvent(info: EventInfo, reason: string): EventVerification {
  return baseVerification(info, buildEventSearchQuery(info), 'EVENT_UNVERIFIABLE', reason, Date.now());
}
