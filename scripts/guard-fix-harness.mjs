// KUMPA — Harness empírico FIX -2470 (falso positivo del guard con toolClaims).
// Reproduce el caso real de producción y verifica T1–T11 sin red.
// Correr tras compilar: node node_modules/typescript/lib/tsc.js -p tsconfig.verify.json
//   node scripts/guard-fix-harness.mjs
import { collectToolResultClaims, buildAllowedClaims, withToolClaims } from '../.verify/agents/claims.js';
import { validateReply } from '../.verify/utils/validator.js';
import { guardedFinalize, GUARD_REFUSAL_TEXT } from '../.verify/agents/guarded-reply.js';
import { buildMultiTfSymbol, attachTfBlock, buildMultiTfContext } from '../.verify/utils/multitf.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures++;
};

const techToolResult = {
  symbol: 'ETH', timeframe: '1d',
  indicators: {
    price: 3455, vwapWeekly: 3430, sma20: 3400, sma50: 3300, rsi14: 42.5,
    macd: { macd: -2400, signal: 70, histogram: -2470 },
    atr14: 95, bollinger: { lower: 3200, middle: 3455, upper: 3710 },
    pivotPoints: { pivot: 3455, r1: 3550, s1: 3350 },
  },
};
const snapshotToolResult = {
  symbol: 'ETH', pair: 'ETHUSDT', source: 'Bitget', primaryStatus: 'ok',
  crosschecks: { binance: 'unavailable', bybit: 'unavailable' },
  priceUsd: 3455.5, fundingBitgetPct: 0.01, fundingBinancePct: 0, fundingBybitPct: 0,
  fundingSpreadBps: 1, openInterestBitget: 12500, openInterestBybit: 0,
  basisAnnualizedPct: 10.95, volume24hUsd: 123456789, btcDominancePct: 55, globalCapUsd: 2.5e12,
};

function claimsFor(results, fallback = 'ETH') {
  const toolClaims = results.flatMap((r) => collectToolResultClaims(r, fallback));
  return withToolClaims(buildAllowedClaims({}), toolClaims);
}

// T1
{
  const c = claimsFor([snapshotToolResult]);
  check('T1 priceUsd snapshot → aceptado', validateReply('ETH está en 3455.5 según el mercado.', c).valid);
  check('T1 price tool técnico → aceptado', validateReply('El precio de ETH es 3455.', claimsFor([techToolResult])).valid);
}
// T2
{
  check('T2 fundingBitgetPct → aceptado', validateReply('ETH tiene un funding de 0.01% según los datos.', claimsFor([snapshotToolResult])).valid);
}
// T3
{
  check('T3 open interest → aceptado', validateReply('El open interest de ETH es 12500 según Bitget.', claimsFor([snapshotToolResult])).valid);
}
// T4 (caso real -2470)
{
  const v = validateReply('El MACD de ETH está en -2470 según el indicador.', claimsFor([techToolResult]));
  check('T4 macd_histograma=-2470 → ACEPTADO (caso real producción)', v.valid, v.violations.map((x) => x.reason).join(' | '));
  check('T4 macd_linea=-2400 → aceptado', validateReply('La línea MACD de ETH está en -2400 según el cálculo.', claimsFor([techToolResult])).valid);
}
// T5
{
  const v = validateReply('ETH va a 3000 seguro, es soporte clave.', claimsFor([snapshotToolResult, techToolResult]));
  check('T5 inventado (3000) → RECHAZADO', !v.valid && /3000/.test(v.violations[0]?.reason ?? ''));
}
// T6
{
  check('T6 precio 2900 (fuera tol) → RECHAZADO', !validateReply('ETH cotiza en 2900 según el análisis, lejos del precio actual.', claimsFor([snapshotToolResult])).valid);
}
// T7
{
  const btc = { ...snapshotToolResult, symbol: 'BTC', priceUsd: 98000 };
  const c = claimsFor([btc], 'BTC');
  check('T7 claim BTC no valida cita ETH → RECHAZADO', !validateReply('ETH está en 3455.5 según el análisis, cerca del soporte.', c).valid);
}
// T8
{
  const c = claimsFor([{ symbol: 'ETH', fundingBitgetPct: 0.01 }]);
  check('T8 claims presentes pero número sin claim → RECHAZADO', !validateReply('ETH está en 3455.5 según el análisis, cerca del soporte.', c).valid);
  const empty = buildAllowedClaims({});
  check('T8a ClaimSet vacío → guard no audita (diseño, documentado)', empty.isEmpty === true && validateReply('ETH está en 3455.5 según el análisis, cerca del soporte.', empty).valid === true);
}
// T9
{
  const tf1d = {
    valido: true, status: 'ok', candleCount: 220, cierre_ultima_cerrada: 3440,
    vela_viva: { time: Date.now(), open: 3450, high: 3460, low: 3445, close: 3455 },
    indicadores: { rsi: 58.2, vwap_sesion: 3435.5 },
  };
  let s = buildMultiTfSymbol('ETH', { price: 3455, fundingPct: '0.0100%' });
  s = attachTfBlock(s, '1D', tf1d);
  const canonical = buildAllowedClaims(buildMultiTfContext([s]));
  const claims = withToolClaims(canonical, collectToolResultClaims(techToolResult, 'ETH'));
  check('T9 canonical + toolClaims juntos → aceptado', validateReply('ETH está en 3455, el RSI en 58.2 y el MACD en -2470.', claims).valid);
}
// T10
{
  const r = await guardedFinalize('El MACD de ETH está en -2470 y el RSI en 42.5.', claimsFor([techToolResult]), async () => '');
  check('T10 guardedFinalize respaldada → ok (no GUARD_REFUSAL_TEXT)', r.status === 'ok' && (r.status !== 'ok' || r.text !== GUARD_REFUSAL_TEXT));
}
// T11
{
  const r = await guardedFinalize('ETH va a 3000 según mi análisis, es soporte clave.', claimsFor([techToolResult]), async () => 'Reitero: ETH va a 3000 según mi análisis.');
  check('T11 guardedFinalize inventado → refused', r.status === 'refused' && (r.status !== 'refused' || /sin respaldo|violación/i.test(r.reason)));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
