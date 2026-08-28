// HARNESS FASE F — Tests T1-T13 (validación local sin vitest).
// Replica la lógica de tests/analytics-power.test.ts contra .verify.
import { buildSymbolSynthesis, buildSynthesisBlock, readDerivados, formatSynthesis } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock, buildMultiTfContext } from '../.verify/utils/multitf.js';
import { computeLayerIndicators } from '../.verify/data/layer-indicators.js';
import { sanitizeOutput } from '../.verify/utils/sanitize.js';
import { validateReply } from '../.verify/utils/validator.js';
import { buildAllowedClaims, collectToolResultClaims, withToolClaims } from '../.verify/agents/claims.js';
import { ANALYTIC_INSTRUCTIONS } from '../.verify/config/personality.js';
import { processUpdate } from '../.verify/webhook/queue.js';
import { buildAggregatedScan } from '../.verify/data/snapshot.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); cond ? pass++ : fail++; };

function mkCandles(n, endTs, step, close = 101, vol = 10) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push({ time: t, open: close - 10, high: close + 30, low: close - 20, close, volume: vol });
  }
  return out;
}
const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
function tfBlock(tf, n, step, close) {
  const cs = mkCandles(n, nowAnchor, step, close);
  const ind = computeLayerIndicators(tf, cs, close);
  const b = { valido: true, status: 'ok', granularidad_bitget: tf, fuente: 'Bitget', velas_total: n, ultima_vela_estado: 'closed', ultima_vela_ts_ms: cs[cs.length - 1].time, cierre_ultima_cerrada: close, indicadores_disponibles: [], no_disponible: [], indicadores: ind };
  const stDir = ind['superTrend_direccion'];
  if (stDir === 'up') b.superTrend_rol = 'soporte';
  else if (stDir === 'down') b.superTrend_rol = 'resistencia';
  return b;
}
function ethContext() {
  let s = buildMultiTfSymbol('ETH', { price: 2495, fundingPct: '0.0200%', quoteAsset: 'USDT' });
  s = attachTfBlock(s, '1W', tfBlock('1W', 78, 7 * 24 * HOUR, 2380));
  s = attachTfBlock(s, '1D', tfBlock('1D', 220, 24 * HOUR, 2495));
  s = attachTfBlock(s, '4H', tfBlock('4H', 220, 4 * HOUR, 2505));
  s = attachTfBlock(s, '1H', tfBlock('1H', 220, HOUR, 2488));
  s = attachTfBlock(s, '15m', tfBlock('15m', 120, 15 * 60_000, 2492));
  return s;
}

// T1
const syn = buildSymbolSynthesis(ethContext());
const familias = new Set();
for (const r of syn.timeframes) for (const f of r.familias) familias.add(f.familia);
for (const fam of ['TENDENCIA', 'MOMENTUM', 'VOLUMEN', 'VOLATILIDAD', 'ESTRUCTURA']) ok(`T1 familias: ${fam}`, familias.has(fam));
ok('T1 DERIVADOS', readDerivados(ethContext()).senales.length > 0);

// T2
let t2ok = true;
for (const r of syn.timeframes) { if (r.familias.filter((f) => f.senales.length > 0).length < 2) t2ok = false; }
ok('T2 cada TF con >=2 familias con señales', t2ok);
const block2 = buildSynthesisBlock(buildMultiTfContext([ethContext()]));
ok('T2 bloque síntesis', block2.length > 50 && block2.includes('LECTURA ESTRUCTURADA'));

// T3
const tfs = syn.timeframes.map((r) => r.tf);
const order = ['1W', '1D', '4H', '1H', '15m', '5m'];
const idx = tfs.map((t) => order.indexOf(t));
let t3ok = true;
for (let i = 1; i < idx.length; i++) if (idx[i] <= idx[i - 1]) t3ok = false;
ok('T3 orden grueso→fino', t3ok);
ok('T3 capas derivadas', ['alcista','bajista','mixto','neutral','s/d'].includes(syn.regimen) && ['alcista','bajista','mixto','neutral','s/d'].includes(syn.estructura));

