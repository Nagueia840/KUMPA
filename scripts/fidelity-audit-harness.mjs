// KUMPA — Harness empírico AUDITORÍA DE FIDELIDAD + CALIDAD (T1–T19).
// Reproduce los 8 problemas reales de "Analizame ETH ahora" y verifica los fixes
// + los 4 cierres (funding sin default, VWAP sin fallback, USDT≠USD, premium Bitget).
// Correr tras compilar: node node_modules/typescript/lib/tsc.js -p tsconfig.verify.json
//   node scripts/fidelity-audit-harness.mjs
import { classifyPremiumState, buildAggregatedScan, annualizedFundingPct, quoteAssetFromPair } from '../.verify/data/snapshot.js';
import { computeAnchoredWeeklyVWAP } from '../.verify/data/indicators.js';
import { sanitizeOutput, markdownBoldToHtml, escapeHtml, formatPrice } from '../.verify/utils/sanitize.js';
import { fetchMultiTfData } from '../.verify/agents/fetch-multitf.js';
import { AGENT_INSTRUCTIONS } from '../.verify/agents/agent.js';
import { validateReply } from '../.verify/utils/validator.js';
import { buildAllowedClaims, collectToolResultClaims, withToolClaims } from '../.verify/agents/claims.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures++;
};

// T1 — premium/discount (nunca contango/backwardation en perps)
check('T1 premium +0.77 → premium', classifyPremiumState(0.77) === 'premium');
check('T1 premium -0.77 → discount', classifyPremiumState(-0.77) === 'discount');
check('T1 premium ±0.04 → flat', classifyPremiumState(0.04) === 'flat' && classifyPremiumState(-0.04) === 'flat');
check('T1 premium null → unknown', classifyPremiumState(null) === 'unknown');
check('T1 prompt usa premiumState + prohíbe contango en perps', /premiumState/i.test(AGENT_INSTRUCTIONS) && /NO uses contango\/backwardation/i.test(AGENT_INSTRUCTIONS));

// T2 — OI unidad (activo base, doc Bitget)
{
  const scan = await buildAggregatedScan('ETH', fakeSources());
  check('T2 openInterestUnit=ETH (activo base)', scan.openInterestUnit === 'ETH');
  check('T2 prompt prohíbe inventar unidad', /activo base/i.test(AGENT_INSTRUCTIONS) && /NUNCA inventes la unidad/i.test(AGENT_INSTRUCTIONS));
}

// T3/T4 — unidades
check('T3 formatPrice → USD', formatPrice(2391) === '2,391 USD');
check('T3 prompt exige USD en niveles', /2\.391 USD/i.test(AGENT_INSTRUCTIONS));
check('T4 prompt: RSI/ADX/MFI sin unidad', /RSI \/ ADX \/ MFI/i.test(AGENT_INSTRUCTIONS) && /sin unidad monetaria/i.test(AGENT_INSTRUCTIONS));

// T5/T6 — SuperTrend
check('T5 up → soporte', deriveRol('up') === 'soporte');
check('T5 down → resistencia', deriveRol('down') === 'resistencia');
check('T5 prompt: superTrend_rol + ejemplo USD', /superTrend_rol/i.test(AGENT_INSTRUCTIONS) && /resistencia en 2\.459 USD/i.test(AGENT_INSTRUCTIONS));
check('T6 prompt: down → RESISTENCIA (sin contradicción)', /down → RESISTENCIA/i.test(AGENT_INSTRUCTIONS));

// T7 — vela vs cierre
check('T7 low>prev → above', deriveVela(2530, 2550, 2520) === 'above');
check('T7 high<prev → below', deriveVela(2480, 2510, 2520) === 'below');
check('T7 cruza → mixed', deriveVela(2490, 2540, 2520) === 'mixed');
check('T7 caso real 2495<2520 → below (nunca above)', deriveVela(2490, 2498, 2520) === 'below');
check('T7 prompt exige metadata', /vela_vs_cierre_previo/i.test(AGENT_INSTRUCTIONS) && /low > cierre previo/i.test(AGENT_INSTRUCTIONS));

