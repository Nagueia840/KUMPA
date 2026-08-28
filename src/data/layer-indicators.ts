import {
  INDICATORS_BY_LAYER,
  LAYER_BY_TF,
  type TfLabel,
} from '../config/timeframes.js';
import {
  computeAllIndicators,
  computeEMA,
  computeHistoricalVolatility,
  computeSessionVWAP,
  type Candle,
} from './indicators.js';

/**
 * Indicadores POR CAPA (FASE B + refinamiento FASE E): calcula solo el
 * subconjunto definido en INDICATORS_BY_LAYER para el timeframe, sobre velas
 * CERRADAS (la vela viva nunca entra al cálculo). Los que no se pueden calcular
 * (historia corta) simplemente no aparecen: `no_disponible` lo declara.
 *
 * vwap_sesion (FASE E): VWAP de sesión con ancla UTC (00:00Z) — referencia
 * neutral global para un mercado 24/7 — calculado solo con velas cerradas.
 */

const round = (n: number | null | undefined): number | null =>
  n == null || Number.isNaN(n) ? null : Math.round(n);
const round1 = (n: number | null | undefined): number | null =>
  n == null || Number.isNaN(n) ? null : Math.round(n * 10) / 10;

/**
 * Calcula el snapshot compacto de la capa del TF.
 * Devuelve solo las claves de la capa con valores no-null (nombres compactos).
 */
