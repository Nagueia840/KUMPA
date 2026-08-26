import { describe, it, expect } from 'vitest';
import { validateReply } from '../src/utils/validator.js';
import { buildEventClaims } from '../src/events/context.js';
import type { ClaimSet, MarketClaim } from '../src/agents/claims.js';
import type { EventVerification } from '../src/events/verify.js';

function claims(list: MarketClaim[]): ClaimSet {
  const bySymbol = new Map<string, MarketClaim[]>();
  for (const c of list) {
    const a = bySymbol.get(c.symbol) ?? [];
    a.push(c);
    bySymbol.set(c.symbol, a);
  }
  return { claims: list, bySymbol, isEmpty: list.length === 0 };
}

/** Claims de mercado (BTC) + claims de evento (NVIDIA con EPS y hora Argentina; GLOBAL con CPI). */
function fullClaims(): ClaimSet {
  return claims([
    { symbol: 'BTC', field: 'precio', value: 78429.7, source: 'ticker' },
    { symbol: 'BTC', timeframe: '1D', field: 'rsi', value: 78.5, source: 'calculado' },
    { symbol: 'NVIDIA', field: 'event:release', value: 2.13, source: 'event' }, // EPS
    { symbol: 'NVIDIA', field: 'event:source', value: 30.5, source: 'event' }, // revenue
    { symbol: 'NVIDIA', field: 'event:time_argentina_hour', value: 16, source: 'event' }, // 16:00 ART
    { symbol: 'GLOBAL', field: 'event:source', value: 0.2, source: 'event' }, // CPI 0.2%
  ]);
}

const valid = (text: string, set: ClaimSet = fullClaims()) => validateReply(text, set).valid;

describe('GUARD FASE D — números de evento (casos 47-58)', () => {
  it('47) EPS verificado permitido', () => {
    expect(valid('el EPS de Nvidia fue 2.13')).toBe(true);
  });

  it('48) EPS inventado bloqueado', () => {
    expect(valid('el EPS de Nvidia fue 9.99')).toBe(false);
  });

  it('49) CPI verificado permitido', () => {
    expect(valid('el CPI fue 0,2%')).toBe(true);
  });

  it('50) CPI inventado bloqueado', () => {
    expect(valid('el CPI fue 0,5%')).toBe(false);
  });

  it('51) hora verificada permitida', () => {
    expect(valid('el evento de Nvidia es a las 16')).toBe(true);
  });

  it('52) hora inventada bloqueada', () => {
    expect(valid('el evento de Nvidia es a las 9')).toBe(false);
  });

  it('53) la hora incorrecta del usuario NO se convierte en hecho (y corregirla no es alucinar)', () => {
    expect(valid('el evento de Nvidia es a las 17')).toBe(false); // 17 ≠ 16 verificado
    expect(valid('dijiste a las 17 pero la fuente indica 16')).toBe(true); // corrección
  });

  it('54) hipótesis explícita permitida', () => {
    expect(valid('supongamos que el CPI sale 0,5%')).toBe(true);
  });

  it('55) hipótesis reformulada como hecho → bloqueada', () => {
    expect(valid('el CPI fue 0,5%')).toBe(false);
  });

  it('56) claim de Nvidia no valida un número de BTC', () => {
    expect(valid('el precio de BTC es 2.13')).toBe(false);
  });

  it('57) claim de BTC no valida un dato macro', () => {
    expect(valid('el CPI fue 78.429')).toBe(false);
  });

  it('58) fuente no verificada no crea claims (UNVERIFIED → sin claims → bloqueado)', () => {
    const unverified = {} as EventVerification; // estado UNVERIFIED por defecto
    expect(buildEventClaims({ ...unverified, state: 'EVENT_UNVERIFIED' })).toEqual([]);
    const soloBtc = claims(fullClaims().claims.filter((c) => c.symbol !== 'NVIDIA' && c.symbol !== 'GLOBAL'));
    expect(valid('el EPS de Nvidia fue 2.13', soloBtc)).toBe(false);
  });

  it('un claim de evento NO valida un indicador de mercado (separación semántica)', () => {
    expect(valid('el RSI diario de BTC es 2.13')).toBe(false);
  });
});
