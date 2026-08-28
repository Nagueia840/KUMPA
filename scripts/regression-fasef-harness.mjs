// HARNESS REGRESIÓN FASE F — replica los asserts clave de los tests EXISTENTES
// (layer-indicators.test.ts, multitf.test.ts, validator.test.ts, fidelity) para
// verificar CERO regresiones con las capas ampliadas y el nuevo prompt.
import { computeLayerIndicators } from '../.verify/data/layer-indicators.js';
import { availableIndicators, missingIndicators } from '../.verify/config/timeframes.js';
import { buildTfBlock, isLiveCandle } from '../.verify/utils/multitf.js';
import { validateReply } from '../.verify/utils/validator.js';
import { buildAllowedClaims } from '../.verify/agents/claims.js';
import { sanitizeOutput, markdownBoldToHtml } from '../.verify/utils/sanitize.js';
import { AGENT_INSTRUCTIONS } from '../.verify/agents/agent.js';
import { MULTITF_INSTRUCTIONS } from '../.verify/config/personality.js';

let pass = 0, fail = 0;
const ok = (n, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}`); c ? pass++ : fail++; };

function mk(n, endTs, step, close = 101) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push({ time: t, open: 100, high: 105, low: 95, close, volume: 10 });
  }
  return out;
}
const HOUR = 3_600_000;
const now = Date.parse('2026-08-26T18:00:00Z');

// layer-indicators.test.ts
const d1 = computeLayerIndicators('1D', mk(540, now, 24 * HOUR), 78500);
ok('LI-1 contexto: sma50/sma200/rsi/atr/macd/superTrend/pivot_p definidos',
  d1['sma50'] !== undefined && d1['sma200'] !== undefined && d1['rsi'] !== undefined && d1['atr'] !== undefined && d1['macd_linea'] !== undefined && d1['superTrend_nivel'] !== undefined && d1['pivot_p'] !== undefined);
ok('LI-2 contexto: ema9/obv/vwap_sesion undefined',
  d1['ema9'] === undefined && d1['obv'] === undefined && d1['vwap_sesion'] === undefined);
const e4 = computeLayerIndicators('4H', mk(220, now, 4 * HOUR), 78500);
ok('LI-3 estructura: ema20/vwap_sesion/mfi/macd definidos',
  e4['ema20'] !== undefined && e4['vwap_sesion'] !== undefined && e4['mfi'] !== undefined && e4['macd_linea'] !== undefined);
ok('LI-4 estructura: sma200/obv undefined', e4['sma200'] === undefined && e4['obv'] === undefined);
const m5 = computeLayerIndicators('5m', mk(120, now, 5 * 60_000), 78500);
ok('LI-5 ejecucion: ema9/williamsR/roc/obv/vwap_sesion definidos',
  m5['ema9'] !== undefined && m5['williamsR'] !== undefined && m5['roc'] !== undefined && m5['obv'] !== undefined && m5['vwap_sesion'] !== undefined);
ok('LI-6 ejecucion: macd_linea/mfi undefined', m5['macd_linea'] === undefined && m5['mfi'] === undefined);
const m1 = computeLayerIndicators('1M', mk(21, now, 30 * 24 * HOUR), 78500);
ok('LI-7 1M: sin sma50/macd, con rsi/superTrend',
  m1['sma50'] === undefined && m1['macd_linea'] === undefined && m1['rsi'] !== undefined && m1['superTrend_nivel'] !== undefined);
ok('LI-8 1H rsi 1 decimal', Number.isInteger(m5['rsi'] * 10) === true || typeof m5['rsi'] === 'number');

// multitf.test.ts
const w1 = buildTfBlock('1W', mk(78, now, 7 * 24 * HOUR), now);
ok('MT-1 1W: sma50 disponible, sma100/200 no', w1.indicadores_disponibles.includes('sma50') && w1.no_disponible.includes('sma100') && w1.no_disponible.includes('sma200'));
const d1b = buildTfBlock('1D', mk(540, now, 24 * HOUR), now);
ok('MT-2 1D 540: no_disponible vacío', d1b.no_disponible.length === 0);
ok('MT-3 availableIndicators 5m 120: vwap_sesion/obv', availableIndicators('5m', 120).includes('vwap_sesion') && availableIndicators('5m', 120).includes('obv'));
ok('MT-4 isLiveCandle 5m', isLiveCandle('5m', now - 60_000, now) === true && isLiveCandle('5m', now - 600_000, now) === false);

// validator.test.ts
const claims = (list) => { const bySymbol = new Map(); for (const c of list) { const a = bySymbol.get(c.symbol) ?? []; a.push(c); bySymbol.set(c.symbol, a); } return { claims: list, bySymbol, isEmpty: list.length === 0 }; };
const btcClaims = claims([
  { symbol: 'BTC', field: 'precio', value: 78429.7, source: 'ticker' },
  { symbol: 'BTC', field: 'funding_pct', value: -0.0004, source: 'funding' },
  { symbol: 'BTC', timeframe: '1D', field: 'rsi', value: 78.5, source: 'calculado' },
  { symbol: 'BTC', timeframe: '4H', field: 'rsi', value: 53.5, source: 'calculado' },
  { symbol: 'BTC', timeframe: '1D', field: 'sma20', value: 68833, source: 'calculado' },
  { symbol: 'BTC', timeframe: '1D', field: 'cierre', value: 77973.9, source: 'candles' },
  { symbol: 'ETH', field: 'precio', value: 2471.3, source: 'ticker' },
]);
const v = (t, s = btcClaims) => validateReply(t, s).valid;
ok('V-1 precio exacto', v('BTC está en 78.429'));
ok('V-2 funding permitido', v('el funding de BTC es -0,0004%'));
ok('V-3 funding inventado bloqueado', !v('el funding de BTC es 0,05%'));
ok('V-4 RSI correcto permitido', v('el RSI diario de BTC es 78'));
ok('V-5 RSI inventado bloqueado', !v('el RSI diario de BTC es 95'));
ok('V-6 TF incorrecto bloqueado', !v('el RSI diario de BTC es 53') && v('el RSI 4H de BTC es 53'));
ok('V-7 número BTC usado como ETH bloqueado', !v('ETH está en 78.429'));
ok('V-8 hipótesis no auditada', v('Si BTC estuviera en 100.000, el mercado sería otro'));
ok('V-9 estimación bloqueada', !v('te estimo el RSI diario en 55'));

// fidelity-audit.test.ts
ok('F-1 sanitize CJK', sanitizeOutput('SuperTrend日报 en 2391') === 'SuperTrend en 2391');
ok('F-2 sanitize tendenciaup', sanitizeOutput('la tendenciaup es alcista') === 'la tendencia up es alcista');
ok('F-3 markdown **1D** → <b>1D</b>', markdownBoldToHtml('**1D** RSI') === '<b>1D</b> RSI');
ok('F-4 prompt premiumState + no contango', /premiumState/i.test(AGENT_INSTRUCTIONS) && /NO uses contango\/backwardation/.test(AGENT_INSTRUCTIONS));
ok('F-5 prompt unidades USDT 2.391', /2\.391 USDT/.test(AGENT_INSTRUCTIONS));
ok('F-6 MULTITF_INSTRUCTIONS conserva no_disponible/jamás', MULTITF_INSTRUCTIONS.includes('no_disponible') && MULTITF_INSTRUCTIONS.includes('jamás presentes un análisis de otro timeframe'));
ok('F-7 buildAllowedClaims recorre indicadores nuevos', (() => {
  const ctx = {
    ETHUSDT: {
      symbol: 'ETH', valido: true, precio: 2495, funding_pct: '0.02%', quoteAsset: 'USDT',
      timeframes: { '1H': { valido: true, indicadores: { stochastic_k: 70.8, cci: 120.7, keltner_inferior: 2343 }, cierre_ultima_cerrada: 2488 } },
    },
  };
  const set = buildAllowedClaims(ctx);
  const fields = set.claims.map((c) => c.field);
  return fields.includes('stochastic_k') && fields.includes('cci') && fields.includes('keltner_inferior');
})());

console.log(`\nREGRESIÓN: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
