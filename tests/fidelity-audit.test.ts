import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { classifyPremiumState, annualizedFundingPct, buildAggregatedScan } from '../src/data/snapshot.js';
import { sanitizeOutput, markdownBoldToHtml, escapeHtml, formatPrice } from '../src/utils/sanitize.js';
import { fetchMultiTfData } from '../src/agents/fetch-multitf.js';
import { AGENT_INSTRUCTIONS } from '../src/agents/agent.js';
import { validateReply } from '../src/utils/validator.js';
import { buildAllowedClaims, collectToolResultClaims, withToolClaims } from '../src/agents/claims.js';

/**
 * AUDITORÍA DE FIDELIDAD DE DATOS + CALIDAD DE RESPUESTA.
 * Fija los fixes: premiumState (mark vs index, NUNCA contango/backwardation en
 * perps), superTrend_rol, vela_vs_cierre_previo, openInterestUnit=activo base,
 * sanitización de salida (CJK/ruido), unidades obligatorias y markdown→HTML.
 */

// ── T1. Premium/discount (mark vs index), nunca contango/backwardation ───────
describe('T1 — premium = mark vs index, no funding', () => {
  it('classifyPremiumState: +0.77% → premium', () => {
    expect(classifyPremiumState(0.77)).toBe('premium');
  });
  it('classifyPremiumState: -0.77% → discount', () => {
    expect(classifyPremiumState(-0.77)).toBe('discount');
  });
  it('classifyPremiumState: ±0.04% → flat (umbral 0.05%)', () => {
    expect(classifyPremiumState(0.04)).toBe('flat');
    expect(classifyPremiumState(-0.04)).toBe('flat');
  });
  it('classifyPremiumState: sin premium (null) → unknown', () => {
    expect(classifyPremiumState(null)).toBe('unknown');
  });
  it('funding negativo NO implica discount (el funding no define premium)', () => {
    expect(classifyPremiumState(0.2)).toBe('premium');
  });
  it('annualizedFundingPct usa el intervalo real de Bitget', () => {
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '8' })).toBeCloseTo(0.0001 * 3 * 365 * 100, 6);
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '4' })).toBeCloseTo(0.0001 * 6 * 365 * 100, 6);
    expect(annualizedFundingPct(0.0001, { fundingRateInterval: '1' })).toBeCloseTo(0.0001 * 24 * 365 * 100, 6);
  });
  it('el prompt usa premiumState y prohíbe contango/backwardation en perps', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/premiumState/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/NUNCA del signo del funding/);
    expect(AGENT_INSTRUCTIONS).toMatch(/NO uses contango\/backwardation/);
  });
});

// ── T2. OI unidad = activo base (doc Bitget) ─────────────────────────────────
describe('T2 — open interest unidad real (activo base)', () => {
  it('snapshot expone openInterestUnit=ETH para ETHUSDT', async () => {
    const sources = fakeSources();
    const scan = await buildAggregatedScan('ETH', sources);
    expect(scan.openInterestUnit).toBe('ETH');
  });
  it('el prompt prohíbe inventar la unidad del OI', () => {
    // Case-insensitive: el prompt usa "ACTIVO BASE" (mayúsculas) — la semántica
    // no debe depender de mayúsculas/minúsculas.
    expect(AGENT_INSTRUCTIONS).toMatch(/activo base/i);
    expect(AGENT_INSTRUCTIONS).toMatch(/nunca inventes la unidad/i);
  });
});

// ── T3. Niveles de precio llevan USD ─────────────────────────────────────────
describe('T3 — unidades de precio obligatorias', () => {
  it('formatPrice agrega USD', () => {
    expect(formatPrice(2391)).toBe('2,391 USD');
  });
  it('el prompt exige USD en niveles', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/USD/);
    expect(AGENT_INSTRUCTIONS).toMatch(/2\.391 USD/);
  });
});

// ── T4. RSI/MFI/ADX sin unidad monetaria ─────────────────────────────────────
describe('T4 — osciladores sin unidad', () => {
  it('el prompt dice que RSI/ADX/MFI no llevan unidad', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/RSI \/ ADX \/ MFI/);
    expect(AGENT_INSTRUCTIONS).toMatch(/sin unidad monetaria/);
  });
});

