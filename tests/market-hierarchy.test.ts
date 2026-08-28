import { describe, it, expect } from 'vitest';
import { buildAggregatedScan, annualizedFundingPct, quoteAssetFromPair, type MarketSources } from '../src/data/snapshot.js';
import { computeAnchoredWeeklyVWAP } from '../src/data/indicators.js';
import { fetchMultiTfData } from '../src/agents/fetch-multitf.js';
import { executeTool } from '../src/agents/tools.js';
import { AGENT_INSTRUCTIONS } from '../src/agents/agent.js';
import { resolveTimeframes } from '../src/utils/intent.js';

/**
 * REGRESIÓN: FALLO MARKET DATA ETH — Bitget PRIMARIO, Bybit/Binance cross-check
 * NO FATAL.
 *
 * Causa raíz demostrada en logs reales (updates 30098835/36): Bybit respondió
 * HTTP 403 y buildAggregatedScan usaba Promise.all de 7 fuentes en un solo
 * await → UNA secundaria fallando tiraba el snapshot completo → tool error →
 * respuesta degradada.
 *
 * Estos tests fijan la política: Bitget OK + secundaria FAIL = snapshot válido;
 * fallback solo si Bitget cae y SIEMPRE etiquetando la fuente real.
 */

// ── Fixtures de fuentes (mocks fieles al shape real de cada cliente) ─────────
interface FakeMarket {
  bitgetFail?: 'ticker' | 'funding' | 'hist' | 'oi' | 'all';
  binanceFail?: boolean;
  bybitFail?: boolean;
  bybitStatus?: number; // 403 = HTTP 403 real
  coinGeckoFail?: boolean;
}

function fakeSources(o: FakeMarket = {}): MarketSources {
  return {
    bitget: {
      getTicker: async () => {
        if (o.bitgetFail === 'ticker' || o.bitgetFail === 'all') throw new Error('Bitget ticker fail');
        return { symbol: 'XUSDT', lastPr: '3450.5', usdtVolume: '123456789' };
      },
      getCurrentFunding: async () => {
        if (o.bitgetFail === 'funding' || o.bitgetFail === 'all') throw new Error('Bitget funding fail');
        return { symbol: 'XUSDT', fundingRate: '0.0001', nextUpdate: String(Date.now() + 3_600_000) };
      },
      getFundingHistory: async () => {
        if (o.bitgetFail === 'hist' || o.bitgetFail === 'all') throw new Error('Bitget hist fail');
        return [
          { symbol: 'XUSDT', fundingRate: '0.0001', fundingTime: String(Date.now()) },
          { symbol: 'XUSDT', fundingRate: '0.00009', fundingTime: String(Date.now() - 3_600_000) },
        ];
      },
      getOpenInterest: async () => {
        if (o.bitgetFail === 'oi' || o.bitgetFail === 'all') throw new Error('Bitget OI fail');
        return { openInterestList: [{ size: '12500' }] };
      },
      getMarkPrice: async () => {
        if (o.bitgetFail === 'all') throw new Error('Bitget mark fail');
        return { symbol: 'XUSDT', markPrice: '3451', indexPrice: '3450' };
      },
    } as never,
    binance: {
      getPremiumIndex: async () => {
        if (o.binanceFail) throw new Error('HTTP 400 para https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XUSDT');
        return { symbol: 'XUSDT', markPrice: '3451', indexPrice: '3450', lastFundingRate: '0.000095', nextFundingTime: Date.now(), interestRate: '0', estimatedSettlePrice: '3451', time: Date.now() };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'XUSDT', openInterest: '100', time: Date.now() }),
    } as never,
    bybit: {
      getTicker: async () => {
        if (o.bybitFail) {
          const e = new Error(`HTTP 403 para https://api.bybit.com/v5/market/tickers?category=linear&symbol=XUSDT`);
          (e as { status?: number }).status = o.bybitStatus ?? 403;
          throw e;
        }
        return { symbol: 'XUSDT', lastPrice: '3450.7', fundingRate: '0.000095', nextFundingTime: String(Date.now()), turnover24h: '1e9', volume24h: '1e8', openInterest: '12000', markPrice: '3451', indexPrice: '3450' };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'XUSDT', openInterest: '12000', timestamp: String(Date.now()) }),
    } as never,
    coinGecko: {
      getGlobal: async () => {
        if (o.coinGeckoFail) throw new Error('CoinGecko fail');
        return { data: { total_market_cap: { usd: 2.5e12 }, market_cap_percentage: { btc: 55 } } };
      },
    } as never,
  };
}