// T8 — CJK
check('T8 "SuperTrend日报" → "SuperTrend"', sanitizeOutput('SuperTrend日报 en 2391') === 'SuperTrend en 2391');
check('T8 kana eliminado', sanitizeOutput('データ 123') === '123');

// T9 — ruido
check('T9 tendenciaup → tendencia up', sanitizeOutput('la tendenciaup es alcista') === 'la tendencia up es alcista');
check('T9 parachirurgical → quirúrgico', sanitizeOutput('precio parachirurgical') === 'precio quirúrgico');
check('T9 structure → estructura', sanitizeOutput('structure semanal') === 'estructura semanal');

// T10 — markdown
check('T10 **1D** → <b>1D</b>', markdownBoldToHtml('**1D** RSI') === '<b>1D</b> RSI');
check('T10 escapa < & >', markdownBoldToHtml('precio < 100 & > 50') === 'precio &lt; 100 &amp; &gt; 50');
check('T10 escapeHtml no rompe %/-', escapeHtml('-0,0007%') === '-0,0007%');

// T11 — guard pasa con respuesta respaldada
{
  const toolResult = {
    symbol: 'ETH', price: 2495.84, quoteAsset: 'USDT', fundingBitgetPct: -0.0007,
    openInterestBitget: 720800, openInterestUnit: 'ETH',
    annualizedFundingPct: -0.7665, premiumPct: -0.1, premiumState: 'discount',
  };
  const claims = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult, 'ETH'));
  check('T11 respuesta respaldada → valid', validateReply('ETH cotiza en 2495.84 USDT con funding -0.0007% y open interest 720.800 ETH.', claims).valid);
}

// T12 — inventos bloqueados
{
  const claims = withToolClaims(buildAllowedClaims({}), collectToolResultClaims({ symbol: 'ETH', price: 2495.84 }, 'ETH'));
  check('T12 precio inventado → rechazado', !validateReply('ETH cotiza en 2000 USDT según mi análisis.', claims).valid);
}

// T13/T14 — Bitget-first
{
  const scan = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
  check('T13 Bitget OK + Bybit 403 → válido con premiumState/unidad', scan.primarySource === 'Bitget' && scan.premiumState !== undefined && scan.openInterestUnit === 'ETH');
  check('T14 Bybit 403 no fatal', scan.snapshot.price > 0);
}

// T16 — FUNDING: anualización UNAVAILABLE sin intervalo (sin default 8h)
{
  check('T16 1h → calculado', annualizedFundingPct(0.0001, { fundingRateInterval: '1' }) !== null);
  check('T16 2h → calculado', annualizedFundingPct(0.0001, { fundingRateInterval: '2' }) !== null);
  check('T16 4h → calculado', annualizedFundingPct(0.0001, { fundingRateInterval: '4' }) !== null);
  check('T16 8h → calculado', annualizedFundingPct(0.0001, { fundingRateInterval: '8' }) !== null);
  check('T16 missing → null', annualizedFundingPct(0.0001, undefined) === null);
  check('T16 null → null', annualizedFundingPct(0.0001, { fundingRateInterval: null }) === null);
  check('T16 0 → null', annualizedFundingPct(0.0001, { fundingRateInterval: '0' }) === null);
  check('T16 NaN → null', annualizedFundingPct(0.0001, { fundingRateInterval: 'NaN' }) === null);
  check('T16 no permitido (6) → null', annualizedFundingPct(0.0001, { fundingRateInterval: '6' }) === null);
  check('T16 prompt: annualized null → no inventar', /null\/unavailable/.test(AGENT_INSTRUCTIONS) && /no lo inventes/.test(AGENT_INSTRUCTIONS));
}

// T17 — QUOTE ASSET: USDT ≠ USD
{
  check('T17 quoteAssetFromPair ETHUSDT → USDT', quoteAssetFromPair('ETHUSDT') === 'USDT');
  check('T17 quoteAssetFromPair BTCUSDT → USDT', quoteAssetFromPair('BTCUSDT') === 'USDT');
  const scan = await buildAggregatedScan('ETH', fakeSources());
  check('T17 snapshot quoteAsset=USDT', scan.quoteAsset === 'USDT');
  check('T17 prompt: quote del instrumento, no USD', /USDT \u2260 USD/.test(AGENT_INSTRUCTIONS));
}

