import {
  INDICATORS_BY_LAYER,
  LAYER_BY_TF,
  type TfLabel,
} from '../config/timeframes.js';
import {
  computeAllIndicators,
  computeEMA,
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
      case 'sma50':
        put('sma50', full.sma50);
        break;
      case 'sma100':
        put('sma100', full.sma100);
        break;
      case 'sma200':
        put('sma200', full.sma200);
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
      case 'atr':
        put('atr', full.atr14);
        break;
      case 'bollinger':
        if (full.bollinger) {
          put('bollinger_inferior', full.bollinger.lower);
          put('bollinger_media', full.bollinger.middle);
          put('bollinger_superior', full.bollinger.upper);
        }
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
        }
        break;
      case 'fib':
        for (const lvl of ['0.382', '0.5', '0.618'] as const) {
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
      default:
        break;
    }
  }
  return out;
}
