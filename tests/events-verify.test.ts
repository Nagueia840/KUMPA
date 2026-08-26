import { describe, it, expect } from 'vitest';
import { buildEventSearchQuery, verifyEvent } from '../src/events/verify.js';
import { extractEventInfo } from '../src/events/detect.js';
import type { ExaClient } from '../src/data/web/exa.js';

type FakeSearch = Pick<ExaClient, 'search'>;

function fakeExa(results: Array<{ title: string; url: string; text?: string; highlights?: string[] }>): FakeSearch {
  return { search: async () => results } as unknown as FakeSearch;
}

function fakeExaThrows(): FakeSearch {
  return { search: async () => { throw new Error('exa down'); } } as unknown as FakeSearch;
}

function fakeExaNever(): FakeSearch {
  return { search: () => new Promise<never>(() => {}) } as unknown as FakeSearch;
}

const NOW = Date.parse('2026-08-26T18:00:00Z');

const nvidiaResult = (over: Partial<{ title: string; url: string; text: string }> = {}) => ({
  title: 'NVIDIA Reports Third Quarter Results',
  url: 'https://nvidia.com/news/earnings',
  text:
    'NVIDIA today reported revenue of $30.5 billion for the quarter ended Aug 26, 2026. Earnings per share $2.13. The results were released at 4:05 PM ET.',
  ...over,
});

describe('verifyEvent — estados de verificación (casos 14-21)', () => {
  it('14) Exa confirma evento (entidad + tipo + fecha + hora) → VERIFIED', async () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    const v = await verifyEvent(fakeExa([nvidiaResult({ text: nvidiaResult().text + ' Aug 26, 2026' })]), info, { nowMs: NOW });
    expect(v.state).toBe('EVENT_VERIFIED');
    expect(v.timingVerified).toBe(true);
    expect(v.eventTimeOriginal).toBe('16:05'); // 4:05 PM → 16:05
    expect(v.eventTimezoneOriginal).toBe('ET');
    expect(v.eventTimeArgentina).toBe('17:05'); // 16:05 EDT (verano) = 20:05 UTC → 17:05 ART
    expect(v.eventStatus).toBe('UPCOMING'); // 20:05Z > now 18:00Z
  });

  it('15) resultados irrelevantes → UNVERIFIED', async () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    const v = await verifyEvent(
      fakeExa([{ title: 'Bitcoin price analysis', url: 'https://x.com/post', text: 'BTC RSI overbought' }]),
      info,
      { nowMs: NOW },
    );
    expect(v.state).toBe('EVENT_UNVERIFIED');
    expect(v.timingVerified).toBe(false);
  });

  it('16) Exa falla → UNVERIFIABLE', async () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    const v = await verifyEvent(fakeExaThrows(), info, { nowMs: NOW });
    expect(v.state).toBe('EVENT_UNVERIFIABLE');
    expect(v.reason).toContain('exa');
  });

  it('17) Exa timeout → UNVERIFIABLE', async () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    const v = await verifyEvent(fakeExaNever(), info, { nowMs: NOW, timeoutMs: 60 });
    expect(v.state).toBe('EVENT_UNVERIFIABLE');
  });

  it('18) dos fuentes coinciden → VERIFIED sin conflicto', async () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    const a = nvidiaResult({ url: 'https://nvidia.com/news/earnings', text: 'released at 4:05 PM ET Aug 26, 2026' });
    const b = nvidiaResult({ url: 'https://reuters.com/article/nvda', text: 'results published 4:05 PM ET Aug 26, 2026' });
    const v = await verifyEvent(fakeExa([a, b]), info, { nowMs: NOW });
    expect(v.state).toBe('EVENT_VERIFIED');
    expect(v.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('19) dos fuentes con horarios distintos (sin explicación) → CONFLICTING', async () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    const a = nvidiaResult({ url: 'https://a.com/1', text: 'at 4:05 PM ET Aug 26, 2026' });
    const b = nvidiaResult({ url: 'https://b.com/2', text: 'at 5:30 PM ET Aug 26, 2026' });
    const v = await verifyEvent(fakeExa([a, b]), info, { nowMs: NOW });
    expect(v.state).toBe('EVENT_CONFLICTING_SOURCES');
  });

  it('20) fuente oficial prevalece sobre media con horario distinto', async () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    const oficial = nvidiaResult({ url: 'https://nvidia.com/news/earnings', text: 'released at 4:05 PM ET Aug 26, 2026' });
    const media = nvidiaResult({ url: 'https://x.com/post', text: 'earnings at 6:00 PM ET Aug 26, 2026' });
    const v = await verifyEvent(fakeExa([oficial, media]), info, { nowMs: NOW });
    expect(v.state).toBe('EVENT_VERIFIED');
    expect(v.eventTimeOriginal).toBe('16:05'); // prevalece la oficial
  });

  it('21) earnings release ≠ conference call: horarios distintos NO son contradicción', async () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    const release = nvidiaResult({ url: 'https://nvidia.com/news/earnings', text: 'press release published at 4:05 PM ET Aug 26, 2026' });
    const call = nvidiaResult({ url: 'https://nvidia.com/news/call', text: 'conference call at 5:30 PM ET Aug 26, 2026' });
    const v = await verifyEvent(fakeExa([release, call]), info, { nowMs: NOW });
    expect(v.state).toBe('EVENT_VERIFIED'); // no conflicto
    const subs = v.sources.map((s) => s.subEvent).filter(Boolean);
    expect(subs).toContain('release');
    expect(subs).toContain('call');
  });
});

