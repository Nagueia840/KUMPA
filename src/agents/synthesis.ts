/**
 * CAPA DE SÍNTESIS ANALÍTICA (FASE F — "Ferrari a nafta").
 *
 * PROBLEMA REAL: el motor calcula ~34 indicadores, pero el LLM recibía el
 * subconjunto plano de cada capa sin estructura → la respuesta terminaba siendo
 * "RSI + SuperTrend + VWAP + comentario genérico".
 *
 * ESTA CAPA (determinística, sin LLM, sin duplicar el motor):
 *   34 indicadores → familias analíticas → confluencias/contradicciones
 *   → jerarquía multi-timeframe → escenarios → niveles + triggers + riesgo.
 *
 * REUTILIZA computeAllIndicators (el mismo motor certificado). NO recalcula
 * nada en el prompt: produce un bloque compacto "LECTURA ESTRUCTURADA" que se
 * inyecta como contexto adicional. NO es una lista de 34 números: es la lectura
 * ya razonada que el LLM debe integrar, refinar y convertir en lenguaje natural.
 *
 * PRINCIPIOS:
 * - Sin doble conteo: varias señales del mismo fenómeno NO son confirmaciones
 *   independientes. Cada familia vota UNA vez con su peso.
 * - Jerarquía: 1W/1D (régimen) > 4H/1H (estructura) > 15m/5m (ejecución).
 *   Una señal de 5m NO invalida un régimen semanal.
 * - Unidades: todos los niveles monetarios llevan quoteAsset. Osciladores sin
 *   unidad. Funding/premium en %.
 * - Interpretaciones calibradas: funding positivo ≠ "presión compradora"
 *   (longs pagan shorts); precio > VWAP ≠ "momentum confirmado" (es fortaleza
 *   relativa contextual).
 */

import type { MultiTfContext, MultiTfSymbolData, TfBlock } from '../utils/multitf.js';
import { LAYER_BY_TF, TF_ORDER, type TfLabel } from '../config/timeframes.js';

/** Dirección de una familia o lectura. */
export type Direction = 'alcista' | 'bajista' | 'neutral' | 'mixto' | 's/d';

/** Relación numérica precio ↔ nivel (calculada, NUNCA inferida por texto). */
export type PriceRelation = 'ABOVE' | 'BELOW' | 'AT';

/** Tolerancia relativa para considerar "AT" (0.05% del nivel). */
const AT_TOLERANCE = 0.0005;

/** Calcula la relación precio ↔ nivel numéricamente. */
export function priceRelation(price: number, level: number): PriceRelation {
  if (!Number.isFinite(price) || !Number.isFinite(level) || level === 0) return 'AT';
  const diff = (price - level) / Math.abs(level);
  if (diff > AT_TOLERANCE) return 'ABOVE';
  if (diff < -AT_TOLERANCE) return 'BELOW';
  return 'AT';
}

/** Hechos semánticos numéricos del TF (para contratos determinísticos). */
export interface NumericFacts {
  /** Relación precio vivo vs nivel de SuperTrend del TF (ABOVE/BELOW/AT). */
  priceVsSuperTrend: PriceRelation | null;
  /** Relación precio vivo vs VWAP del TF. */
  priceVsVwap: PriceRelation | null;
  /** Relación precio vivo vs S1 del TF (si existe). */
  priceVsS1: PriceRelation | null;
  /** Relación precio vivo vs R1 del TF (si existe). */
  priceVsR1: PriceRelation | null;
}

/**
 * F.3 — hecho relacional estructurado para el contrato numérico post-generación:
 * la narración final NO puede afirmar "arriba de X" si el hecho calculado es
 * BELOW (ni al revés). Se entrega al guard (validateNumericRelations).
 */
export interface RelationFact {
  /** Etiqueta legible del nivel ("VWAP 4H", "SuperTrend 1W", "S1 4H"). */
  label: string;
  /** Valor numérico del nivel (para matchear menciones en el texto). */
  value: number;
  /** Relación precio vivo ↔ nivel calculada (ABOVE/BELOW/AT). */
  relation: PriceRelation;
}

/** Lectura de una familia analítica en un timeframe. */
export interface FamilyReading {
  familia: string;
  /** Dirección global de la familia en ese TF. */
  direccion: Direction;
  /** Señales individuales que sustentan la dirección (con su dato). */
  senales: string[];
  /** Nº de señales a favor / en contra / neutras (transparencia, no doble conteo). */
  aFavor: number;
  enContra: number;
  neutras: number;
  /** Peso de la familia en la lectura global del TF (0-3). */
  peso: number;
}

/** Lectura de UN timeframe: familias + dirección global + confluencias. */
export interface TfReading {
  tf: TfLabel;
  capa: string;
  familias: FamilyReading[];
  /** Dirección global del TF (ponderada por familias y su peso). */
  direccion: Direction;
  /** Familias alineadas con la dirección global (confluencias). */
  confluencias: string[];
  /** Familias en contra de la dirección global (contradicciones). */
  contradicciones: string[];
  /** Niveles clave del TF con quoteAsset (soporte/resistencia). */
  niveles: string[];
  /** Explicación corta de la lectura (para el bloque). */
  resumen: string;
  /** Señales más relevantes para el bloque (no neutras, acotadas). */
  senalesRelevantes: string[];
  /** Hechos numéricos calculados (contratos determinísticos F.2). */
  numericFacts: NumericFacts;
  /** F.3 — hechos relacionales (label+valor+relación) para el guard post-generación. */
  relationFacts: RelationFact[];
  /**
   * SuperTrend del TF con representación LIVE vs CONFIRMED (F.2-A):
   * el estado confirmado proviene de velas CERRADAS; el precio vivo puede estar
   * del otro lado sin que el estado haya flipeado (requiere cierre que cruce).
   */
  superTrend?: {
    timeframe: string;
    confirmedState: 'alcista' | 'bajista';
    level: number;
    livePrice: number | undefined;
    liveRelationToLevel: PriceRelation;
    stateConfirmation: string;
  };
}

/** Cobertura de familias en la síntesis (F.2-E). */
export interface FamilyCoverage {
  trend: boolean;
  momentum: boolean;
  volume: boolean;
  volatility: boolean;
  structure: boolean;
  derivatives: boolean;
}

/** Lectura estructurada de TODO un símbolo. */
export interface SymbolSynthesis {
  symbol: string;
  quoteAsset: string;
  /** Lecturas por TF ordenadas de grueso a fino (jerarquía). */
  timeframes: TfReading[];
  /** Dirección de régimen (1W/1D si existen; si no, el TF de contexto más grueso). */
  regimen: Direction;
  /** Dirección de estructura (4H/1H). */
  estructura: Direction;
  /** Dirección de ejecución (15m/5m). */
  ejecucion: Direction;
  /** Contradicciones ENTRE capas (ej: régimen alcista + estructura bajista). */
  contradiccionesInterTf: string[];
  /** Confluencias a nivel símbolo (familias alineadas en el régimen). */
  confluenciasSimbolo: string[];
  /** Contradicciones a nivel símbolo (familias en conflicto en el régimen). */
  contradiccionesSimbolo: string[];
  /** Cobertura de familias materiales (F.2-E). */
  familyCoverage: FamilyCoverage;
  /** Lectura global sintetizada en una o dos frases. */
  lecturaGlobal: string;
}