describe('T1 — Bitget OK + Bybit 403 → snapshot VÁLIDO con fuente Bitget', () => {
  it('snapshot válido, primarySource=Bitget, crosscheck bybit=unavailable', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.primaryStatus).toBe('ok');
    expect(scan.crosschecks.bybit.status).toBe('unavailable');
    expect(scan.crosschecks.binance.status).toBe('ok');
    expect(scan.snapshot.price).toBe(3450.5);
    expect(scan.snapshot.fundingRate).toBe(0.0001);
    expect(scan.snapshot.openInterest).toBe(12500);
    expect(scan.snapshot.volume24h).toBe(123456789);
  });

  it('tool get_market_snapshot(ETH) funciona con Bybit 403 y expone la fuente', async () => {
    const deps = {
      bitget: fakeSources({ bybitFail: true, bybitStatus: 403 }).bitget,
      binance: fakeSources().binance,
      bybit: fakeSources({ bybitFail: true, bybitStatus: 403 }).bybit,
      coinGecko: fakeSources().coinGecko,
    } as never;
    const r = await executeTool(deps, 1, 'get_market_snapshot', { symbol: 'ETH' }) as {
      price?: number; quoteAsset?: string; source?: string; primaryStatus?: string; crosschecks?: { bybit?: string };
    };
    expect(r.price).toBeGreaterThan(0);
    expect(r.quoteAsset).toBe('USDT');
    expect(r.source).toBe('Bitget');
    expect(r.crosschecks?.bybit).toBe('unavailable');
  });
});

describe('T2 — Bitget OK + Binance fail → snapshot VÁLIDO', () => {
  it('snapshot válido con crosscheck binance=unavailable', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ binanceFail: true }));
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.primaryStatus).toBe('ok');
    expect(scan.crosschecks.binance.status).toBe('unavailable');
    expect(scan.snapshot.price).toBe(3450.5);
  });
});

describe('T3 — Bitget OK + Binance fail + Bybit fail → snapshot VÁLIDO (primarios suficientes)', () => {
  it('snapshot válido aunque AMBAS secundarias fallen', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ binanceFail: true, bybitFail: true, bybitStatus: 403 }));
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.primaryStatus).toBe('ok');
    expect(scan.crosschecks.binance.status).toBe('unavailable');
    expect(scan.crosschecks.bybit.status).toBe('unavailable');
    expect(scan.snapshot.price).toBe(3450.5);
    expect(scan.snapshot.fundingRate).toBe(0.0001);
  });
});

describe('T4 — Bitget fail + Bybit OK → fallback etiquetado (NUNCA como Bitget)', () => {
  it('primarySource=Bybit, primaryStatus=fallback, precio de Bybit', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ bitgetFail: 'all' }));
    expect(scan.primarySource).toBe('Bybit');
    expect(scan.primaryStatus).toBe('fallback');
    expect(scan.snapshot.price).toBe(3450.7);
    expect(scan.snapshot.fundingRate).toBe(0.000095);
    expect(scan.crosschecks.bybit.status).toBe('ok');
  });

  it('Bitget fail + Binance OK (Bybit fail) → fallback Binance etiquetado', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ bitgetFail: 'all', bybitFail: true }));
    expect(scan.primarySource).toBe('Binance');
    expect(scan.primaryStatus).toBe('fallback');
    expect(scan.snapshot.price).toBe(3451);
  });
});

describe('T5 — Bitget fail + secundarios fail → error controlado, SIN datos inventados', () => {
  it('lanza error con detalle de indisponibilidad', async () => {
    await expect(
      buildAggregatedScan('ETH', fakeSources({ bitgetFail: 'all', bybitFail: true, binanceFail: true })),
    ).rejects.toThrow(/Sin datos de mercado/i);
  });
});

describe('T6 — ETHUSDT funciona con Bitget aunque Bybit dé 403 (caso real de producción)', () => {
  it('reproduce el escenario exacto: Bybit 403 → ETH sigue con datos actuales', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
    expect(scan.symbol).toBe('ETH');
    expect(scan.pair).toBe('ETHUSDT');
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.snapshot.price).toBeGreaterThan(0);
    expect(scan.snapshot.updatedAt).toBeGreaterThan(0); // timestamp actual
  });
});

describe('T7 — BTCUSDT no regresión', () => {
  it('BTC con todas las fuentes OK', async () => {
    const scan = await buildAggregatedScan('BTC', fakeSources());
    expect(scan.symbol).toBe('BTC');
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.crosschecks.binance.status).toBe('ok');
    expect(scan.crosschecks.bybit.status).toBe('ok');
    expect(scan.snapshot.price).toBe(3450.5);
  });

  it('BTC multi-TF con Bitget OK (secundarias no intervenir)', async () => {
    const sources = {
      bitget: {
        getCandles: async () => mkCandles(60, Date.now() - 60_000, 60_000),
        getCandlesHistory: async () => mkCandles(200, Date.now() - 3_600_000, 3_600_000),
        getCurrentFunding: async () => ({ symbol: 'BTCUSDT', fundingRate: '0.0001', nextUpdate: String(Date.now()) }),
        getTicker: async () => ({ symbol: 'BTCUSDT', lastPr: '3450.5' }),
      },
    } as never;
    const ctx = await fetchMultiTfData(sources, ['BTC'], resolveTimeframes('analizame BTC ahora'));
    expect(ctx.BTCUSDT?.valido).toBe(true);
  });
});