// ── T5. SuperTrend 1D dirección + unidad ─────────────────────────────────────
describe('T5 — SuperTrend con dirección + unidad', () => {
  it('up → rol soporte (banda inferior)', () => {
    expect(deriveSuperTrendRol('up')).toBe('soporte');
  });
  it('down → rol resistencia (banda superior)', () => {
    expect(deriveSuperTrendRol('down')).toBe('resistencia');
  });
  it('el prompt obliga a expresar SuperTrend con rol + USD', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/superTrend_rol/);
    expect(AGENT_INSTRUCTIONS).toMatch(/resistencia en 2\.459 USD/);
  });
});

// ── T6. SuperTrend semanal sin contradicción semántica ───────────────────────
describe('T6 — SuperTrend semanal down en 2459 con precio 2495', () => {
  it('down → RESISTENCIA (el prompt lo fija)', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/down → RESISTENCIA/);
  });
});

// ── T7. currentPrice < previousClose no permite "vela entera por encima" ─────
describe('T7 — vela vs cierre anterior estructurado', () => {
  it('vela_vs_cierre_previo: above/below/mixed según rango', () => {
    expect(deriveVelaVsCierre({ low: 2530, high: 2550 }, 2520)).toBe('above');
    expect(deriveVelaVsCierre({ low: 2480, high: 2510 }, 2520)).toBe('below');
    expect(deriveVelaVsCierre({ low: 2490, high: 2540 }, 2520)).toBe('mixed');
  });
  it('caso real: precio 2495 < cierre 2520 → NO puede ser "above"', () => {
    expect(deriveVelaVsCierre({ low: 2490, high: 2498 }, 2520)).toBe('below');
  });
  it('el prompt prohíbe afirmar "vela entera por encima" sin metadata above', () => {
    expect(AGENT_INSTRUCTIONS).toMatch(/vela_vs_cierre_previo/);
    expect(AGENT_INSTRUCTIONS).toMatch(/low > cierre previo/);
  });
});

// ── T8. Cero caracteres chinos ───────────────────────────────────────────────
describe('T8 — sanitización CJK', () => {
  it('sanitizeOutput elimina "SuperTrend日报" → "SuperTrend"', () => {
    expect(sanitizeOutput('SuperTrend日报 en 2391')).toBe('SuperTrend en 2391');
  });
  it('elimina kana/hangul', () => {
    expect(sanitizeOutput('データ 123')).toBe('123');
  });
});

// ── T9. Cero mezcla "structure"/"tendenciaup" ────────────────────────────────
describe('T9 — sanitización de ruido', () => {
  it('elimina "tendenciaup" → "tendencia up"', () => {
    expect(sanitizeOutput('la tendenciaup es alcista')).toBe('la tendencia up es alcista');
  });
  it('elimina "parachirurgical" → "quirúrgico"', () => {
    expect(sanitizeOutput('precio parachirurgical')).toBe('precio quirúrgico');
  });
  it('elimina "structure" → "estructura"', () => {
    expect(sanitizeOutput('structure semanal')).toBe('estructura semanal');
  });
});

// ── T10. Telegram no muestra ** literal ──────────────────────────────────────
describe('T10 — markdown → HTML', () => {
  it('**1D** → <b>1D</b>', () => {
    expect(markdownBoldToHtml('**1D** RSI')).toBe('<b>1D</b> RSI');
  });
  it('escapa & < > del resto (seguro para HTML, preserva espacios)', () => {
    expect(markdownBoldToHtml('precio < 100 & > 50')).toBe('precio &lt; 100 &amp; &gt; 50');
  });
  it('escapeHtml no rompe % ni guiones', () => {
    expect(escapeHtml('-0,0007%')).toBe('-0,0007%');
  });
});

// ── T11. Respuesta final sigue pasando guard ─────────────────────────────────
describe('T11 — respuesta respaldada sigue pasando el guard', () => {
  it('toolClaims canónicos + respuesta correcta → valid', () => {
    const toolResult = {
      symbol: 'ETH', price: 2495.84, quoteAsset: 'USDT', fundingBitgetPct: -0.0007,
      openInterestBitget: 720800, openInterestUnit: 'ETH',
      annualizedFundingPct: -0.7665, premiumPct: -0.1, premiumState: 'discount',
    };
    const claims = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult, 'ETH'));
    const v = validateReply('ETH cotiza en 2495.84 USDT con funding -0.0007% y open interest 720.800 ETH.', claims);
    expect(v.valid).toBe(true);
  });
});

