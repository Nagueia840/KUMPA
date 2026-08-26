import { describe, it, expect } from 'vitest';
import { GUARD_REFUSAL_TEXT, guardedFinalize } from '../src/agents/guarded-reply.js';
import type { ClaimSet, MarketClaim } from '../src/agents/claims.js';

function claims(list: MarketClaim[]): ClaimSet {
  const bySymbol = new Map<string, MarketClaim[]>();
  for (const c of list) {
    const a = bySymbol.get(c.symbol) ?? [];
    a.push(c);
    bySymbol.set(c.symbol, a);
  }
  return { claims: list, bySymbol, isEmpty: list.length === 0 };
}

const btc = claims([{ symbol: 'BTC', field: 'precio', value: 78429.7, source: 'ticker' }]);

describe('guardedFinalize — retry y negativa segura', () => {
  it('texto válido → ok sin regenerar', async () => {
    let regeneraciones = 0;
    const r = await guardedFinalize('BTC está en 78.429', btc, async () => {
      regeneraciones++;
      return '';
    });
    expect(r.status).toBe('ok');
    expect(regeneraciones).toBe(0);
  });

  it('14) primera violación → máximo 1 regeneración; si la segunda es válida → ok', async () => {
    let regeneraciones = 0;
    const r = await guardedFinalize('BTC está en 500.000', btc, async () => {
      regeneraciones++;
      return 'BTC está en 78.429';
    });
    expect(regeneraciones).toBe(1);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.text).toContain('78.429');
  });

  it('15) segunda violación → negativa segura (no se envía la respuesta)', async () => {
    let regeneraciones = 0;
    const r = await guardedFinalize('BTC está en 500.000', btc, async () => {
      regeneraciones++;
      return 'BTC está en 600.000';
    });
    expect(regeneraciones).toBe(1); // solo 1 regeneración
    expect(r.status).toBe('refused');
    if (r.status === 'refused') expect(r.reason).toContain('sin respaldo');
  });

  it('la negativa segura es el texto exacto de GUARD_REFUSAL_TEXT', () => {
    expect(GUARD_REFUSAL_TEXT).toBe('No tengo datos verificados suficientes para darte ese valor con confianza.');
  });
});
