import { describe, it, expect } from 'vitest';
import { ianaFromAbbrev, toArgentinaTime, tzOffsetMsAt } from '../src/events/timezone.js';

/**
 * Fechas fijas con DST de EE.UU. 2026:
 * - DST inicia: 8 de marzo de 2026, 02:00
 * - DST termina: 1 de noviembre de 2026, 02:00
 * - Argentina: UTC-3 todo el año.
 */
const WINTER = '2026-02-15'; // EST / PST (fuera de DST)
const SUMMER = '2026-07-15'; // EDT / PDT (dentro de DST)

describe('timezone — mapeo de abreviaturas', () => {
  it.each([
    ['ET', 'America/New_York'],
    ['EST', 'America/New_York'],
    ['EDT', 'America/New_York'],
    ['PT', 'America/Los_Angeles'],
    ['PST', 'America/Los_Angeles'],
    ['PDT', 'America/Los_Angeles'],
    ['UTC', 'UTC'],
    ['GMT', 'UTC'],
  ])('%s → %s', (abbrev, iana) => {
    expect(ianaFromAbbrev(abbrev)).toBe(iana);
  });

  it('timezone desconocida → null', () => {
    expect(ianaFromAbbrev('XYZ')).toBeNull();
  });
});

describe('toArgentinaTime — conversión con DST real (casos 22-30)', () => {
  it('22) ET invierno (EST, UTC-5): 14:00 → 16:00 Argentina', () => {
    const r = toArgentinaTime({ date: WINTER, hour: 14, minute: 0 }, 'ET');
    expect(r?.time).toBe('16:00');
    expect(r?.date).toBe(WINTER);
  });

  it('ET verano (EDT, UTC-4): 14:00 → 15:00 Argentina (DST!)', () => {
    const r = toArgentinaTime({ date: SUMMER, hour: 14, minute: 0 }, 'ET');
    expect(r?.time).toBe('15:00');
  });

  it('23) PT invierno (PST, UTC-8): 14:00 → 19:00 Argentina', () => {
    expect(toArgentinaTime({ date: WINTER, hour: 14, minute: 0 }, 'PT')?.time).toBe('19:00');
  });

  it('PT verano (PDT, UTC-7): 14:00 → 18:00 Argentina (DST!)', () => {
    expect(toArgentinaTime({ date: SUMMER, hour: 14, minute: 0 }, 'PT')?.time).toBe('18:00');
  });

  it('24) UTC: 14:00 → 11:00 Argentina', () => {
    expect(toArgentinaTime({ date: SUMMER, hour: 14, minute: 0 }, 'UTC')?.time).toBe('11:00');
    expect(toArgentinaTime({ date: WINTER, hour: 14, minute: 0 }, 'GMT')?.time).toBe('11:00');
  });

  it('25/26) la diferencia NO es constante: ET invierno −3h vs verano −2h respecto de Argentina', () => {
    const winter = toArgentinaTime({ date: WINTER, hour: 12, minute: 0 }, 'ET');
    const summer = toArgentinaTime({ date: SUMMER, hour: 12, minute: 0 }, 'ET');
    expect(winter?.time).toBe('14:00'); // 12:00 EST = 17:00 UTC → 14:00 ART
    expect(summer?.time).toBe('13:00'); // 12:00 EDT = 16:00 UTC → 13:00 ART
  });

  it('27) EST explícito (invierno)', () => {
    expect(toArgentinaTime({ date: WINTER, hour: 9, minute: 30 }, 'EST')?.time).toBe('11:30');
  });

  it('28) EDT explícito (verano)', () => {
    expect(toArgentinaTime({ date: SUMMER, hour: 9, minute: 30 }, 'EDT')?.time).toBe('10:30');
  });

  it('29) PST explícito (invierno)', () => {
    expect(toArgentinaTime({ date: WINTER, hour: 9, minute: 30 }, 'PST')?.time).toBe('14:30');
  });

  it('30) PDT explícito (verano)', () => {
    expect(toArgentinaTime({ date: SUMMER, hour: 9, minute: 30 }, 'PDT')?.time).toBe('13:30');
  });

  it('tzOffsetMsAt respeta DST según la fecha', () => {
    expect(tzOffsetMsAt('America/New_York', Date.parse(`${WINTER}T18:00:00Z`))).toBe(-5 * 3_600_000);
    expect(tzOffsetMsAt('America/New_York', Date.parse(`${SUMMER}T18:00:00Z`))).toBe(-4 * 3_600_000);
  });
});

describe('tiempos incompletos / desconocidos', () => {
  it('31) sin hora → null (nunca inventa la hora)', () => {
    expect(toArgentinaTime({ date: WINTER, hour: NaN, minute: NaN }, 'ET')).toBeNull();
  });

  it('32) timezone desconocida → null', () => {
    expect(toArgentinaTime({ date: WINTER, hour: 14, minute: 0 }, 'XYZ')).toBeNull();
  });
});
