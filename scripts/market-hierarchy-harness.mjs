// KUMPA — Harness empírico de JERARQUÍA DE FUENTES (T1–T11).
// Reproduce el bug real (Bybit 403 → snapshot fatal) y verifica la política
// Bitget-first con cross-checks NO fatales.
// Correr tras compilar: node node_modules/typescript/lib/tsc.js -p tsconfig.verify.json
//   node scripts/market-hierarchy-harness.mjs
import { buildAggregatedScan } from '../.verify/data/snapshot.js';
import { fetchMultiTfData } from '../.verify/agents/fetch-multitf.js';
import { executeTool } from '../.verify/agents/tools.js';
import { AGENT_INSTRUCTIONS } from '../.verify/agents/agent.js';
import { resolveTimeframes } from '../.verify/utils/intent.js';
import { processUpdate } from '../.verify/webhook/queue.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures++;
};

function fakeSources(o = {}) {
  return {
    bitget: {
      getTicker: async () => {
        if (o.bitgetFail === 'ticker' || o.bitgetFail === 'all') throw new Error('Bitget ticker fail');
        return { symbol: 'XUSDT', lastPr: '3450.5', usdtVolume: '123456789' };
      },
      getCurrentFunding: async () => {
        if (o.bitgetFail === 'funding' || o.bitgetFail === 'all') throw new Error('Bitget funding fail');
        return { symbol: 'XUSDT', fundingRate: '0.0001', nextUpdate: String(Date.now() + 3600000) };
      },
      getFundingHistory: async () => {
        if (o.bitgetFail === 'hist' || o.bitgetFail === 'all') throw new Error('Bitget hist fail');
        return [
          { symbol: 'XUSDT', fundingRate: '0.0001', fundingTime: String(Date.now()) },
          { symbol: 'XUSDT', fundingRate: '0.00009', fundingTime: String(Date.now() - 3600000) },
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
    },
    binance: {
      getPremiumIndex: async () => {
        if (o.binanceFail) throw new Error('HTTP 400 para https://fapi.binance.com/fapi/v1/premiumIndex?symbol=XUSDT');
        return { symbol: 'XUSDT', markPrice: '3451', indexPrice: '3450', lastFundingRate: '0.000095', nextFundingTime: Date.now(), interestRate: '0', estimatedSettlePrice: '3451', time: Date.now() };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'XUSDT', openInterest: '100', time: Date.now() }),
    },
    bybit: {
      getTicker: async () => {
        if (o.bybitFail) {
          const e = new Error('HTTP 403 para https://api.bybit.com/v5/market/tickers?category=linear&symbol=XUSDT');
          e.status = o.bybitStatus ?? 403;
          throw e;
        }
        return { symbol: 'XUSDT', lastPrice: '3450.7', fundingRate: '0.000095', nextFundingTime: String(Date.now()), turnover24h: '1e9', volume24h: '1e8', openInterest: '12000', markPrice: '3451', indexPrice: '3450' };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'XUSDT', openInterest: '12000', timestamp: String(Date.now()) }),
    },
    coinGecko: {
      getGlobal: async () => {
        if (o.coinGeckoFail) throw new Error('CoinGecko fail');
        return { data: { total_market_cap: { usd: 2.5e12 }, market_cap_percentage: { btc: 55 } } };
      },
    },
  };
}

function mkCandles(n, endTs, step) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push([String(t), '100', '105', '95', '101', '10']);
  }
  return out;
}

// ── T1: Bitget OK + Bybit 403 → snapshot VÁLIDO ──────────────────────────────
{
  const s = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
  check('T1 Bitget OK + Bybit 403 → primarySource=Bitget', s.primarySource === 'Bitget');
  check('T1 primaryStatus=ok', s.primaryStatus === 'ok');
  check('T1 crosscheck bybit=unavailable', s.crosschecks.bybit.status === 'unavailable');
  check('T1 precio actual > 0', s.snapshot.price === 3450.5);
}

// ── T2: Bitget OK + Binance fail → VÁLIDO ────────────────────────────────────
{
  const s = await buildAggregatedScan('ETH', fakeSources({ binanceFail: true }));
  check('T2 Binance fail → snapshot válido (Bitget)', s.primarySource === 'Bitget' && s.crosschecks.binance.status === 'unavailable' && s.snapshot.price > 0);
}

// ── T3: Bitget OK + ambas secundarias fail → VÁLIDO ──────────────────────────
{
  const s = await buildAggregatedScan('ETH', fakeSources({ binanceFail: true, bybitFail: true, bybitStatus: 403 }));
  check('T3 ambas secundarias fail → snapshot válido', s.primarySource === 'Bitget' && s.crosschecks.bybit.status === 'unavailable' && s.crosschecks.binance.status === 'unavailable' && s.snapshot.price > 0);
}