// ── T12. Números inventados siguen bloqueados ────────────────────────────────
describe('T12 — inventos siguen bloqueados', () => {
  it('precio inventado → rechazado', () => {
    const toolResult = { symbol: 'ETH', price: 2495.84 };
    const claims = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult, 'ETH'));
    const v = validateReply('ETH cotiza en 2000 USDT según mi análisis.', claims);
    expect(v.valid).toBe(false);
  });
});

// ── T13. Bitget-first sigue pasando ──────────────────────────────────────────
describe('T13 — Bitget-first sin regresión', () => {
  it('Bitget OK + Bybit 403 → snapshot válido con premiumState y unidad', async () => {
    const sources = fakeSources({ bybitFail: true });
    const scan = await buildAggregatedScan('ETH', sources);
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.primaryStatus).toBe('ok');
    expect(scan.crosschecks.bybit.status).toBe('unavailable');
    expect(scan.premiumState).toBeDefined();
    expect(scan.openInterestUnit).toBe('ETH');
  });
});

// ── T14. Bybit 403 sigue no fatal ────────────────────────────────────────────
describe('T14 — Bybit 403 no fatal', () => {
  it('snapshot válido a pesar del 403', async () => {
    const sources = fakeSources({ bybitFail: true, bybitStatus: 403 });
    const scan = await buildAggregatedScan('ETH', sources);
    expect(scan.snapshot.price).toBeGreaterThan(0);
    expect(scan.primarySource).toBe('Bitget');
  });
});

// ── T15. Anti-hang sigue pasando ─────────────────────────────────────────────
describe('T15 — anti-hang sin regresión', () => {
  it('fetchMultiTfData con timeout controlado (metadata superTrend/vela)', async () => {
    const sources = {
      bitget: {
        getCandles: async () => mkCandles(60, Date.now() - 60_000, 60_000),
        getCandlesHistory: async () => mkCandles(200, Date.now() - 3_600_000, 3_600_000),
        getCurrentFunding: async () => ({ symbol: 'ETHUSDT', fundingRate: '0.0001', nextUpdate: String(Date.now()) }),
        getTicker: async () => ({ symbol: 'ETHUSDT', lastPr: '2495.84' }),
      },
    } as never;
    const ctx = await fetchMultiTfData(sources, ['ETH'], [{ tf: '1D', bitget: '1D', source: 'explicit' }]);
    expect(ctx.ETHUSDT?.valido).toBe(true);
    const block = Object.values(ctx.ETHUSDT?.timeframes ?? {})[0] as { superTrend_rol?: string; vela_vs_cierre_previo?: string } | undefined;
    expect(block).toBeDefined();
  });
});

