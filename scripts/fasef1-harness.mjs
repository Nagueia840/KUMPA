// HARNESS FASE F.1 — valida T17-T28 + genera fixture de respuesta simulada.
// Replica la lógica de los tests nuevos contra .verify.
import { buildSymbolSynthesis, formatSynthesis, readDerivados } from '../.verify/agents/synthesis.js';
import { buildMultiTfSymbol, attachTfBlock } from '../.verify/utils/multitf.js';
import { computeLayerIndicators } from '../.verify/data/layer-indicators.js';
import { validateReply } from '../.verify/utils/validator.js';
import { buildAllowedClaims, withToolClaims, collectToolResultClaims } from '../.verify/agents/claims.js';
import { truncateSafe, isLengthTruncation, sanitizeOutput } from '../.verify/utils/sanitize.js';
import { ANALYTIC_INSTRUCTIONS } from '../.verify/config/personality.js';
import { buildAggregatedScan } from '../.verify/data/snapshot.js';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${e ? '  [' + e + ']' : ''}`); c ? pass++ : fail++; };

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;
function mk(n, step, close = 101) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * step;
    out.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close, volume: 10 });
  }
  return out;
}
function blk(tf, cs, price) {
  const ind = computeLayerIndicators(tf, cs, price);
  return { valido: true, status: 'ok', granularidad_bitget: tf, fuente: 'Bitget', velas_total: cs.length, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: price, indicadores_disponibles: [], no_disponible: [], indicadores: ind };
}
function ethRich() {
  let s = buildMultiTfSymbol('ETH', { price: 2495, fundingPct: '0.0200%', quoteAsset: 'USDT' });
  s = attachTfBlock(s, '1W', blk('1W', mk(78, 7 * 24 * HOUR, 2380), 2380));
  s = attachTfBlock(s, '1D', blk('1D', mk(220, 24 * HOUR, 2495), 2495));
  s = attachTfBlock(s, '4H', blk('4H', mk(220, 4 * HOUR, 2505), 2505));
  s = attachTfBlock(s, '1H', blk('1H', mk(220, HOUR, 2488), 2488));
  return s;
}

// T17
const syn17 = buildSymbolSynthesis(ethRich());
let t17ok = true;
for (const r of syn17.timeframes) {
  const conDatos = r.familias.filter((f) => f.senales.length > 0);
  for (const f of conDatos) {
    if (!r.senalesRelevantes.some((s) => f.senales.includes(s))) t17ok = false;
  }
}
ok('T17 todas las familias con datos tienen señal en senalesRelevantes', t17ok);

// T18
let t18ok = true;
for (const r of syn17.timeframes) {
  const fams = r.familias.filter((f) => f.senales.length > 0).map((f) => f.familia);
  for (const fam of ['VOLUMEN', 'VOLATILIDAD', 'ESTRUCTURA']) {
    if (fams.includes(fam)) {
      if (!r.senalesRelevantes.some((s) => r.familias.find((f2) => f2.familia === fam).senales.includes(s))) t18ok = false;
    }
  }
}
ok('T18 VOLUMEN/VOLATILIDAD/ESTRUCTURA incluidas (sin filtro de palabras)', t18ok);

// T19
const ind19 = { rsi: 65, macd_linea: 5, macd_senal: 3, macd_histograma: 2, stochastic_k: 70, stochastic_d: 60, cci: 150, williamsR: -30, roc: 2, mfi: 55 };
let s19 = buildMultiTfSymbol('ETH', { price: 101, fundingPct: '0.0200%', quoteAsset: 'USDT' });
s19 = attachTfBlock(s19, '1H', { valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget', velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 101, indicadores_disponibles: [], no_disponible: [], indicadores: ind19 });
const syn19 = buildSymbolSynthesis(s19);
const mom19 = syn19.timeframes[0].familias.find((f) => f.familia === 'MOMENTUM');
ok('T19 MOMENTUM vota una vez por familia (peso 3, dirección única)', mom19.direccion === 'alcista' && mom19.peso === 3);

// T20
const txt20 = formatSynthesis(syn17);
ok('T20 síntesis en español (no SuperTrend down/up crudo)', !/SuperTrend\s+(?:1W|1D|4H|1H|15m|5m)?\s*(?:up|down)\b/i.test(txt20) && /SuperTrend\s+(?:1W|1D|4H|1H|15m|5m)?\s*(?:alcista|bajista)/i.test(txt20));

// T21
const todos21 = syn17.timeframes.flatMap((r) => r.niveles).join(' ');
ok('T21 ETHUSDT niveles con USDT (no USD a secas)', syn17.quoteAsset === 'USDT' && todos21.includes('USDT') && !/\d+\s+USD\b/.test(todos21));

// T22
const der22 = readDerivados(ethRich());
const txt22 = der22.senales.join(' ');
function afirmaPresionCompradora(txt) {
  const re = /presi[oó]n compradora (demostrada|confirmada)/gi;
  const NEG = /(?:^|[\s,;:—–(])(?:no|nunca|jam[aá]s|sin|no hay|no es|no demuestra|no confirma|no implica|no existe|no prueba|no evidencia|no es evidencia)\s*$/i;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const before = txt.slice(Math.max(0, m.index - 48), m.index);
    if (!NEG.test(before)) return true;
  }
  return false;
}
ok('T22 funding calibrado (longs pagan shorts, NO presión compradora)', /longs pagan shorts/.test(txt22) && /NO presi[oó]n compradora/.test(txt22) && !afirmaPresionCompradora(txt22));
ok('T22 afirmación positiva real viola', afirmaPresionCompradora('la presión compradora demostrada por el funding') === true);

// T23
const ind23 = { vwap_sesion: 2600 };
let s23 = buildMultiTfSymbol('ETH', { price: 2495, fundingPct: '0.0200%', quoteAsset: 'USDT' });
s23 = attachTfBlock(s23, '4H', { valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget', velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor, cierre_ultima_cerrada: 2495, indicadores_disponibles: [], no_disponible: [], indicadores: ind23 });
const syn23 = buildSymbolSynthesis(s23);
const vol23 = syn23.timeframes[0].familias.find((f) => f.familia === 'VOLUMEN');
const txt23 = vol23.senales.join(' ');
ok('T23 VWAP bajo → debilidad relativa contextual (no presión vendedora confirmada)', /debilidad relativa contextual/.test(txt23) && !/presi[oó]n vendedora confirmada/.test(txt23));
ok('T23 prompt prohíbe "presión vendedora confirmada"', /NO "presi[oó]n vendedora confirmada"/.test(ANALYTIC_INSTRUCTIONS));

// T24
ok('T24 prompt exige confluencias/escenarios/trigger/invalidación/riesgo',
  /CONFLUENCIAS/.test(ANALYTIC_INSTRUCTIONS) && /ESCENARIO ALCISTA/.test(ANALYTIC_INSTRUCTIONS) && /ESCENARIO BAJISTA/.test(ANALYTIC_INSTRUCTIONS) && /Triggers de confirmaci[oó]n/.test(ANALYTIC_INSTRUCTIONS) && /Invalidaciones/.test(ANALYTIC_INSTRUCTIONS) && /Riesgo principal/.test(ANALYTIC_INSTRUCTIONS));
ok('T24 síntesis produce confluencias/contradicciones', syn17.timeframes.some((r) => r.confluencias.length > 0) && syn17.timeframes.some((r) => r.contradicciones.length > 0 || syn17.contradiccionesInterTf.length > 0));

// T25
ok('T25 finish_reason length detectable', isLengthTruncation('length') && isLengthTruncation('max_tokens') && !isLengthTruncation('stop') && !isLengthTruncation(null));

// T26
const rota26 = 'El régimen semanal es alcista con soporte en 2.450 USDT y la estructura de 4H muestra momentum positivo, pero el volumen no confirma y el timing todavía está por definirse en el marco de 15 minutos, con el precio operando en la zona media de las bandas de Bollinger y un flujo de volumen que no acompaña la recuperación intradiaria';
const safe26 = truncateSafe(rota26);
ok('T26 truncamiento controlado (cierre, sin frase rota)', /Análisis recortado por límite de longitud/.test(safe26) && !/[a-záéíóúñ]$/.test(safe26));
ok('T26 texto completo multi-párrafo no mutilado', truncateSafe('El régimen es alcista. La estructura 4H acompaña.\n\nEl volumen confirma.') === 'El régimen es alcista. La estructura 4H acompaña.\n\nEl volumen confirma.');

// T27
const scan27 = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
ok('T27 Bybit 403 no fatal', scan27.primarySource === 'Bitget' && scan27.primaryStatus === 'ok' && scan27.crosschecks.bybit.status === 'unavailable');

// T28
const tr28 = { symbol: 'ETH', price: 2495.84 };
const claims28 = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(tr28, 'ETH'));
ok('T28 guard bloquea inventados', validateReply('ETH cotiza en 2000 USDT según mi análisis.', claims28).valid === false);
ok('T28 guard acepta legítimos', validateReply('ETH cotiza en 2495.84 USDT.', claims28).valid === true);

// Extra: sanitize annualized
ok('S-extra sanitize annualized→anualizado', sanitizeOutput('funding 7.55% annualized') === 'funding 7.55% anualizado');

console.log('\n=== SÍNTESIS ENRIQUECIDA (muestra) ===');
console.log(formatSynthesis(syn17).slice(0, 2200));

console.log('\n=== RESPUESTA FIXTURE SIMULADA ("Analizame ETH ahora", basada en síntesis F.1) ===');
console.log(`ETH (USDT) — ${syn17.lecturaGlobal}.