// ── T4: Bitget fail + Bybit OK → fallback ETIQUETADO ─────────────────────────
{
  const s = await buildAggregatedScan('ETH', fakeSources({ bitgetFail: 'all' }));
  check('T4 fallback Bybit etiquetado (no Bitget)', s.primarySource === 'Bybit' && s.primaryStatus === 'fallback' && s.snapshot.price === 3450.7);
}

// ── T5: todo fail → error controlado ─────────────────────────────────────────
{
  let err = null;
  try { await buildAggregatedScan('ETH', fakeSources({ bitgetFail: 'all', bybitFail: true, binanceFail: true })); } catch (e) { err = e; }
  check('T5 todo fail → error controlado (no inventa)', err !== null && /Sin datos de mercado/i.test(err.message));
}

// ── T6: caso real ETH con Bybit 403 ──────────────────────────────────────────
{
  const s = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
  check('T6 ETHUSDT con Bybit 403 → datos actuales', s.pair === 'ETHUSDT' && s.snapshot.price > 0 && s.snapshot.updatedAt > 0);
}

// ── T7: BTC no regresión ─────────────────────────────────────────────────────
{
  const s = await buildAggregatedScan('BTC', fakeSources());
  check('T7 BTC todas OK → Bitget + crosschecks ok', s.primarySource === 'Bitget' && s.crosschecks.bybit.status === 'ok' && s.crosschecks.binance.status === 'ok');
}

// ── T8: multi-TF ETH solo Bitget ─────────────────────────────────────────────
{
  const src = {
    bitget: {
      getCandles: async () => mkCandles(60, Date.now() - 60000, 60000),
      getCandlesHistory: async () => mkCandles(200, Date.now() - 3600000, 3600000),
      getCurrentFunding: async () => ({ symbol: 'ETHUSDT', fundingRate: '0.0001', nextUpdate: String(Date.now()) }),
      getTicker: async () => ({ symbol: 'ETHUSDT', lastPr: '3450.5' }),
    },
  };
  const ctx = await fetchMultiTfData(src, ['ETH'], resolveTimeframes('analizame ETH ahora'));
  check('T8 multi-TF ETH solo Bitget → valido', ctx.ETHUSDT?.valido === true && Object.keys(ctx.ETHUSDT?.timeframes ?? {}).length > 0);
}

// ── T9: stale → timestamp/antigüedad obligatorios ────────────────────────────
{
  check('T9 snapshot expone updatedAt', (await buildAggregatedScan('ETH', fakeSources())).snapshot.updatedAt > 0);
  check('T9 prompt exige timestamp/antigüedad/NO actual', /timestamp/i.test(AGENT_INSTRUCTIONS) && /antigüedad/i.test(AGENT_INSTRUCTIONS) && /NO es el dato actual/i.test(AGENT_INSTRUCTIONS));
}

// ── T10: no falsa promesa futura ─────────────────────────────────────────────
{
  check('T10 prompt: indisponibilidad + no promesa automática', /No pude actualizar los datos en esta ejecución/i.test(AGENT_INSTRUCTIONS) && /no existe un proceso programado/i.test(AGENT_INSTRUCTIONS));
}

// ── T11: worker no regresión ─────────────────────────────────────────────────
{
  // processUpdate OK
  const rows = new Map();
  const processed = new Set();
  const store = {
    rows, processed,
    savePendingUpdate: async (id, payload) => { rows.set(id, { payload: JSON.stringify(payload), status: 'pending', attempts: 0 }); return 'inserted'; },
    claimPendingUpdate: async (id) => { const r = rows.get(id); if (!r || r.status !== 'pending') return null; r.status = 'processing'; r.attempts++; return { updateId: id, payload: r.payload, attempts: r.attempts }; },
    finishPendingUpdate: async (id, ok) => { if (ok) { processed.add(id); rows.delete(id); } else rows.get(id).status = 'pending'; },
    isUpdateProcessed: async (id) => processed.has(id),
    recoverStuckProcessing: async () => 0,
  };
  await store.savePendingUpdate(4242, { update_id: 4242, message: { chat: { id: 1 }, text: 'hola' } });
  const p = await store.claimPendingUpdate(4242);
  const ok = await processUpdate({ handleUpdate: async () => {} }, store, p);
  check('T11 worker processed OK', ok === true && processed.has(4242));
  // hang → timeout controlado
  rows.set(4243, { payload: JSON.stringify({ update_id: 4243 }), status: 'processing', attempts: 1 });
  const hanging = await processUpdate({ handleUpdate: () => new Promise(() => {}) }, store, { updateId: 4243, payload: JSON.stringify({ update_id: 4243 }), attempts: 1 }, { budgetMs: 150 });
  check('T11 hang → timeout controlado (no processing eterno)', hanging === false && rows.get(4243)?.status === 'pending');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