// T4
let t4ok = true;
for (const r of syn.timeframes) for (const f of r.familias) for (const s of f.senales) if (s.length <= 8) t4ok = false;
ok('T4 señales con interpretación', t4ok);
ok('T4 prompt prohíbe listas', /NO enumeres indicadores/.test(ANALYTIC_INSTRUCTIONS) && /familias/i.test(ANALYTIC_INSTRUCTIONS));

// T5
const der = readDerivados(ethContext());
const derTxt = der.senales.join(' ');
ok('T5 longs pagan shorts', /longs pagan shorts/.test(derTxt));
ok('T5 NO presión compradora', /NO presi[oó]n compradora/.test(derTxt));
ok('T5 prompt calibra funding', /longs pagan shorts/.test(ANALYTIC_INSTRUCTIONS) && /NO demuestra presi[oó]n compradora/.test(ANALYTIC_INSTRUCTIONS));

// T6
const r1d = syn.timeframes.find((r) => r.tf === '1D');
const vol = r1d.familias.find((f) => f.familia === 'VOLUMEN');
const volTxt = vol ? vol.senales.join(' ') : '';
ok('T6 VWAP fortaleza relativa contextual', !vol || vol.senales.length === 0 || /relativa contextual/.test(volTxt));
ok('T6 prompt VWAP calibrado', /momentum confirmado/i.test(ANALYTIC_INSTRUCTIONS) && /fortaleza relativa CONTEXTUAL/.test(ANALYTIC_INSTRUCTIONS) && /momentum confirmado[^.]*(?:por s[íi] solo)/i.test(ANALYTIC_INSTRUCTIONS));

// T7
ok('T7 quoteAsset USDT', syn.quoteAsset === 'USDT');
const todos = syn.timeframes.flatMap((r) => r.niveles).join(' ');
ok('T7 niveles USDT', todos.includes('USDT'));
ok('T7 prompt quoteAsset', /quoteAsset/.test(ANALYTIC_INSTRUCTIONS));

// T8
const txt8 = formatSynthesis(syn);
ok('T8 SuperTrend español (no up/down crudo)', !/SuperTrend\s+(?:1W|1D|4H|1H|15m|5m)?\s*(up|down)\b/i.test(txt8) && /SuperTrend\s+(?:1W|1D|4H|1H|15m|5m)?\s*(alcista|bajista)/i.test(txt8));

// T9
const out9 = sanitizeOutput('el régimen es alcista antes de.Commit. y el flujo sigue underway');
ok('T9 sin .commit', !/\.commit/i.test(out9));
ok('T9 sin underway', !/underway/i.test(out9));
ok('T9 sin CJK', sanitizeOutput('SuperTrend日报 en 2391') === 'SuperTrend en 2391');
ok('T9 no mutila válido', sanitizeOutput('2.391 USDT con funding -0,0007% y RSI 68') === '2.391 USDT con funding -0,0007% y RSI 68');
ok('T9 no mutila siglas', sanitizeOutput('EE.UU. es un mercado') === 'EE.UU. es un mercado');

// T10
const niveles = syn.timeframes.flatMap((r) => r.niveles);
ok('T10 niveles con unidad', niveles.length > 0 && niveles.every((n) => /USDT|USD|USDC/.test(n)));
ok('T10 prompt unidades obligatorias', /UNIDADES \(obligatorio en toda cifra\)/.test(ANALYTIC_INSTRUCTIONS));

// T11
const toolResult = { symbol: 'ETH', price: 2495.84 };
const claims11 = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult, 'ETH'));
ok('T11 invento bloqueado', validateReply('ETH cotiza en 2000 USDT según mi análisis.', claims11).valid === false);
const toolResult2 = { symbol: 'ETH', indicators: { stochastic: { k: 70.8, d: 65 }, cci: 120.7, keltner: { upper: 2471, middle: 2405, lower: 2343 } } };
const claims11b = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult2, 'ETH'));
ok('T11 nuevos campos legítimos aceptados', validateReply('El stochastic de ETH está en 70.8 y el CCI en 120.7.', claims11b).valid === true);