/** Nivel con unidad (formato "2.450 USDT"). */
function money(v: number | null | undefined, qa: string): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${Math.round(v).toLocaleString('en-US')} ${qa}`;
}

function pct1(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return `${Math.round(v * 10) / 10}%`;
}

function idx1(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return String(Math.round(v * 10) / 10);
}

function tfWeight(tf: TfLabel): number {
  const capa = LAYER_BY_TF[tf];
  if (capa === 'contexto') return 3;
  if (capa === 'estructura') return 2;
  return 1;
}

function dirFromSenales(aFavor: number, enContra: number): Direction {
  if (aFavor === 0 && enContra === 0) return 'neutral';
  if (aFavor > enContra) return 'alcista';
  if (enContra > aFavor) return 'bajista';
  return 'mixto';
}

/** Ayudante: agrega una señal y cuenta a favor/en contra. */
interface SenalAcc {
  senales: string[];
  aFavor: number;
  enContra: number;
  neutras: number;
}
function pushSenal(acc: SenalAcc, s: string, dir: 'a' | 'c' | 'n'): void {
  acc.senales.push(s);
  if (dir === 'a') acc.aFavor++;
  else if (dir === 'c') acc.enContra++;
  else acc.neutras++;
}

/**
 * LEE la familia TENDENCIA desde los indicadores de un bloque.
 * Señales (sin doble conteo: medias + SuperTrend + ADX/DI + Ichimoku votan
 * juntas por la dirección, no cada media por separado).
 * F.2-A: la señal de SuperTrend distingue estado CONFIRMADO (vela cerrada) de
 * precio VIVO, y la relación se calcula numéricamente (priceRelation) — nunca
 * se afirma "precio bajo el nivel" si el precio vivo está por encima.
 */
function readTendencia(ind: Record<string, unknown>, qa: string, tf: TfLabel, precio?: number): FamilyReading {
  const acc: SenalAcc = { senales: [], aFavor: 0, enContra: 0, neutras: 0 };
  const stDir = ind['superTrend_direccion'];

  // SuperTrend: dirección canónica (up/down → alcista/bajista) + relación live.
  const stNivel = typeof ind['superTrend_nivel'] === 'number' ? (ind['superTrend_nivel'] as number) : undefined;
  const rel = stNivel !== undefined && precio !== undefined ? priceRelation(precio, stNivel) : null;
  if (stDir === 'up') {
    if (rel === 'BELOW' && stNivel !== undefined) {
      // Estado confirmado alcista pero precio vivo bajo el soporte: señal temprana.
      pushSenal(acc, `SuperTrend ${tf} confirmado alcista (soporte ${money(stNivel, qa)}), pero el precio vivo (${money(precio, qa)}) cotiza bajo el nivel — requiere confirmación de cierre`, 'n');
    } else {
      pushSenal(acc, `SuperTrend ${tf} alcista (soporte en ${money(stNivel, qa) ?? 's/d'})${rel === 'ABOVE' ? `; precio vivo por encima` : ''}`, 'a');
    }
  } else if (stDir === 'down') {
    if (rel === 'ABOVE' && stNivel !== undefined) {
      // CASO REAL v11: confirmed bearish, level 2459, live 2496.65 → ABOVE.
      pushSenal(acc, `SuperTrend ${tf} confirmado bajista (resistencia ${money(stNivel, qa)}), pero el precio vivo (${money(precio, qa)}) cotiza POR ENCIMA del nivel — un eventual cambio requiere confirmación del cierre`, 'n');
    } else {
      pushSenal(acc, `SuperTrend ${tf} bajista (resistencia en ${money(stNivel, qa) ?? 's/d'})${rel === 'BELOW' ? `; precio vivo por debajo` : ''}`, 'c');
    }
  } else {
    pushSenal(acc, `SuperTrend ${tf} s/d`, 'n');
  }

  // Medias: el precio vs el "paquete" de medias disponibles vota una vez.
  const medias: Array<[string, unknown]> = [
    ['ema9', ind['ema9']], ['ema20', ind['ema20']], ['sma20', ind['sma20']],
    ['sma50', ind['sma50']], ['sma100', ind['sma100']], ['sma200', ind['sma200']],
  ].filter(([, v]) => typeof v === 'number') as Array<[string, number]>;
  if (precio !== undefined && medias.length > 0) {
    const arriba = medias.filter(([, v]) => precio > (v as number)).length;
    const abajo = medias.length - arriba;
    if (arriba > abajo) pushSenal(acc, `precio ${tf} sobre ${arriba}/${medias.length} medias (${medias.map(([n]) => n).join(', ')})`, 'a');
    else if (abajo > arriba) pushSenal(acc, `precio ${tf} bajo ${abajo}/${medias.length} medias (${medias.map(([n]) => n).join(', ')})`, 'c');
    else pushSenal(acc, `precio ${tf} en el medio de las medias`, 'n');
  } else if (medias.length > 0) {
    pushSenal(acc, `medias ${tf} disponibles sin precio de referencia (${medias.map(([n]) => n).join(', ')})`, 'n');
  }

  // ADX: fuerza de tendencia; DI: dirección (ADX alto ≠ alcista automático:
  // mide fuerza; la dirección la dan DI+/DI− y la estructura).
  const adx = typeof ind['adx'] === 'number' ? (ind['adx'] as number) : undefined;
  const dPos = typeof ind['di_positivo'] === 'number' ? (ind['di_positivo'] as number) : undefined;
  const dNeg = typeof ind['di_negativo'] === 'number' ? (ind['di_negativo'] as number) : undefined;
  if (adx !== undefined && dPos !== undefined && dNeg !== undefined) {
    if (adx >= 25) {
      if (dPos > dNeg) pushSenal(acc, `ADX ${tf} ${idx1(adx)} (tendencia fuerte, DI+ > DI−)`, 'a');
      else pushSenal(acc, `ADX ${tf} ${idx1(adx)} (tendencia fuerte, DI− > DI+)`, 'c');
    } else if (adx >= 20) {
      pushSenal(acc, `ADX ${tf} ${idx1(adx)} (tendencia débil/arrancando)`, 'n');
    } else {
      pushSenal(acc, `ADX ${tf} ${idx1(adx)} (rango, sin tendencia clara)`, 'n');
    }
  }

  // Ichimoku: precio vs tenkan/kijun.
  const tenkan = typeof ind['ichimoku_tenkan'] === 'number' ? (ind['ichimoku_tenkan'] as number) : undefined;
  const kijun = typeof ind['ichimoku_kijun'] === 'number' ? (ind['ichimoku_kijun'] as number) : undefined;
  if (precio !== undefined && tenkan !== undefined && kijun !== undefined) {
    if (precio > tenkan && precio > kijun && tenkan > kijun) pushSenal(acc, `Ichimoku ${tf} alcista (precio > Tenkan > Kijun)`, 'a');
    else if (precio < tenkan && precio < kijun && tenkan < kijun) pushSenal(acc, `Ichimoku ${tf} bajista (precio < Tenkan < Kijun)`, 'c');
    else pushSenal(acc, `Ichimoku ${tf} mixto (nube/orden de líneas sin alinear)`, 'n');
  }

  return {
    familia: 'TENDENCIA', direccion: dirFromSenales(acc.aFavor, acc.enContra),
    senales: acc.senales, aFavor: acc.aFavor, enContra: acc.enContra, neutras: acc.neutras,
    peso: 3,
  };
}

/**
 * Lee la familia MOMENTUM (RSI + MACD + Stochastic + CCI + W%R + ROC + MFI).
 * CALIBRACIÓN (FASE F cierre): un oscilador en zona extrema NO es señal
 * operativa por sí solo — RSI > 70 no es "vender" ni Stochastic en sobrecompra
 * es "comprar". Las zonas extremas se reportan como SOBREEXTENSIÓN (advertencia,
 * voto neutral) y solo el rango intermedio vota dirección. La conclusión
 * operativa nace de la CONFLUENCIA entre familias.
 */
function readMomentum(ind: Record<string, unknown>, tf: TfLabel): FamilyReading {
  const acc: SenalAcc = { senales: [], aFavor: 0, enContra: 0, neutras: 0 };
  const rsi = typeof ind['rsi'] === 'number' ? (ind['rsi'] as number) : undefined;
  if (rsi !== undefined) {
    if (rsi > 70) pushSenal(acc, `RSI ${tf} ${idx1(rsi)} (zona de sobreextensión alcista — no es señal de venta por sí solo)`, 'n');
    else if (rsi >= 55) pushSenal(acc, `RSI ${tf} ${idx1(rsi)} (momentum positivo)`, 'a');
    else if (rsi >= 45) pushSenal(acc, `RSI ${tf} ${idx1(rsi)} (neutral)`, 'n');
    else if (rsi >= 30) pushSenal(acc, `RSI ${tf} ${idx1(rsi)} (momentum negativo)`, 'c');
    else pushSenal(acc, `RSI ${tf} ${idx1(rsi)} (zona de sobreextensión bajista — no es señal de compra por sí solo)`, 'n');
  }
  const macdHist = typeof ind['macd_histograma'] === 'number' ? (ind['macd_histograma'] as number) : undefined;
  const macdLinea = typeof ind['macd_linea'] === 'number' ? (ind['macd_linea'] as number) : undefined;
  const macdSenal = typeof ind['macd_senal'] === 'number' ? (ind['macd_senal'] as number) : undefined;
  if (macdHist !== undefined) {
    if (macdHist > 0) pushSenal(acc, `MACD ${tf} histograma positivo (${macdHist >= 1000 ? (macdHist / 1000).toFixed(1) + 'k' : macdHist.toFixed(0)})`, 'a');
    else if (macdHist < 0) pushSenal(acc, `MACD ${tf} histograma negativo (${macdHist <= -1000 ? (macdHist / 1000).toFixed(1) + 'k' : macdHist.toFixed(0)})`, 'c');
    else pushSenal(acc, `MACD ${tf} histograma en cero`, 'n');
  }
  if (macdLinea !== undefined && macdSenal !== undefined) {
    if (macdLinea > macdSenal) pushSenal(acc, `MACD ${tf} línea sobre señal (cruce alcista vigente)`, 'a');
    else if (macdLinea < macdSenal) pushSenal(acc, `MACD ${tf} línea bajo señal (cruce bajista vigente)`, 'c');
  }
  const stochK = typeof ind['stochastic_k'] === 'number' ? (ind['stochastic_k'] as number) : undefined;
  if (stochK !== undefined) {
    if (stochK >= 80) pushSenal(acc, `Stochastic ${tf} %K ${idx1(stochK)} (zona de sobreextensión — no es señal por sí solo)`, 'n');
    else if (stochK >= 55) pushSenal(acc, `Stochastic ${tf} %K ${idx1(stochK)} (momentum positivo)`, 'a');
    else if (stochK >= 45) pushSenal(acc, `Stochastic ${tf} %K ${idx1(stochK)} (neutral)`, 'n');
    else if (stochK >= 20) pushSenal(acc, `Stochastic ${tf} %K ${idx1(stochK)} (momentum negativo)`, 'c');
    else pushSenal(acc, `Stochastic ${tf} %K ${idx1(stochK)} (zona de sobreextensión bajista — no es señal por sí solo)`, 'n');
  }
  const cci = typeof ind['cci'] === 'number' ? (ind['cci'] as number) : undefined;
  if (cci !== undefined) {
    if (cci > 200) pushSenal(acc, `CCI ${tf} ${idx1(cci)} (zona extrema — posible agotamiento o continuación; requiere confluencia)`, 'n');
    else if (cci > 100) pushSenal(acc, `CCI ${tf} ${idx1(cci)} (impulso alcista fuerte)`, 'a');
    else if (cci > 0) pushSenal(acc, `CCI ${tf} ${idx1(cci)} (leve sesgo alcista)`, 'a');
    else if (cci > -100) pushSenal(acc, `CCI ${tf} ${idx1(cci)} (leve sesgo bajista)`, 'c');
    else if (cci > -200) pushSenal(acc, `CCI ${tf} ${idx1(cci)} (impulso bajista fuerte)`, 'c');
    else pushSenal(acc, `CCI ${tf} ${idx1(cci)} (zona extrema — posible agotamiento o continuación; requiere confluencia)`, 'n');
  }
  const wR = typeof ind['williamsR'] === 'number' ? (ind['williamsR'] as number) : undefined;
  if (wR !== undefined) {
    if (wR > -20) pushSenal(acc, `Williams %R ${tf} ${idx1(wR)} (zona de sobreextensión alcista — no es señal por sí solo)`, 'n');
    else if (wR > -50) pushSenal(acc, `Williams %R ${tf} ${idx1(wR)} (momentum positivo)`, 'a');
    else if (wR > -80) pushSenal(acc, `Williams %R ${tf} ${idx1(wR)} (momentum negativo)`, 'c');
    else pushSenal(acc, `Williams %R ${tf} ${idx1(wR)} (zona de sobreextensión bajista — no es señal por sí solo)`, 'n');
  }
  const roc = typeof ind['roc'] === 'number' ? (ind['roc'] as number) : undefined;
  if (roc !== undefined) {
    if (roc > 0) pushSenal(acc, `ROC ${tf} ${idx1(roc)}% (momentum positivo)`, 'a');
    else if (roc < 0) pushSenal(acc, `ROC ${tf} ${idx1(roc)}% (momentum negativo)`, 'c');
  }
  // MFI: flujo monetario. CALIBRACIÓN: MFI alto/bajo describe flujo + posible
  // sobreextensión; NO es señal de compra/venta ni confirmación automática.
  const mfi = typeof ind['mfi'] === 'number' ? (ind['mfi'] as number) : undefined;
  if (mfi !== undefined) {
    if (mfi >= 60) pushSenal(acc, `MFI ${tf} ${idx1(mfi)}: flujo monetario positivo y elevado; cerca de zona tradicionalmente extrema — no constituye por sí solo confirmación de compra`, 'n');
    else if (mfi <= 40) pushSenal(acc, `MFI ${tf} ${idx1(mfi)}: flujo monetario negativo y deprimido; cerca de zona tradicionalmente extrema — no constituye por sí solo señal de venta`, 'n');
    else pushSenal(acc, `MFI ${tf} ${idx1(mfi)} (flujo monetario neutral)`, 'n');
  }
  return {
    familia: 'MOMENTUM', direccion: dirFromSenales(acc.aFavor, acc.enContra),
    senales: acc.senales, aFavor: acc.aFavor, enContra: acc.enContra, neutras: acc.neutras,
    peso: 3,
  };
}

/** Lee la familia VOLUMEN (VWAP + OBV + CMF + A/D). Interpretación calibrada:
 *  precio vs VWAP es fortaleza relativa CONTEXTUAL, no confirmación por sí sola.
 *  OBV y A/D en valor ABSOLUTO no votan dirección (su nivel depende del inicio
 *  de la serie); solo CMF (normalizado) y la posición relativa al VWAP aportan
 *  voto, y siempre como flujo/contexto, no como señal operativa aislada. */
function readVolumen(ind: Record<string, unknown>, qa: string, tf: TfLabel, precio?: number): FamilyReading {
  const acc: SenalAcc = { senales: [], aFavor: 0, enContra: 0, neutras: 0 };
  const vwap = (typeof ind['vwap_sesion'] === 'number' ? ind['vwap_sesion'] : undefined) ??
    (typeof ind['vwap_semanal'] === 'number' ? ind['vwap_semanal'] : undefined);
  if (precio !== undefined && typeof vwap === 'number') {
    if (precio > vwap) pushSenal(acc, `precio ${money(precio, qa)} sobre VWAP ${tf} ${money(vwap, qa)} (fortaleza relativa contextual)`, 'a');
    else if (precio < vwap) pushSenal(acc, `precio ${money(precio, qa)} bajo VWAP ${tf} ${money(vwap, qa)} (debilidad relativa contextual)`, 'c');
    else pushSenal(acc, `precio ${tf} en VWAP`, 'n');
  } else if (typeof vwap === 'number') {
    pushSenal(acc, `VWAP ${tf} ${money(vwap, qa)} (sin precio de referencia)`, 'n');
  }
  const obv = typeof ind['obv'] === 'number' ? (ind['obv'] as number) : undefined;
  if (obv !== undefined) {
    // OBV absoluto: nivel acumulado; la DIRECCIÓN de la pendiente es lo relevante
    // y no está disponible en el snapshot → se reporta sin voto direccional.
    pushSenal(acc, `OBV ${tf} acumulado ${obv >= 0 ? '' : '−'}${Math.abs(obv) >= 1e6 ? (Math.abs(obv) / 1e6).toFixed(1) + 'M' : Math.abs(obv).toFixed(0)} (nivel; la pendiente define la lectura — sin voto direccional propio)`, 'n');
  }
  const cmf = typeof ind['cmf'] === 'number' ? (ind['cmf'] as number) : undefined;
  if (cmf !== undefined) {
    if (cmf > 0.05) pushSenal(acc, `CMF ${tf} ${cmf.toFixed(2)} (acumulación)`, 'a');
    else if (cmf < -0.05) pushSenal(acc, `CMF ${tf} ${cmf.toFixed(2)} (distribución)`, 'c');
    else pushSenal(acc, `CMF ${tf} ${cmf.toFixed(2)} (flujo neutral)`, 'n');
  }
  const ad = typeof ind['accumulationDistribution'] === 'number' ? (ind['accumulationDistribution'] as number) : undefined;
  if (ad !== undefined) {
    // A/D absoluto: igual que OBV, el nivel no vota; se reporta descriptivo.
    pushSenal(acc, `A/D ${tf} acumulado ${ad >= 0 ? '' : '−'}${Math.abs(ad) >= 1e6 ? (Math.abs(ad) / 1e6).toFixed(1) + 'M' : Math.abs(ad).toFixed(0)} (nivel; la pendiente define la lectura — sin voto direccional propio)`, 'n');
  }
  return {
    familia: 'VOLUMEN', direccion: dirFromSenales(acc.aFavor, acc.enContra),
    senales: acc.senales, aFavor: acc.aFavor, enContra: acc.enContra, neutras: acc.neutras,
    peso: 2,
  };
}

/**
 * Lee la familia VOLATILIDAD (ATR + Bollinger + Keltner + Donchian + HV).
 * CORRECCIÓN CONCEPTUAL (FASE F): la POSICIÓN del precio dentro de las bandas
 * NO determina compresión. Se separan dos conceptos:
 *  A) POSICIÓN del precio (banda sup/media/inf) — descriptiva, SIN voto
 *     direccional y SIN implicar sobreventa/sobrecompra ni breakout.
 *  B) ANCHO DE BANDAS = Bollinger Bandwidth (upper−lower)/middle, comparado
 *     contra su HISTORIAL del mismo timeframe (percentil): contracción / normal
 *     / expansión. Historial insuficiente → NO DISPONIBLE (no se afirma nada).
 *  C) SQUEEZE (Bollinger dentro de Keltner): contracción de volatilidad que
 *     puede preceder expansión — NUNCA predice dirección.
 *  D) Breakout de banda: tocar/cerrar fuera de la banda NO es señal operativa
 *     automática; requiere confirmación de precio/estructura/volumen.
 */
function readVolatilidad(ind: Record<string, unknown>, qa: string, precio?: number): FamilyReading {
  const acc: SenalAcc = { senales: [], aFavor: 0, enContra: 0, neutras: 0 };
  const atr = typeof ind['atr'] === 'number' ? (ind['atr'] as number) : undefined;
  if (atr !== undefined && precio !== undefined && precio > 0) {
    const atrPct = (atr / precio) * 100;
    pushSenal(acc, `ATR ${money(atr, qa)} (${pct1(atrPct)} del precio)`, 'n');
  } else if (atr !== undefined) {
    pushSenal(acc, `ATR ${money(atr, qa)}`, 'n');
  }

  // ── A) POSICIÓN del precio (descriptiva, sin voto direccional) ─────────────
  const bbUp = typeof ind['bollinger_superior'] === 'number' ? (ind['bollinger_superior'] as number) : undefined;
  const bbLo = typeof ind['bollinger_inferior'] === 'number' ? (ind['bollinger_inferior'] as number) : undefined;
  const bbMid = typeof ind['bollinger_media'] === 'number' ? (ind['bollinger_media'] as number) : undefined;
  if (precio !== undefined && bbUp !== undefined && bbLo !== undefined && bbUp > bbLo) {
    const pos = (precio - bbLo) / (bbUp - bbLo); // 0 = banda inf, 1 = banda sup
    if (pos >= 0.98) pushSenal(acc, `precio tocando/sobre banda superior de Bollinger (${money(bbUp, qa)}) — POSICIÓN, no breakout confirmado ni sobrecompra automática`, 'n');
    else if (pos <= 0.02) pushSenal(acc, `precio tocando/sobre banda inferior de Bollinger (${money(bbLo, qa)}) — POSICIÓN, no sobreventa automática`, 'n');
    else if (pos >= 0.85) pushSenal(acc, `precio próximo a banda superior de Bollinger (${money(bbUp, qa)})`, 'n');
    else if (pos <= 0.15) pushSenal(acc, `precio próximo a banda inferior de Bollinger (${money(bbLo, qa)})`, 'n');
    else if (pos >= 0.45 && pos <= 0.55) pushSenal(acc, 'precio en la media de Bollinger', 'n');
    else pushSenal(acc, pos > 0.5 ? 'precio en mitad superior de Bollinger' : 'precio en mitad inferior de Bollinger', 'n');
  } else if (bbMid !== undefined) {
    pushSenal(acc, `Bollinger media ${money(bbMid, qa)}`, 'n');
  }

  // ── B) ANCHO DE BANDAS = volatilidad (bandwidth vs historial) ──────────────
  const bwPct = typeof ind['bollinger_bandwidth_pct'] === 'number' ? (ind['bollinger_bandwidth_pct'] as number) : undefined;
  const bwPctil = typeof ind['bollinger_bandwidth_pctil'] === 'number' ? (ind['bollinger_bandwidth_pctil'] as number) : undefined;
  const estado = ind['bollinger_estado'];
  if (estado === 'contraccion') {
    pushSenal(acc, `bandas en CONTRACCIÓN (bandwidth ${bwPct !== undefined ? pct1(bwPct) : 's/d'}, percentil ${bwPctil !== undefined ? Math.round(bwPctil) + '%' : 's/d'}) — volatilidad comprimida; no implica dirección`, 'n');
  } else if (estado === 'expansion') {
    pushSenal(acc, `bandas en EXPANSIÓN (bandwidth ${bwPct !== undefined ? pct1(bwPct) : 's/d'}, percentil ${bwPctil !== undefined ? Math.round(bwPctil) + '%' : 's/d'}) — volatilidad ampliándose`, 'n');
  } else if (estado === 'normal') {
    pushSenal(acc, `bandas NORMALES (bandwidth ${bwPct !== undefined ? pct1(bwPct) : 's/d'}, percentil ${bwPctil !== undefined ? Math.round(bwPctil) + '%' : 's/d'})`, 'n');
  } else {
    pushSenal(acc, 'estado de volatilidad NO DISPONIBLE (historial de bandwidth insuficiente) — no se afirma compresión', 'n');
  }

  // ── C) SQUEEZE (Bollinger dentro de Keltner) — contracción, sin dirección ──
  const squeeze = ind['bollinger_squeeze'];
  if (squeeze === 'si') {
    pushSenal(acc, 'SQUEEZE Bollinger/Keltner (contracción de volatilidad: puede preceder expansión, NO predice dirección; requiere ruptura/confirmación)', 'n');
  }

  // ── Niveles de volatilidad (descriptivos) ──────────────────────────────────
  const kelUp = typeof ind['keltner_superior'] === 'number' ? (ind['keltner_superior'] as number) : undefined;
  const kelLo = typeof ind['keltner_inferior'] === 'number' ? (ind['keltner_inferior'] as number) : undefined;
  if (kelUp !== undefined && kelLo !== undefined) {
    pushSenal(acc, `Keltner ${money(kelLo, qa)}–${money(kelUp, qa)}`, 'n');
  }
  const donUp = typeof ind['donchian_superior'] === 'number' ? (ind['donchian_superior'] as number) : undefined;
  const donLo = typeof ind['donchian_inferior'] === 'number' ? (ind['donchian_inferior'] as number) : undefined;
  if (donUp !== undefined && donLo !== undefined) {
    pushSenal(acc, `Donchian ${money(donLo, qa)}–${money(donUp, qa)}`, 'n');
  }
  const hv = typeof ind['hv'] === 'number' ? (ind['hv'] as number) : undefined;
  if (hv !== undefined) {
    if (hv >= 60) pushSenal(acc, `Volatilidad histórica ${pct1(hv)} (alta)`, 'n');
    else if (hv <= 30) pushSenal(acc, `Volatilidad histórica ${pct1(hv)} (baja)`, 'n');
    else pushSenal(acc, `Volatilidad histórica ${pct1(hv)} (moderada)`, 'n');
  }
  return {
    familia: 'VOLATILIDAD', direccion: 'neutral', // la volatilidad NO es direccional
    senales: acc.senales, aFavor: 0, enContra: 0, neutras: acc.senales.length,
    peso: 1,
  };
}

/** Lee la familia ESTRUCTURA (pivots + fib + OHLC relevantes).
 *  CALIBRACIÓN: pivots/fib son NIVELES PROYECTADOS, no soporte/resistencia
 *  confirmados sin reacción del precio. La posición relativa se reporta como
 *  contexto estructural (voto suave) pero la señal lo aclara. */
function readEstructura(ind: Record<string, unknown>, qa: string, tf: TfLabel, precio?: number): FamilyReading {
  const acc: SenalAcc = { senales: [], aFavor: 0, enContra: 0, neutras: 0 };
  const pivotP = typeof ind['pivot_p'] === 'number' ? (ind['pivot_p'] as number) : undefined;
  const r1 = typeof ind['pivot_r1'] === 'number' ? (ind['pivot_r1'] as number) : undefined;
  const s1 = typeof ind['pivot_s1'] === 'number' ? (ind['pivot_s1'] as number) : undefined;
  const r2 = typeof ind['pivot_r2'] === 'number' ? (ind['pivot_r2'] as number) : undefined;
  const s2 = typeof ind['pivot_s2'] === 'number' ? (ind['pivot_s2'] as number) : undefined;
  if (pivotP !== undefined) {
    const niveles = [
      money(s2, qa) ? `S2 ${tf}: ${money(s2, qa)}` : null,
      money(s1, qa) ? `S1 ${tf}: ${money(s1, qa)}` : null,
      money(pivotP, qa) ? `P ${tf}: ${money(pivotP, qa)}` : null,
      money(r1, qa) ? `R1 ${tf}: ${money(r1, qa)}` : null,
      money(r2, qa) ? `R2 ${tf}: ${money(r2, qa)}` : null,
    ].filter(Boolean).join(' · ');
    pushSenal(acc, `Pivots ${tf}: ${niveles}`, 'n');
    if (precio !== undefined) {
      if (r1 !== undefined && precio > r1) pushSenal(acc, `precio ${tf} sobre R1 (${money(r1, qa)}) — nivel proyectado, requiere reacción del precio`, 'a');
      else if (s1 !== undefined && precio < s1) pushSenal(acc, `precio ${tf} bajo S1 (${money(s1, qa)}) — nivel proyectado, requiere reacción del precio`, 'c');
      else if (pivotP !== undefined) {
        if (precio > pivotP) pushSenal(acc, `precio ${tf} sobre pivote (${money(pivotP, qa)})`, 'a');
        else pushSenal(acc, `precio ${tf} bajo pivote (${money(pivotP, qa)})`, 'c');
      }
    }
  }
  const fib382 = typeof ind['fib_0_382'] === 'number' ? (ind['fib_0_382'] as number) : undefined;
  const fib50 = typeof ind['fib_0_5'] === 'number' ? (ind['fib_0_5'] as number) : undefined;
  const fib618 = typeof ind['fib_0_618'] === 'number' ? (ind['fib_0_618'] as number) : undefined;
  if (fib382 !== undefined || fib50 !== undefined || fib618 !== undefined) {
    const fibs = [
      money(fib382, qa) ? `0.382 ${tf}: ${money(fib382, qa)}` : null,
      money(fib50, qa) ? `0.5 ${tf}: ${money(fib50, qa)}` : null,
      money(fib618, qa) ? `0.618 ${tf}: ${money(fib618, qa)}` : null,
    ].filter(Boolean).join(' · ');
    // Fibonacci: niveles de referencia, NO soporte/resistencia confirmados sin
    // reacción del precio (sin voto direccional propio).
    pushSenal(acc, `Fib ${tf}: ${fibs} (niveles de referencia, no confirmados sin reacción del precio)`, 'n');
  }
  const stRol = ind['superTrend_rol'];
  const stNivel = typeof ind['superTrend_nivel'] === 'number' ? (ind['superTrend_nivel'] as number) : undefined;
  if (stRol === 'soporte') pushSenal(acc, `SuperTrend ${tf} actuando como soporte (${money(stNivel, qa) ?? 's/d'})`, 'n');
  else if (stRol === 'resistencia') pushSenal(acc, `SuperTrend ${tf} actuando como resistencia (${money(stNivel, qa) ?? 's/d'})`, 'n');
  return {
    familia: 'ESTRUCTURA', direccion: dirFromSenales(acc.aFavor, acc.enContra),
    senales: acc.senales, aFavor: acc.aFavor, enContra: acc.enContra, neutras: acc.neutras,
    peso: 2,
  };
}

/** Lee la familia DERIVADOS desde el snapshot del símbolo (1 nivel, sin TF). */
export function readDerivados(s: MultiTfSymbolData): FamilyReading {
  const acc: SenalAcc = { senales: [], aFavor: 0, enContra: 0, neutras: 0 };
  const funding = s.funding_pct;
  if (funding) {
    const f = Number(funding.replace('%', '').replace(',', '.'));
    if (Number.isFinite(f)) {
      // INTERPRETACIÓN CALIBRADA (defecto E): funding positivo = longs pagan shorts.
      // Puede sugerir sesgo long, pero NO demuestra presión compradora.
      if (f > 0.01) pushSenal(acc, `funding ${funding} (positivo: longs pagan shorts — sugiere sesgo long, NO presión compradora demostrada)`, 'a');
      else if (f < -0.01) pushSenal(acc, `funding ${funding} (negativo: shorts pagan longs — sugiere sesgo short, NO presión vendedora demostrada)`, 'c');
      else pushSenal(acc, `funding ${funding} (neutral)`, 'n');
    }
  }
  return {
    familia: 'DERIVADOS', direccion: dirFromSenales(acc.aFavor, acc.enContra),
    senales: acc.senales, aFavor: acc.aFavor, enContra: acc.enContra, neutras: acc.neutras,
    peso: 2,
  };
}

/** Arma la lectura de UN timeframe a partir del bloque y el precio del símbolo. */
export function buildTfReading(tf: TfLabel, block: TfBlock, precio?: number, quoteAsset = 'USDT'): TfReading | null {
  if (!block.valido) return null;
  const ind = block.indicadores ?? {};
  const familias = [
    readTendencia(ind, quoteAsset, tf, precio),
    readMomentum(ind, tf),
    readVolumen(ind, quoteAsset, tf, precio),
    readVolatilidad(ind, quoteAsset, precio),
    readEstructura(ind, quoteAsset, tf, precio),
  ];
  // Dirección global ponderada: solo familias direccionales cuentan.
  let score = 0;
  let pesoTotal = 0;
  const confluencias: string[] = [];
  const contradicciones: string[] = [];
  for (const f of familias) {
    if (f.direccion === 'neutral' || f.direccion === 's/d') continue;
    const voto = f.direccion === 'alcista' ? f.peso : -f.peso;
    score += voto;
    pesoTotal += f.peso;
    if (f.direccion === 'alcista') confluencias.push(f.familia);
    else if (f.direccion === 'bajista') contradicciones.push(f.familia);
  }
  const direccion: Direction =
    pesoTotal === 0 ? 'neutral' : score > 0 ? 'alcista' : score < 0 ? 'bajista' : 'mixto';
  // Si hay familias en ambos bandos → la lectura es mixta aunque domine una.
  const global: Direction =
    confluencias.length > 0 && contradicciones.length > 0 ? 'mixto' : direccion;

  // Niveles clave multi-TF: cada nivel conserva INEQUÍVOCAMENTE su timeframe
  // (formato "R1 1H: 2,589 USDT"). Nunca mezclar niveles de distintos TF como
  // si fueran equivalentes.
  const niveles: string[] = [];
  const stNivel = typeof ind['superTrend_nivel'] === 'number' ? (ind['superTrend_nivel'] as number) : undefined;
  if (stNivel !== undefined) {
    if (ind['superTrend_rol'] === 'soporte') niveles.push(`Soporte SuperTrend ${tf}: ${money(stNivel, quoteAsset)}`);
    else if (ind['superTrend_rol'] === 'resistencia') niveles.push(`Resistencia SuperTrend ${tf}: ${money(stNivel, quoteAsset)}`);
  }
  for (const key of ['pivot_s1', 'pivot_s2', 'pivot_r1', 'pivot_r2']) {
    const v = typeof ind[key] === 'number' ? (ind[key] as number) : undefined;
    if (v !== undefined) {
      const label = key === 'pivot_s1' ? 'S1' : key === 'pivot_s2' ? 'S2' : key === 'pivot_r1' ? 'R1' : 'R2';
      niveles.push(`${label} ${tf}: ${money(v, quoteAsset)}`);
    }
  }
  for (const key of ['bollinger_inferior', 'bollinger_superior']) {
    const v = typeof ind[key] === 'number' ? (ind[key] as number) : undefined;
    if (v !== undefined) niveles.push(`${key === 'bollinger_inferior' ? 'Banda inf' : 'Banda sup'} ${tf}: ${money(v, quoteAsset)}`);
  }
  for (const key of ['fib_0_382', 'fib_0_5', 'fib_0_618']) {
    const v = typeof ind[key] === 'number' ? (ind[key] as number) : undefined;
    if (v !== undefined) niveles.push(`Fib ${key.replace('fib_0_', '0.').replace('_', '')} ${tf}: ${money(v, quoteAsset)}`);
  }
  // VWAP con su timeframe (nivel operativo inequívoco).
  const vwap = (typeof ind['vwap_sesion'] === 'number' ? ind['vwap_sesion'] : undefined) ??
    (typeof ind['vwap_semanal'] === 'number' ? ind['vwap_semanal'] : undefined);
  if (typeof vwap === 'number') niveles.push(`VWAP ${tf}: ${money(vwap, quoteAsset)}`);

  const resumen = `TF ${tf} (${LAYER_BY_TF[tf]}): ${global} — ${confluencias.length > 0 ? `a favor: ${confluencias.join(', ')}` : 'sin confluencias'}` +
    (contradicciones.length > 0 ? `; en contra: ${contradicciones.join(', ')}` : '');

  // Señales relevantes — SELECCIÓN DETERMINÍSTICA POR FAMILIA (FASE F.1):
  // se toma 1-2 observaciones útiles de CADA familia con datos, sin filtrar por
  // palabras clave ("alcista/bajista/sobre/bajo" sesgaba a TENDENCIA/MOMENTUM y
  // excluía VOLUMEN/VOLATILIDAD/ESTRUCTURA). No se rellena por cantidad: si una
  // familia no aporta, no se incluye. Máx ~10 por TF para no inflar el prompt.
  const senalesRelevantes: string[] = [];
  const MAX_POR_FAMILIA = 2;
  const MAX_TOTAL = 10;
  for (const f of familias) {
    if (f.senales.length === 0) continue; // familia sin datos → no aporta
    // Prioridad: conclusiones direccionales/estado primero, descriptivas después.
    const orden = [...f.senales].sort((a, b) => rankSenal(b) - rankSenal(a));
    for (const s of orden) {
      if (senalesRelevantes.length >= MAX_TOTAL) break;
      if (senalesRelevantes.filter((x) => x === s).length > 0) continue;
      senalesRelevantes.push(s);
      if (senalesRelevantes.filter((x) => f.senales.includes(x)).length >= MAX_POR_FAMILIA) break;
    }
    if (senalesRelevantes.length >= MAX_TOTAL) break;
  }

  // F.2-A/J — HECHOS NUMÉRICOS calculados ANTES (nunca inferidos por texto):
  // relación precio vivo vs SuperTrend / VWAP / S1 / R1. Se entregan como
  // facts estructurados para que la respuesta final no genere contradicciones.
  const numericFacts: NumericFacts = {
    priceVsSuperTrend: stNivel !== undefined && precio !== undefined ? priceRelation(precio, stNivel) : null,
    priceVsVwap: typeof vwap === 'number' && precio !== undefined ? priceRelation(precio, vwap) : null,
    priceVsS1: (typeof ind['pivot_s1'] === 'number' && precio !== undefined) ? priceRelation(precio, ind['pivot_s1'] as number) : null,
    priceVsR1: (typeof ind['pivot_r1'] === 'number' && precio !== undefined) ? priceRelation(precio, ind['pivot_r1'] as number) : null,
  };

  // SuperTrend LIVE vs CONFIRMED (F.2-A): estado confirmado (velas cerradas) +
  // relación del precio vivo. stateConfirmation documenta que el flip requiere
  // cierre de vela.
  const superTrend =
    stNivel !== undefined && (ind['superTrend_direccion'] === 'up' || ind['superTrend_direccion'] === 'down')
      ? {
          timeframe: tf,
          confirmedState: (ind['superTrend_direccion'] === 'up' ? 'alcista' : 'bajista') as 'alcista' | 'bajista',
          level: stNivel,
          livePrice: precio,
          liveRelationToLevel: numericFacts.priceVsSuperTrend ?? 'AT',
          stateConfirmation:
            'estado confirmado por velas CERRADAS; el flip requiere que el cierre de una vela cruce la banda correspondiente',
        }
      : undefined;

  // F.3 — hechos relacionales estructurados (para el contrato numérico).
  const relationFacts: RelationFact[] = [];
  if (stNivel !== undefined && precio !== undefined && numericFacts.priceVsSuperTrend) {
    relationFacts.push({ label: `SuperTrend ${tf}`, value: stNivel, relation: numericFacts.priceVsSuperTrend });
  }
  if (typeof vwap === 'number' && precio !== undefined && numericFacts.priceVsVwap) {
    relationFacts.push({ label: `VWAP ${tf}`, value: vwap, relation: numericFacts.priceVsVwap });
  }
  if (typeof ind['pivot_s1'] === 'number' && precio !== undefined && numericFacts.priceVsS1) {
    relationFacts.push({ label: `S1 ${tf}`, value: ind['pivot_s1'] as number, relation: numericFacts.priceVsS1 });
  }
  if (typeof ind['pivot_r1'] === 'number' && precio !== undefined && numericFacts.priceVsR1) {
    relationFacts.push({ label: `R1 ${tf}`, value: ind['pivot_r1'] as number, relation: numericFacts.priceVsR1 });
  }

  return {
    tf, capa: LAYER_BY_TF[tf], familias, direccion: global,
    confluencias, contradicciones, niveles, resumen, senalesRelevantes,
    numericFacts, relationFacts, superTrend,
  };
}

/**
 * Ranking de relevancia de una señal para la síntesis (NO excluye por palabras:
 * solo ordena para priorizar conclusiones con dirección/estado sobre las
 * puramente descriptivas cuando hay que recortar a MAX_POR_FAMILIA).
 */
function rankSenal(s: string): number {
  let r = 0;
  if (/alcista|bajista|acumulaci[oó]n|distribuci[oó]n|contracci[oó]n|expansi[oó]n|squeeze|sobreextensi[oó]n/.test(s)) r += 3;
  if (/fortaleza relativa|debilidad relativa|momentum positivo|momentum negativo/.test(s)) r += 2;
  if (/USDT|USD|USDC|%/.test(s)) r += 1;
  return r;
}

/** Clasifica la dirección de una capa según sus lecturas. */
function capaDirection(readings: TfReading[]): Direction {
  if (readings.length === 0) return 's/d';
  let score = 0;
  let peso = 0;
  for (const r of readings) {
    const voto = r.direccion === 'alcista' ? 1 : r.direccion === 'bajista' ? -1 : 0;
    score += voto * tfWeight(r.tf);
    peso += tfWeight(r.tf);
  }
  if (peso === 0) return 's/d';
  if (score > 0) return 'alcista';
  if (score < 0) return 'bajista';
  return 'mixto';
}

/**
 * SÍNTESIS COMPLETA de un símbolo: lee todos los TFs, ordena por jerarquía,
 * deriva régimen/estructura/ejecución, contradicciones entre capas y lectura
 * global. Determinístico y testeable.
 */
export function buildSymbolSynthesis(s: MultiTfSymbolData): SymbolSynthesis | null {
  if (!s.valido) return null;
  const qa = s.quoteAsset ?? 'USDT';
  const precio = typeof s.precio === 'number' ? s.precio : undefined;
  const tfs = (Object.keys(s.timeframes ?? {}) as TfLabel[])
    .filter((tf) => TF_ORDER.includes(tf))
    .sort((a, b) => TF_ORDER.indexOf(a) - TF_ORDER.indexOf(b));

  const readings: TfReading[] = [];
  for (const tf of tfs) {
    const block = s.timeframes?.[tf];
    if (!block) continue;
    const r = buildTfReading(tf, block, precio, qa);
    if (r) readings.push(r);
  }
  if (readings.length === 0) return null;

  const deCapa = (capa: string) => readings.filter((r) => r.capa === capa);
  const regimen = capaDirection(deCapa('contexto'));
  const estructura = capaDirection(deCapa('estructura'));
  const ejecucion = capaDirection(deCapa('ejecucion'));

  // Contradicciones ENTRE capas (jerarquía: la capa gruesa manda).
  const contradiccionesInterTf: string[] = [];
  if (regimen !== 's/d' && regimen !== 'neutral' && estructura !== 's/d' && estructura !== 'neutral' && estructura !== regimen) {
    contradiccionesInterTf.push(`régimen ${regimen} (1W/1D) vs estructura ${estructura} (4H/1H)`);
  }
  if (estructura !== 's/d' && estructura !== 'neutral' && ejecucion !== 's/d' && ejecucion !== 'neutral' && ejecucion !== estructura) {
    contradiccionesInterTf.push(`estructura ${estructura} (4H/1H) vs ejecución ${ejecucion} (15m/5m)`);
  }

  // Lectura global sintetizada (jerarquía explícita).
  let lecturaGlobal: string;
  const piezas: string[] = [];
  if (regimen !== 's/d') piezas.push(`régimen ${regimen}`);
  if (estructura !== 's/d') piezas.push(`estructura ${estructura}`);
  if (ejecucion !== 's/d') piezas.push(`timing ${ejecucion}`);
  if (contradiccionesInterTf.length > 0) {
    lecturaGlobal = `estructura macro ${regimen === 's/d' ? 's/d' : regimen} con ${contradiccionesInterTf.join('; ')}`;
  } else if (piezas.length === 0) {
    lecturaGlobal = 'sin datos suficientes para una lectura direccional';
  } else if (piezas.every((p) => p.includes('s/d'))) {
    lecturaGlobal = 'lectura indeterminada (datos parciales)';
  } else {
    lecturaGlobal = piezas.join(' · ');
  }

  // F.2-E — COBERTURA DE FAMILIAS: ¿qué familias tienen información material?
  const familiaMaterial = (r: TfReading, nombre: string): boolean => {
    const f = r.familias.find((x) => x.familia === nombre);
    return f !== undefined && f.senales.length > 0;
  };
  const familyCoverage: FamilyCoverage = {
    trend: readings.some((r) => familiaMaterial(r, 'TENDENCIA')),
    momentum: readings.some((r) => familiaMaterial(r, 'MOMENTUM')),
    volume: readings.some((r) => familiaMaterial(r, 'VOLUMEN')),
    volatility: readings.some((r) => familiaMaterial(r, 'VOLATILIDAD')),
    structure: readings.some((r) => familiaMaterial(r, 'ESTRUCTURA')),
    derivatives: true, // funding_pct siempre presente en símbolos válidos
  };

  // Confluencias/contradicciones a nivel SÍMBOLO (F.2-E): familias alineadas
  // con el régimen vs en contra. Se derivan de las familias del TF de contexto.
  const confluenciasSimbolo: string[] = [];
  const contradiccionesSimbolo: string[] = [];
  const tfContexto = deCapa('contexto');
  const familiasRegimen = tfContexto.flatMap((r) => r.familias);
  for (const fam of ['TENDENCIA', 'MOMENTUM', 'VOLUMEN', 'VOLATILIDAD', 'ESTRUCTURA']) {
    const fs = familiasRegimen.filter((f) => f.familia === fam);
    if (fs.length === 0) continue;
    const dirs = fs.map((f) => f.direccion);
    if (dirs.every((d) => d === regimen)) confluenciasSimbolo.push(fam);
    else if (regimen !== 's/d' && regimen !== 'mixto' && dirs.some((d) => d !== 'neutral' && d !== 's/d' && d !== regimen)) {
      contradiccionesSimbolo.push(fam);
    }
  }

  return {
    symbol: s.symbol, quoteAsset: qa, timeframes: readings,
    regimen, estructura, ejecucion, contradiccionesInterTf,
    confluenciasSimbolo, contradiccionesSimbolo, familyCoverage, lecturaGlobal,
  };
}

/** Convierte la síntesis de un símbolo en el bloque compacto para el prompt. */
export function formatSynthesis(s: SymbolSynthesis): string {
  const lines: string[] = [];
  lines.push(`LECTURA ESTRUCTURADA ${s.symbol} (quote ${s.quoteAsset}):`);
  lines.push(`  Global: ${s.lecturaGlobal}.`);
  if (s.regimen !== 's/d') lines.push(`  Régimen (1W/1D): ${s.regimen}.`);
  if (s.estructura !== 's/d') lines.push(`  Estructura (4H/1H): ${s.estructura}.`);
  if (s.ejecucion !== 's/d') lines.push(`  Timing (15m/5m): ${s.ejecucion}.`);
  if (s.contradiccionesInterTf.length > 0) {
    lines.push(`  ⚠ Contradicciones: ${s.contradiccionesInterTf.join('; ')}.`);
  }
  for (const r of s.timeframes) {
    const fams = r.familias
      .filter((f) => f.senales.length > 0)
      .map((f) => `${f.familia}:${f.direccion}(${f.aFavor}/${f.enContra})`)
      .join(' ');
    lines.push(`  ${r.tf} [${r.capa}] ${r.direccion} — ${fams}`);
    // F.2-A — SuperTrend LIVE vs CONFIRMED (hecho numérico calculado).
    if (r.superTrend) {
      lines.push(`      SuperTrend ${r.tf} confirmado: ${r.superTrend.confirmedState}, nivel ${money(r.superTrend.level, s.quoteAsset)}; precio vivo ${money(r.superTrend.livePrice, s.quoteAsset)} → ${r.superTrend.liveRelationToLevel}. ${r.superTrend.stateConfirmation}.`);
    }
    // F.3 — hechos relacionales (autoritativos; el guard los impone post-generación).
    if (r.relationFacts.length > 0) {
      lines.push(`      Relaciones (hechos calculados — no contradecir): ${r.relationFacts.map((f) => `precio vs ${f.label} → ${f.relation}`).join(' · ')}`);
    }
    if (r.senalesRelevantes && r.senalesRelevantes.length > 0) {
      for (const s2 of r.senalesRelevantes.slice(0, 6)) lines.push(`      · ${s2}`);
    }
    if (r.niveles.length > 0) lines.push(`      Niveles: ${r.niveles.slice(0, 5).join(' | ')}`);
  }
  // F.2-E — cobertura de familias (para verificar que ninguna material quedó fuera).
  const cov = s.familyCoverage;
  lines.push(`  Cobertura de familias: tendencia=${cov.trend ? 'si' : 'no'} momentum=${cov.momentum ? 'si' : 'no'} volumen=${cov.volume ? 'si' : 'no'} volatilidad=${cov.volatility ? 'si' : 'no'} estructura=${cov.structure ? 'si' : 'no'} derivados=${cov.derivatives ? 'si' : 'no'}`);
  if (s.confluenciasSimbolo.length > 0) lines.push(`  Confluencias (régimen): ${s.confluenciasSimbolo.join(', ')}.`);
  if (s.contradiccionesSimbolo.length > 0) lines.push(`  Contradicciones (régimen): ${s.contradiccionesSimbolo.join(', ')}.`);
  return lines.join('\n');
}

/** Construye el bloque de síntesis para TODO el contexto (varios símbolos). */
export function buildSynthesisBlock(ctx: MultiTfContext): string {
  const blocks: string[] = [];
  for (const s of Object.values(ctx)) {
    const syn = buildSymbolSynthesis(s);
    if (syn) blocks.push(formatSynthesis(syn));
  }
  return blocks.join('\n\n');
}

/** F.3 — recolecta TODOS los hechos relacionales del contexto (para el guard). */
export function collectRelationFacts(ctx: MultiTfContext): RelationFact[] {
  const out: RelationFact[] = [];
  for (const s of Object.values(ctx)) {
    const syn = buildSymbolSynthesis(s);
    if (!syn) continue;
    for (const r of syn.timeframes) out.push(...r.relationFacts);
  }
  return out;
}