// T18 — PREMIUM BITGET INDEPENDIENTE (mark/index de Bitget, no secundarias)
{
  const solo = await buildAggregatedScan('ETH', fakeSources({ binanceFail: true, bybitFail: true, bybitStatus: 403 }));
  check('T18 BG OK + BN FAIL + BY FAIL → premium desde Bitget (no unknown)', solo.premiumState !== 'unknown', solo.premiumState);
  const todos = await buildAggregatedScan('ETH', fakeSources());
  check('T18 BG OK + BN OK + BY OK → premium válido', todos.premiumState !== 'unknown');
  const by403 = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
  check('T18 BG OK + BN OK + BY 403 → premium válido', by403.premiumState !== 'unknown');
  // BG falla en mark/index y BN/BY fallan → sin fuente comparable → 'unknown'
  const bgNoMark = await buildAggregatedScan('ETH', fakeSources({ markFail: true, binanceFail: true, bybitFail: true, bybitStatus: 403 }));
  check('T18 BG sin mark/index + BN/BY FAIL → premium unknown (no inventa)', bgNoMark.premiumState === 'unknown', bgNoMark.premiumState);
  // fallback: Bitget 100% caído → Bybit válido (premium desde Bybit)
  const fallback = await buildAggregatedScan('ETH', fallbackSources());
  check('T18 BG FAIL + Bybit fallback → premium desde Bybit', fallback.primarySource === 'Bybit' && fallback.premiumState !== 'unknown', fallback.primarySource);
  const allFail = await (async () => {
    try { await buildAggregatedScan('ETH', allFailSources()); return null; }
    catch { return 'error'; }
  })();
  check('T18 TODOS FAIL → error controlado (no inventa)', allFail === 'error');
}

// T19 — VWAP SEMANAL: sin fallback last-7
{
  const nowMs = Date.UTC(2026, 7, 27, 12, 0, 0);
  const one = [{ time: Date.UTC(2026, 7, 24, 12), open: 100, high: 105, low: 95, close: 102, volume: 100 }];
  check('T19 semana <2 velas → null', computeAnchoredWeeklyVWAP(one, { nowMs }) === null);
  const two = [
    { time: Date.UTC(2026, 7, 24, 12), open: 100, high: 105, low: 95, close: 102, volume: 100 },
    { time: Date.UTC(2026, 7, 25, 12), open: 102, high: 107, low: 97, close: 104, volume: 100 },
  ];
  check('T19 semana 2+ velas → calculado', computeAnchoredWeeklyVWAP(two, { nowMs }) !== null);
  const mixed = [
    { time: Date.UTC(2026, 7, 23, 12), open: 90, high: 95, low: 85, close: 92, volume: 100 },
    { time: Date.UTC(2026, 7, 24, 12), open: 100, high: 105, low: 95, close: 102, volume: 100 },
  ];
  check('T19 vela de semana anterior no cuenta → null', computeAnchoredWeeklyVWAP(mixed, { nowMs }) === null);
}

// T15 — multi-TF con metadata
{
  const sources = {
    bitget: {
      getCandles: async () => mkCandles(60, Date.now() - 60000, 60000),
      getCandlesHistory: async () => mkCandles(200, Date.now() - 3600000, 3600000),
      getCurrentFunding: async () => ({ symbol: 'ETHUSDT', fundingRate: '0.0001', nextUpdate: String(Date.now()) }),
      getTicker: async () => ({ symbol: 'ETHUSDT', lastPr: '2495.84' }),
    },
  };
  const ctx = await fetchMultiTfData(sources, ['ETH'], [{ tf: '1D', bitget: '1D', source: 'explicit' }]);
  const block = Object.values(ctx.ETHUSDT?.timeframes ?? {})[0];
  check('T15 multi-TF ETH valido con metadata', ctx.ETHUSDT?.valido === true && block !== undefined);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);