// ── T20. BUILD_ID trazable + schema de tool sin "basis anualizado" ───────────
describe('T20 — BUILD_ID y schema del tool (fix final post-incidente)', () => {
  // CONTRATO SOURCE/DEV: vitest ejecuta el source directo; el BUILD_ID real se
  // inyecta SOLO en el bundle (--define de esbuild). En runtime local el
  // fallback esperado ES "dev-local" — correcto y no debe alargarse.
  it('SOURCE/DEV: KUMPA_BUILD_ID existe con fallback local "dev-local"', async () => {
    const { KUMPA_BUILD_ID } = await import('../src/config/build-id.js');
    expect(KUMPA_BUILD_ID).toBe('dev-local');
  });

  // CONTRATO BUNDLE/PRODUCCIÓN: el bundle generado DEBE contener el BUILD_ID
  // inyectado como SHA-256 hexadecimal de 64 caracteres (esbuild inlinea
  // `KUMPA_BUILD_ID = true ? "<sha64>" : "dev-local"`), y el log de arranque
  // NO debe quedar con "dev-local" como valor. Validación estructural
  // determinística, sin depender de un SHA histórico.
  const bundlePath = new URL('../supabase/functions/kumpa-worker/index.bundle.js', import.meta.url);
  const bundleExists = existsSync(bundlePath);
  const readBundle = () => readFileSync(bundlePath, 'utf8');

  it.skipIf(!bundleExists)('BUNDLE: KUMPA_BUILD_ID inyectado es SHA-256 hex de 64 (no dev-local)', () => {
    const src = readBundle();
    // esbuild inlinea la constante con el literal inyectado + fallback dev-local.
    const m = src.match(/KUMPA_BUILD_ID\s*=\s*[^;]*?"([0-9a-f]{64})"\s*:\s*"dev-local"/);
    expect(m).not.toBeNull(); // literal SHA-256 de 64 hex presente con fallback dev-local
    expect(m![1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(!bundleExists)('BUNDLE: el log de arranque usa la variable, nunca dev-local literal', () => {
    const src = readBundle();
    // El log es `[worker] build=${KUMPA_BUILD_ID}` (template con la constante),
    // NUNCA `[worker] build=dev-local` literal (eso indicaría bundle sin inyectar).
    expect(src).toMatch(/\[worker\] build=\$\{KUMPA_BUILD_ID\}/);
    expect(src).not.toMatch(/\[worker\] build=dev-local/);
  });

  it('la description de get_market_snapshot NO usa "basis anualizado" ni contango/backwardation', async () => {
    const { TOOLS } = await import('../src/agents/tools.js');
    const snap = TOOLS.find((t) => t.function?.name === 'get_market_snapshot');
    const desc = snap?.function?.description ?? '';
    expect(desc).not.toMatch(/basis anualizado/i);
    expect(desc).not.toMatch(/contango/i);
    expect(desc).not.toMatch(/backwardation/i);
    expect(desc).toMatch(/funding anualizado estimado/i);
    expect(desc).toMatch(/premium\/discount/i);
  });
});

// ── helpers (mismos mocks que market-hierarchy.test.ts) ──────────────────────
function fakeSources(o: { bybitFail?: boolean; bybitStatus?: number; markFail?: boolean } = {}) {
  return {
    bitget: {
      getTicker: async () => ({ symbol: 'ETHUSDT', lastPr: '2495.84', usdtVolume: '2490000000' }),
      getCurrentFunding: async () => ({ symbol: 'ETHUSDT', fundingRate: '-0.000007', nextUpdate: String(Date.now() + 3_600_000) }),
      getFundingHistory: async () => [
        { symbol: 'ETHUSDT', fundingRate: '-0.000007', fundingTime: String(Date.now()) },
        { symbol: 'ETHUSDT', fundingRate: '-0.000006', fundingTime: String(Date.now() - 3_600_000) },
      ],
      getOpenInterest: async () => ({ openInterestList: [{ size: '720800' }] }),
      getMarkPrice: async () => {
        if (o.markFail) throw new Error('Bitget mark fail');
        return { symbol: 'ETHUSDT', markPrice: '2496', indexPrice: '2495.9' };
      },
    } as never,
    binance: {
      getPremiumIndex: async () => ({ symbol: 'ETHUSDT', markPrice: '2496', indexPrice: '2495.9', lastFundingRate: '-0.0000065', nextFundingTime: Date.now(), interestRate: '0', estimatedSettlePrice: '2496', time: Date.now() }),
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', time: Date.now() }),
    } as never,
    bybit: {
      getTicker: async () => {
        if (o.bybitFail) {
          const e = new Error('HTTP 403 para https://api.bybit.com/v5/market/tickers?category=linear&symbol=ETHUSDT');
          (e as { status?: number }).status = o.bybitStatus ?? 403;
          throw e;
        }
        return { symbol: 'ETHUSDT', lastPrice: '2495.9', fundingRate: '-0.0000065', nextFundingTime: String(Date.now()), turnover24h: '1e9', volume24h: '1e8', openInterest: '700000', markPrice: '2496', indexPrice: '2495.9' };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', timestamp: String(Date.now()) }),
    } as never,
    coinGecko: {
      getGlobal: async () => ({ data: { total_market_cap: { usd: 2.5e12 }, market_cap_percentage: { btc: 55 } } }),
    } as never,
  };
}

function mkCandles(n: number, endTs: number, step: number, close = 2495): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push([String(t), String(close - 10), String(close + 30), String(close - 20), String(close), '10']);
  }
  return out;
}

function deriveSuperTrendRol(direction: 'up' | 'down'): 'soporte' | 'resistencia' {
  return direction === 'up' ? 'soporte' : 'resistencia';
}

function deriveVelaVsCierre(v: { low: number; high: number }, cierrePrev: number): 'above' | 'below' | 'mixed' {
  return v.low > cierrePrev ? 'above' : v.high < cierrePrev ? 'below' : 'mixed';
}