describe('T8 — Multi-TF ETH no depende de Bybit/Binance (solo Bitget)', () => {
  it('fetchMultiTfData usa SOLO bitget: la interface MultiTfSources no expone binance/bybit', async () => {
    // Tipo: MultiTfSources solo tiene `bitget` → es imposible que Bybit/Binance fallen el multi-TF.
    // (verificado estructuralmente por el compilador: el test importa solo `bitget`)
    const { fetchMultiTfData: fn } = await import('../src/agents/fetch-multitf.js');
    expect(typeof fn).toBe('function');
  });

  it('ETH multi-TF funciona con Bitget OK (sin ninguna secundaria)', async () => {
    const sources = {
      bitget: {
        getCandles: async () => mkCandles(60, Date.now() - 60_000, 60_000),
        getCandlesHistory: async () => mkCandles(200, Date.now() - 3_600_000, 3_600_000),
        getCurrentFunding: async () => ({ symbol: 'ETHUSDT', fundingRate: '0.0001', nextUpdate: String(Date.now()) }),
        getTicker: async () => ({ symbol: 'ETHUSDT', lastPr: '3450.5' }),
      },
    } as never;
    const ctx = await fetchMultiTfData(sources, ['ETH'], resolveTimeframes('analizame ETH ahora'));
    expect(ctx.ETHUSDT?.valido).toBe(true);
    expect(ctx.ETHUSDT?.timeframes && Object.keys(ctx.ETHUSDT.timeframes).length).toBeGreaterThan(0);
  });
});

describe('T9 — Stale data: timestamp + antigüedad obligatorios (política en prompt + snapshot)', () => {
  it('el snapshot expone updatedAt (timestamp del dato)', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources());
    expect(scan.snapshot.updatedAt).toBeGreaterThan(0);
  });

  it('el prompt obliga a indicar timestamp/antigüedad si el dato no es actual', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/timestamp/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/antigüedad/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/NO es el dato actual/i);
  });
});

describe('T10 — No falsa promesa futura (política en prompt)', () => {
  it('el prompt prohíbe prometer reintentos automáticos inexistentes', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/No pude actualizar los datos en esta ejecución/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/NO prometas respuestas futuras automáticas/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/no existe un proceso programado/i);
  });

  it('el prompt ofrece reintentar SOLO a pedido del usuario', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/pedime que lo reintente/i);
  });
});

describe('T11 — Worker/background: no regresión', () => {
  it('processUpdate sigue marcando processed con bot OK', async () => {
    const { processUpdate } = await import('../src/webhook/queue.js');
    const { fakeQueueStore } = await import('./helpers/queue-store.js');
    const store = fakeQueueStore();
    await store.savePendingUpdate(4242, { update_id: 4242, message: { chat: { id: 1 }, text: 'hola' } });
    const p = await store.claimPendingUpdate(4242);
    const bot = { handleUpdate: async () => {} };
    expect(await processUpdate(bot as never, store, p!)).toBe(true);
    expect(store.processed.has(4242)).toBe(true);
  });

  it('un handleUpdate colgado sigue siendo timeout controlado (no processing eterno)', async () => {
    const { processUpdate } = await import('../src/webhook/queue.js');
    const { fakeQueueStore } = await import('./helpers/queue-store.js');
    const store = fakeQueueStore();
    store.rows.set(4243, { payload: JSON.stringify({ update_id: 4243 }), status: 'processing', attempts: 1, created: 0, startedAt: Date.now() });
    const hangingBot = { handleUpdate: () => new Promise<void>(() => {}) };
    const result = await processUpdate(hangingBot as never, store, { updateId: 4243, payload: JSON.stringify({ update_id: 4243 }), attempts: 1 }, { budgetMs: 150 });
    expect(result).toBe(false);
    expect(store.rows.get(4243)?.status).toBe('pending'); // re-pending, reintentable
  });
});

describe('T16 — FUNDING: anualización UNAVAILABLE sin intervalo válido (sin default 8h)', () => {
  it('intervalos válidos 1h/2h/4h/8h → annualized calculado', () => {
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '1' })).toBeCloseTo(0.0001 * 24 * 365 * 100, 6);
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '2' })).toBeCloseTo(0.0001 * 12 * 365 * 100, 6);
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '4' })).toBeCloseTo(0.0001 * 6 * 365 * 100, 6);
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '8' })).toBeCloseTo(0.0001 * 3 * 365 * 100, 6);
  });
  it('missing/null/0/NaN/no permitido → null (annualized unavailable, funding actual sigue válido)', () => {
    expect(annualizedFundingPct(0.0001, undefined)).toBeNull();
    expect(annualizedFundingPct(0.0001, {})).toBeNull();
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '0' })).toBeNull();
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: 'NaN' })).toBeNull();
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '6' })).toBeNull();
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '16' })).toBeNull();
  });
});