describe('verifyEvent — afirmación del usuario (casos 33-40)', () => {
  it('33) hora Argentina del usuario correcta → time_claim_matches=true', async () => {
    const info = extractEventInfo('Nvidia presenta hoy a las 17 y quiero ver BTC', NOW);
    // 4:05 PM ET (verano) = 17:05 ART → el usuario dijo 17:00 → ±30min → true
    const v = await verifyEvent(fakeExa([nvidiaResult({ text: 'released at 4:05 PM ET Aug 26, 2026' })]), info, { nowMs: NOW });
    expect(v.timeClaimMatches).toBe(true);
  });

  it('34) hora Argentina del usuario incorrecta → false', async () => {
    const info = extractEventInfo('Nvidia presenta hoy a las 11', NOW);
    const v = await verifyEvent(fakeExa([nvidiaResult({ text: 'released at 4:05 PM ET Aug 26, 2026' })]), info, { nowMs: NOW });
    expect(v.timeClaimMatches).toBe(false);
  });

  it('35) hora ET del usuario correcta (4 PM ET ≈ 17 ART) → true', async () => {
    const info = extractEventInfo('Nvidia presenta a las 4 PM ET', NOW);
    const v = await verifyEvent(fakeExa([nvidiaResult({ text: 'released at 4:05 PM ET Aug 26, 2026' })]), info, { nowMs: NOW });
    expect(v.timeClaimMatches).toBe(true);
  });

  it('36) usuario da hora para el call y solo el release está verificado → se compara contra el release (boolean, no null)', async () => {
    const info = extractEventInfo('Nvidia presenta resultados; la conference call es a las 17', NOW);
    const v = await verifyEvent(fakeExa([nvidiaResult({ text: 'press release with earnings results at 4:05 PM ET Aug 26, 2026' })]), info, { nowMs: NOW });
    expect(v.state).toBe('EVENT_VERIFIED'); // el release sí está verificado
    // Solo el release está verificado (16:05 ET = 17:05 ART); la hora dicha (17:00 ART)
    // cae dentro de ±30 min → true. Con timing verificado, timeClaimMatches NUNCA es null.
    expect(v.timeClaimMatches).toBe(true);
  });

  it('36b) sub-evento: usuario cita el call y ambos están verificados → se compara contra el CALL (no el release)', async () => {
    const info = extractEventInfo('Nvidia presenta resultados; la conference call es a las 18:30', NOW);
    const v = await verifyEvent(
      fakeExa([
        nvidiaResult({ url: 'https://nvidia.com/news/earnings', text: 'press release at 4:05 PM ET Aug 26, 2026' }),
        nvidiaResult({ url: 'https://nvidia.com/news/call', text: 'conference call at 5:30 PM ET Aug 26, 2026' }),
      ]),
      info,
      { nowMs: NOW },
    );
    expect(v.state).toBe('EVENT_VERIFIED');
    // call 17:30 ET = 18:30 ART → coincide con lo dicho (18:30 ART) → true.
    // Sin la selección por sub-evento, se compararía contra el release (17:05 ART) → false.
    expect(v.timeClaimMatches).toBe(true);
  });

  it('37) usuario dice "hoy" pero el evento es mañana → date_claim_matches=false', async () => {
    const info = extractEventInfo('hoy presenta Nvidia', NOW);
    const v = await verifyEvent(fakeExa([nvidiaResult({ text: 'results on Aug 27, 2026' })]), info, { nowMs: NOW });
    expect(v.dateClaimMatches).toBe(false);
  });

  it('38) usuario dice "mañana" y el evento es mañana → true', async () => {
    const info = extractEventInfo('mañana presenta Nvidia', NOW);
    const v = await verifyEvent(fakeExa([nvidiaResult({ text: 'results on Aug 27, 2026' })]), info, { nowMs: NOW });
    expect(v.dateClaimMatches).toBe(true);
  });

  it('39) usuario afirma evento inexistente → no se confirma (UNVERIFIED)', async () => {
    const info = extractEventInfo('hoy presenta KumpaCrypto sus resultados', NOW);
    const v = await verifyEvent(
      fakeExa([{ title: 'RSI analysis', url: 'https://x.com/1', text: 'random technical stuff' }]),
      info,
      { nowMs: NOW },
    );
    expect(v.state).toBe('EVENT_UNVERIFIED');
  });

  it('40) usuario da hora pero la fuente solo confirma fecha → time_claim_matches=null', async () => {
    const info = extractEventInfo('Nvidia presenta a las 15', NOW);
    const v = await verifyEvent(fakeExa([nvidiaResult({ text: 'NVIDIA reported results on Aug 26, 2026' })]), info, { nowMs: NOW });
    expect(v.state).toBe('EVENT_PARTIALLY_VERIFIED');
    expect(v.timingVerified).toBe(false);
    expect(v.timeClaimMatches).toBeNull();
  });
});