RÉGIMEN 1W/1D (${syn17.regimen}):
- Tendencia: ${syn17.timeframes.find((r) => r.tf === '1W')?.senalesRelevantes.slice(0, 2).join('; ') || 's/d'}.
- Momentum diario: ${syn17.timeframes.find((r) => r.tf === '1D')?.familias.find((f) => f.familia === 'MOMENTUM')?.direccion || 's/d'}.
- Volatilidad: ${syn17.timeframes.find((r) => r.tf === '1D')?.familias.find((f) => f.familia === 'VOLATILIDAD')?.senales[1] || 's/d'}.
- Estructura/niveles: ${syn17.timeframes.find((r) => r.tf === '1D')?.niveles.slice(0, 2).join(' | ') || 's/d'}.

ESTRUCTURA 4H/1H (${syn17.estructura}):
- ${syn17.timeframes.find((r) => r.tf === '4H')?.senalesRelevantes.slice(0, 3).join('; ') || 's/d'}.
- Niveles: ${syn17.timeframes.find((r) => r.tf === '4H')?.niveles.slice(0, 2).join(' | ') || 's/d'}.

CONFLUENCIAS Y CONTRADICCIONES:
- ${syn17.contradiccionesInterTf.length ? '⚠ ' + syn17.contradiccionesInterTf.join('; ') : 'Familias alineadas sin conflicto inter-TF.'}

ESCENARIO ALCISTA: requiere cierre sobre la resistencia de la estructura 4H; trigger: ${syn17.timeframes.find((r) => r.tf === '4H')?.niveles[2] || 's/d'}; invalidación: cierre diario bajo ${syn17.timeframes.find((r) => r.tf === '1D')?.niveles[0] || 's/d'}.
ESCENARIO BAJISTA: profundización del pullback; trigger: pérdida de ${syn17.timeframes.find((r) => r.tf === '4H')?.niveles[0] || 's/d'}; invalidación: recuperación sobre ${syn17.timeframes.find((r) => r.tf === '1D')?.niveles[2] || 's/d'}.

LECTURA OPERATIVA/RIESGO: ${syn17.lecturaGlobal}; riesgo principal: conflicto entre régimen y estructura intermedia — el timing aún no confirma entrada. Derivados: ${txt22}.`);

console.log(`\nFASE F.1: ${pass} PASS / ${fail} FAIL`);
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