export function computeLayerIndicators(
  tf: TfLabel,
  candles: readonly Candle[],
  price: number,
): Record<string, unknown> {
  const full = computeAllIndicators([...candles], price);
  const closes = candles.map((c) => c.close);
  const layer = INDICATORS_BY_LAYER[LAYER_BY_TF[tf]];
  const out: Record<string, unknown> = {};

  const put = (k: string, v: number | null | undefined): void => {
    const r = round(v);
    if (r !== null) out[k] = r;
  };
  const put1 = (k: string, v: number | null | undefined): void => {
    const r = round1(v);
    if (r !== null) out[k] = r;
  };

  for (const name of layer) {
    switch (name) {
      case 'ema9':
        put('ema9', computeEMA(closes, 9));
        break;
      case 'ema20':
        put('ema20', full.ema20);
        break;
      case 'ema50':
        put('ema50', full.ema50);
        break;
      case 'sma20':
        put('sma20', full.sma20);
        break;
      case 'sma50':
        put('sma50', full.sma50);
        break;
      case 'sma100':
        put('sma100', full.sma100);
        break;
      case 'sma200':
        put('sma200', full.sma200);
        break;
      case 'wma20':
        put('wma20', full.wma20);
        break;
      case 'hma20':
        put('hma20', full.hma20);
        break;
      case 'vwma20':
        put('vwma20', full.vwma20);
        break;
      case 'vwap_semanal':
        put('vwap_semanal', full.vwapWeekly);
        break;
      case 'rsi':
        put1('rsi', full.rsi14);
        break;
      case 'macd':
        if (full.macd) {
          put('macd_linea', full.macd.macd);
          put('macd_senal', full.macd.signal);
          put('macd_histograma', full.macd.histogram);
        }
        break;
      case 'stochastic':
        if (full.stochastic) {
          put1('stochastic_k', full.stochastic.k);
          put1('stochastic_d', full.stochastic.d);
        }
        break;
      case 'stochasticRsi':
        put1('stochasticRsi', full.stochasticRsi);
        break;
      case 'cci':
        put1('cci', full.cci);
        break;
      case 'awesomeOscillator':
        put1('awesomeOscillator', full.awesomeOscillator);
        break;
      case 'atr':
        put('atr', full.atr14);
        break;
      case 'bollinger':
        if (full.bollinger) {
          put('bollinger_inferior', full.bollinger.lower);
          put('bollinger_media', full.bollinger.middle);
          put('bollinger_superior', full.bollinger.upper);
        }
        // CORRECCIÓN CONCEPTUAL FASE F: la POSICIÓN del precio en las bandas NO
        // es volatilidad. Se expone por separado:
        // - bollinger_bandwidth_pctil: ancho actual vs historial (mismo TF);
        // - bollinger_estado: 'contraccion'|'normal'|'expansion' (null = historial
        //   insuficiente → NO se afirma compresión);
        // - bollinger_squeeze: Bollinger dentro de Keltner (contracción, SIN dirección).
        put1('bollinger_bandwidth_pct', full.bollingerBandwidth !== null ? full.bollingerBandwidth * 100 : null);
        put1('bollinger_bandwidth_pctil', full.bollingerBandwidthPercentile);
        if (full.bollingerState) out['bollinger_estado'] = full.bollingerState;
        if (full.bollingerSqueeze === true) out['bollinger_squeeze'] = 'si';
        else if (full.bollingerSqueeze === false) out['bollinger_squeeze'] = 'no';
        break;
      case 'keltner':
        if (full.keltner) {
          put('keltner_inferior', full.keltner.lower);
          put('keltner_media', full.keltner.middle);
          put('keltner_superior', full.keltner.upper);
        }
        break;
      case 'donchian':
        if (full.donchian) {
          put('donchian_inferior', full.donchian.lower);
          put('donchian_superior', full.donchian.upper);
        }
        break;
      case 'hv':
        // HV anualizada según el timeframe real (certificación: no sqrt(365) universal).
        put1('hv', computeHistoricalVolatility(closes, 20, periodsPerYear(tf)));
        break;
      case 'adx':
        if (full.adx) {
          put1('adx', full.adx.adx);
          put1('di_positivo', full.adx.plusDi);
          put1('di_negativo', full.adx.minusDi);
        }
        break;
      case 'ichimoku':
        if (full.ichimoku) {
          put('ichimoku_tenkan', full.ichimoku.tenkan);
          put('ichimoku_kijun', full.ichimoku.kijun);
        }
        break;
      case 'parabolicSar':
        put('parabolicSar', full.parabolicSar);
        break;
      case 'superTrend':
        if (full.superTrend) {
          put('superTrend_nivel', full.superTrend.value);
          out['superTrend_direccion'] = full.superTrend.direction;
        }
        break;
      case 'pivotes':
        if (full.pivotPoints) {
          put('pivot_p', full.pivotPoints.pivot);
          put('pivot_r1', full.pivotPoints.r1);
          put('pivot_s1', full.pivotPoints.s1);
          put('pivot_r2', full.pivotPoints.r2);
          put('pivot_s2', full.pivotPoints.s2);
        }
        break;
      case 'fib':
        for (const lvl of ['0.236', '0.382', '0.5', '0.618', '0.786'] as const) {
          put(`fib_${lvl.replace('.', '_')}`, full.fibonacci[lvl]);
        }
        break;
      case 'vwap_sesion':
        put('vwap_sesion', computeSessionVWAP([...candles], { anchor: 'utc' }));
        break;
      case 'mfi':
        put1('mfi', full.mfi14);
        break;
      case 'williamsR':
        put1('williamsR', full.williamsR);
        break;
      case 'roc':
        put1('roc', full.roc10);
        break;
      case 'obv':
        put('obv', full.obv);
        break;
      case 'cmf':
        put1('cmf', full.chaikinMF);
        break;
      case 'accumulationDistribution':
        put('accumulationDistribution', full.accumulationDistribution);
        break;
      case 'fractals':
        if (full.fractals) {
          const { fractalHighs, fractalLows } = full.fractals;
          if (fractalHighs.length > 0) put('fractal_alto_reciente', fractalHighs[fractalHighs.length - 1]!);
          if (fractalLows.length > 0) put('fractal_bajo_reciente', fractalLows[fractalLows.length - 1]!);
        }
        break;
      default:
        break;
    }
  }
  return out;
}

/** Periodos por año según el timeframe (certificación de HV — ver indicators.ts). */
function periodsPerYear(tf: TfLabel): number {
  switch (tf) {
    case '1M': return 12;
    case '1W': return 52;
    case '1D': return 365;
    case '4H': return 365 * 6;
    case '1H': return 365 * 24;
    case '15m': return 365 * 24 * 4;
    case '5m': return 365 * 24 * 12;
    default: return 365;
  }
}