describe('verifyEvent — query construida (no genérica)', () => {
  it('earnings → entidad + earnings + fecha', () => {
    const info = extractEventInfo('hoy presenta Nvidia resultados', NOW);
    expect(buildEventSearchQuery(info, NOW)).toBe('Nvidia earnings results 2026-08-26');
  });
  it('FOMC → query de decisión con fecha del período actual', () => {
    const info = extractEventInfo('¿cómo ves BTC antes del FOMC?', NOW);
    expect(buildEventSearchQuery(info, NOW)).toBe('FOMC decision 2026-08-26');
  });
});

describe('verifyEvent — estado temporal (casos 41-46)', () => {
  const ev = (text: string) => extractEventInfo(text, NOW);

  it('41) evento futuro → UPCOMING con countdown', async () => {
    const info = ev('mañana hay FOMC a las 14:00 ET');
    const v = await verifyEvent(
      fakeExa([{ title: 'FOMC', url: 'https://federalreserve.gov/monetarypolicy', text: 'FOMC decision Aug 27, 2026 at 2:00 PM ET' }]),
      info,
      { nowMs: NOW },
    );
    expect(v.eventStatus).toBe('UPCOMING');
    expect(v.countdownMs).not.toBeNull();
    expect(v.countdownMs).toBeGreaterThan(0);
  });

  it('42) evento pasado → ALREADY_HAPPENED', async () => {
    const info = ev('ayer hubo FOMC');
    const v = await verifyEvent(
      fakeExa([{ title: 'FOMC', url: 'https://federalreserve.gov/monetarypolicy', text: 'FOMC decision Aug 25, 2026 at 2:00 PM ET' }]),
      info,
      { nowMs: NOW },
    );
    expect(v.eventStatus).toBe('ALREADY_HAPPENED');
  });

  it('43) evento dentro de la ventana → HAPPENING_NOW', async () => {
    const info = ev('hay FOMC ahora');
    const v = await verifyEvent(
      fakeExa([{ title: 'FOMC', url: 'https://federalreserve.gov/monetarypolicy', text: 'FOMC decision Aug 26, 2026 at 2:20 PM ET' }]),
      info,
      { nowMs: NOW },
    );
    expect(v.eventStatus).toBe('HAPPENING_NOW'); // 14:20 ET = 18:20 UTC, now 18:00Z → dentro de 30min
  });

  it('44) fecha conocida / hora desconocida → DATE_KNOWN_TIME_UNKNOWN', async () => {
    const info = ev('hay FOMC mañana');
    const v = await verifyEvent(
      fakeExa([{ title: 'FOMC', url: 'https://federalreserve.gov/monetarypolicy', text: 'FOMC decision scheduled Aug 27, 2026' }]),
      info,
      { nowMs: NOW },
    );
    expect(v.eventStatus).toBe('DATE_KNOWN_TIME_UNKNOWN');
    expect(v.timingVerified).toBe(false);
  });

  it('45) countdown calculado programáticamente', async () => {
    const info = ev('mañana hay FOMC a las 14:00 ET');
    const v = await verifyEvent(
      fakeExa([{ title: 'FOMC', url: 'https://federalreserve.gov/monetarypolicy', text: 'FOMC decision Aug 27, 2026 at 2:00 PM ET' }]),
      info,
      { nowMs: NOW },
    );
    const expected = Date.parse('2026-08-27T18:00:00Z') - NOW; // 14:00 EDT = 18:00Z
    expect(v.countdownMs).toBeCloseTo(expected, -4);
  });

  it('46) sin timestamp verificado → nunca calcula countdown', async () => {
    const info = ev('hay FOMC mañana');
    const v = await verifyEvent(
      fakeExa([{ title: 'FOMC', url: 'https://federalreserve.gov/monetarypolicy', text: 'FOMC scheduled next week' }]),
      info,
      { nowMs: NOW },
    );
    expect(v.countdownMs).toBeNull();
  });
});