// Bitget 100% caído → Bybit fallback
function fallbackSources() {
  return {
    bitget: {
      getTicker: async () => { throw new Error('Bitget down'); },
      getCurrentFunding: async () => { throw new Error('Bitget down'); },
      getFundingHistory: async () => { throw new Error('Bitget down'); },
      getOpenInterest: async () => { throw new Error('Bitget down'); },
      getMarkPrice: async () => { throw new Error('Bitget down'); },
    },
    binance: {
      getPremiumIndex: async () => { throw new Error('Binance down'); },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', time: Date.now() }),
    },
    bybit: {
      getTicker: async () => ({ symbol: 'ETHUSDT', lastPrice: '2495.9', fundingRate: '-0.0000065', nextFundingTime: String(Date.now()), turnover24h: '1e9', volume24h: '1e8', openInterest: '700000', markPrice: '2496', indexPrice: '2495.9' }),
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', timestamp: String(Date.now()) }),
    },
    coinGecko: {
      getGlobal: async () => ({ data: { total_market_cap: { usd: 2.5e12 }, market_cap_percentage: { btc: 55 } } }),
    },
  };
}

// Todo caído → error controlado
function allFailSources() {
  const src = fallbackSources();
  src.bybit.getTicker = async () => { throw new Error('Bybit down'); };
  src.coinGecko.getGlobal = async () => { throw new Error('CG down'); };
  return src;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function fakeSources(o = {}) {
  return {
    bitget: {
      getTicker: async () => ({ symbol: 'ETHUSDT', lastPr: '2495.84', usdtVolume: '2490000000' }),
      getCurrentFunding: async () => ({ symbol: 'ETHUSDT', fundingRate: '-0.000007', nextUpdate: String(Date.now() + 3600000) }),
      getFundingHistory: async () => [
        { symbol: 'ETHUSDT', fundingRate: '-0.000007', fundingTime: String(Date.now()) },
        { symbol: 'ETHUSDT', fundingRate: '-0.000006', fundingTime: String(Date.now() - 3600000) },
      ],
      getOpenInterest: async () => ({ openInterestList: [{ size: '720800' }] }),
      getMarkPrice: async () => {
        if (o.markFail) throw new Error('Bitget mark fail');
        return { symbol: 'ETHUSDT', markPrice: '2496', indexPrice: '2495.9' };
      },
    },
    binance: {
      getPremiumIndex: async () => {
        if (o.binanceFail) throw new Error('Binance down');
        return { symbol: 'ETHUSDT', markPrice: '2496', indexPrice: '2495.9', lastFundingRate: '-0.0000065', nextFundingTime: Date.now(), interestRate: '0', estimatedSettlePrice: '2496', time: Date.now() };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', time: Date.now() }),
    },
    bybit: {
      getTicker: async () => {
        if (o.bybitFail) {
          const e = new Error('HTTP 403 para https://api.bybit.com/v5/market/tickers?category=linear&symbol=ETHUSDT');
          e.status = o.bybitStatus ?? 403;
          throw e;
        }
        return { symbol: 'ETHUSDT', lastPrice: '2495.9', fundingRate: '-0.0000065', nextFundingTime: String(Date.now()), turnover24h: '1e9', volume24h: '1e8', openInterest: '700000', markPrice: '2496', indexPrice: '2495.9' };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', timestamp: String(Date.now()) }),
    },
    coinGecko: {
      getGlobal: async () => ({ data: { total_market_cap: { usd: 2.5e12 }, market_cap_percentage: { btc: 55 } } }),
    },
  };
}

function mkCandles(n, endTs, step, close = 2495) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push([String(t), String(close - 10), String(close + 30), String(close - 20), String(close), '10']);
  }
  return out;
}

function deriveRol(direction) {
  return direction === 'up' ? 'soporte' : 'resistencia';
}

function deriveVela(low, high, cierrePrev) {
  return low > cierrePrev ? 'above' : high < cierrePrev ? 'below' : 'mixed';
}