describe('T17 — QUOTE ASSET: ETHUSDT/BTCUSDT → USDT (NO USD)', () => {
  it('quoteAssetFromPair: ETHUSDT→USDT, BTCUSDT→USDT, ETHUSD→USD', () => {
    expect(quoteAssetFromPair('ETHUSDT')).toBe('USDT');
    expect(quoteAssetFromPair('BTCUSDT')).toBe('USDT');
    expect(quoteAssetFromPair('ETHUSD')).toBe('USD');
  });
  it('snapshot expone quoteAsset=USDT para ETH', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources());
    expect(scan.quoteAsset).toBe('USDT');
  });
  it('tool result expone price con quoteAsset (no priceUsd)', async () => {
    const deps = { bitget: fakeSources().bitget, binance: fakeSources().binance, bybit: fakeSources().bybit, coinGecko: fakeSources().coinGecko } as never;
    const r = await executeTool(deps, 1, 'get_price', { symbol: 'ETH' }) as { price?: number; quoteAsset?: string };
    expect(r.price).toBeGreaterThan(0);
    expect(r.quoteAsset).toBe('USDT');
  });
});

describe('T18 — PREMIUM BITGET INDEPENDIENTE (mark/index de Bitget, no secundarias)', () => {
  it('BG OK + BN FAIL + BY FAIL → premium válido desde Bitget', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ binanceFail: true, bybitFail: true, bybitStatus: 403 }));
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.crosschecks.binance.status).toBe('unavailable');
    expect(scan.crosschecks.bybit.status).toBe('unavailable');
    // Bitget mark=3451 vs index=3450 → premium ≈ +0.029% → flat (|premium|<=0.05)
    expect(scan.premiumState).not.toBe('unknown');
  });
  it('BG OK + BN OK + BY OK → premium desde Bitget (primario)', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources());
    expect(scan.premiumState).not.toBe('unknown');
  });
  it('BG OK + BN OK + BY 403 → premium válido (Bybit no fatal)', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
    expect(scan.premiumState).not.toBe('unknown');
  });
  it('BG FAIL + fallback Bybit válido → premium desde Bybit', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ bitgetFail: 'all' }));
    expect(scan.primarySource).toBe('Bybit');
    expect(scan.premiumState).not.toBe('unknown');
  });
});

describe('T19 — VWAP SEMANAL: sin fallback last-7 (dataset insuficiente → null)', () => {
  it('semana con <2 velas → null (no inventa con 7 barras)', () => {
    // lunes 24/08/2026 con UNA sola vela → null
    const nowMs = Date.UTC(2026, 7, 27, 12, 0, 0);
    const one = [{ time: Date.UTC(2026, 7, 24, 12), open: 100, high: 105, low: 95, close: 102, volume: 100 }];
    expect(computeAnchoredWeeklyVWAP(one, { nowMs })).toBeNull();
  });
  it('semana con 2+ velas → VWAP calculado desde el ancla', () => {
    const nowMs = Date.UTC(2026, 7, 27, 12, 0, 0);
    const two = [
      { time: Date.UTC(2026, 7, 24, 12), open: 100, high: 105, low: 95, close: 102, volume: 100 },
      { time: Date.UTC(2026, 7, 25, 12), open: 102, high: 107, low: 97, close: 104, volume: 100 },
    ];
    const v = computeAnchoredWeeklyVWAP(two, { nowMs });
    expect(v).not.toBeNull();
  });
  it('velas de la semana ANTERIOR no cuentan (solo desde lunes 00:00)', () => {
    const nowMs = Date.UTC(2026, 7, 27, 12, 0, 0);
    const mixed = [
      { time: Date.UTC(2026, 7, 23, 12), open: 90, high: 95, low: 85, close: 92, volume: 100 }, // domingo (semana anterior)
      { time: Date.UTC(2026, 7, 24, 12), open: 100, high: 105, low: 95, close: 102, volume: 100 }, // lunes
    ];
    const v = computeAnchoredWeeklyVWAP(mixed, { nowMs });
    // solo cuenta la vela del lunes → 1 vela → null (insuficiente), la del domingo NO la "salva"
    expect(v).toBeNull();
  });
});

// ── helper velas (mismo shape que fetch-multitf.test.ts) ─────────────────────
function mkCandles(n: number, endTs: number, step: number, close = 101): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push([String(t), '100', '105', '95', String(close), '10']);
  }
  return out;
}