// T12
const scan12 = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
ok('T12 Bitget-first Bybit 403', scan12.primarySource === 'Bitget' && scan12.primaryStatus === 'ok' && scan12.crosschecks.bybit.status === 'unavailable');

// T13
const store = fakeStore();
await store.savePendingUpdate(777, { update_id: 777 });
const p = await store.claimPendingUpdate(777);
const bot = { handleUpdate: async () => {} };
ok('T13 processUpdate OK → processed', (await processUpdate(bot, store, p)) === true && store.processed.has(777));
store.rows.set(778, { payload: JSON.stringify({ update_id: 778 }), status: 'processing', attempts: 1, created: 0, startedAt: Date.now() });
const hangingBot = { handleUpdate: () => new Promise(() => {}) };
const r778 = await processUpdate(hangingBot, store, { updateId: 778, payload: JSON.stringify({ update_id: 778 }), attempts: 1 }, { budgetMs: 120 });
ok('T13 timeout controlado', r778 === false && store.rows.get(778).status === 'pending');

console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

function fakeSources(o = {}) {
  return {
    bitget: {
      getTicker: async () => ({ symbol: 'ETHUSDT', lastPr: '2495.84', usdtVolume: '2490000000' }),
      getCurrentFunding: async () => ({ symbol: 'ETHUSDT', fundingRate: '-0.000007', nextUpdate: String(Date.now() + 3_600_000) }),
      getFundingHistory: async () => [{ symbol: 'ETHUSDT', fundingRate: '-0.000007', fundingTime: String(Date.now()) }, { symbol: 'ETHUSDT', fundingRate: '-0.000006', fundingTime: String(Date.now() - 3_600_000) }],
      getOpenInterest: async () => ({ openInterestList: [{ size: '720800' }] }),
      getMarkPrice: async () => ({ symbol: 'ETHUSDT', markPrice: '2496', indexPrice: '2495.9' }),
    },
    binance: {
      getPremiumIndex: async () => ({ symbol: 'ETHUSDT', markPrice: '2496', indexPrice: '2495.9', lastFundingRate: '-0.0000065', nextFundingTime: Date.now(), interestRate: '0', estimatedSettlePrice: '2496', time: Date.now() }),
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', time: Date.now() }),
    },
    bybit: {
      getTicker: async () => {
        if (o.bybitFail) { const e = new Error('HTTP 403 para https://api.bybit.com/v5/market/tickers?category=linear&symbol=ETHUSDT'); e.status = o.bybitStatus ?? 403; throw e; }
        return { symbol: 'ETHUSDT', lastPrice: '2495.9', fundingRate: '-0.0000065', nextFundingTime: String(Date.now()), turnover24h: '1e9', volume24h: '1e8', openInterest: '700000', markPrice: '2496', indexPrice: '2495.9' };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', timestamp: String(Date.now()) }),
    },
    coinGecko: { getGlobal: async () => ({ data: { total_market_cap: { usd: 2.5e12 }, market_cap_percentage: { btc: 55 } } }) },
  };
}
function fakeStore() {
  const rows = new Map();
  const processed = new Set();
  return {
    rows, processed,
    async savePendingUpdate(updateId, payload) { rows.set(updateId, { payload: JSON.stringify(payload), status: 'pending', attempts: 0, created: Date.now(), startedAt: 0 }); return 'inserted'; },
    async claimPendingUpdate(updateId) {
      const id = updateId ?? [...rows.keys()][0];
      const row = rows.get(id);
      if (!row || row.status !== 'pending') return null;
      row.status = 'processing'; row.attempts++; row.startedAt = Date.now();
      return { updateId: id, payload: row.payload, attempts: row.attempts };
    },
    async finishPendingUpdate(updateId, ok, opts = {}) {
      const row = rows.get(updateId); if (!row) return;
      if (ok) { processed.add(updateId); rows.delete(updateId); }
      else if (opts.permanent || row.attempts >= 3) row.status = 'failed';
      else row.status = 'pending';
    },
    async isUpdateProcessed(updateId) { return processed.has(updateId); },
    async recoverStuckProcessing() { return 0; },
  };
}
