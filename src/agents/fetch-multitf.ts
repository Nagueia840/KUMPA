import type { BitgetClient } from '../data/bitget/index.js';
import { parseCandle } from '../data/indicators.js';
import { computeLayerIndicators } from '../data/layer-indicators.js';
import { quoteAssetFromPair, toPerpPair } from '../data/snapshot.js';
import { TF_META, type TfLabel } from '../config/timeframes.js';
import {
  attachTfBlock,
  buildInvalidSymbol,
  buildInvalidTfBlock,
  buildMultiTfContext,
  buildMultiTfSymbol,
  buildTfBlock,
  isLiveCandle,
  type MultiTfContext,
  type MultiTfSymbolData,
  type TfBlock,
  type TfCandleInput,
  type TfStatus,
  type VelaViva,
} from '../utils/multitf.js';
import type { TimeframeRequest } from '../utils/timeframes.js';

/**
 * FETCH MULTITEMPORAL REAL (FASE B).
 * Conecta la infraestructura de Fase A con los datos de Bitget.
 *
 * Reglas:
 * - El usuario manda: los TF pedidos se respetan tal cual. Si un TF falla,
 *   queda valido:false con su motivo — NUNCA se sustituye por otro marco.
 * - Concurrencia controlada (MAX_CONCURRENT_FETCHES) y timeout individual
 *   (FETCH_TIMEOUT_MS): una fuente lenta no bloquea el resto.
 * - Vela viva: los indicadores se calculan SOLO con velas cerradas; la vela en
 *   curso va aparte como `vela_viva`.
 * - CandleNeed por capa (Fase A) + paginado limit=90+endTime solo cuando el
 *   límite por request de la API no alcanza (patrón auditado).
 */

/** Timeout individual por request. Bitget respondió <200ms en las pruebas; 3s da
 *  margen amplio y deja presupuesto para el LLM dentro del tope de 10s de Hobby. */
export const FETCH_TIMEOUT_MS = 3000;
/** Pares símbolo×TF simultáneos (Hobby 10s: fetch total objetivo ≤ 3-4s). */
export const MAX_CONCURRENT_FETCHES = 6;

/** Fuentes que necesita el fetcher (inyectable en tests). */
export interface MultiTfSources {
  bitget: Pick<
    BitgetClient,
    'getCandles' | 'getCandlesHistory' | 'getCurrentFunding' | 'getTicker'
  >;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const fmtFunding = (rate: string): string => `${(Number(rate) * 100).toFixed(4)}%`;

/** Resuelve `promise` o rechaza con timeout tras `ms` (sin dejar la promesa colgada). */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${what} (${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Aplica `fn` a `items` con un máximo de `limit` promesas simultáneas. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Velas para un TF: 1 request si el límite de la API alcanza; si no, paginado 90+endTime. */
async function fetchCandles(
  sources: MultiTfSources,
  pair: string,
  tf: TfLabel,
  need: number,
): Promise<string[][]> {
  const meta = TF_META[tf];
  if (need <= meta.maxPerRequest) {
    // Verificado en API real: ≤1H hasta 1000, 4H hasta 540 por request.
    return sources.bitget.getCandles(pair, meta.bitget, { limit: need });
  }
  // 1D/1W/1M: límite clampeado → paginado seguro limit=90 + endTime (patrón auditado).
  return sources.bitget.getCandlesHistory(pair, meta.bitget, need);
}

/** Clasifica el estado de validez según el error (FASE C — data validity). */
function classifyError(err: unknown): { status: TfStatus; error: string } {
  const msg = errMsg(err);
  if (/timeout/i.test(msg)) return { status: 'timeout', error: msg };
  return { status: 'fetch_failed', error: msg };
}

/** Bloque de un solo TF; ante cualquier fallo devuelve buildInvalidTfBlock (sin sustituir). */
async function fetchTfBlock(
  sources: MultiTfSources,
  pair: string,
  tf: TfLabel,
  timeoutMs: number,
): Promise<TfBlock> {
  let raw: string[][];
  try {
    raw = await withTimeout(
      fetchCandles(sources, pair, tf, TF_META[tf].candleNeed),
      timeoutMs,
      `${pair} ${tf}`,
    );
  } catch (err) {
    const c = classifyError(err);
    return buildInvalidTfBlock(tf, c.status, c.error);
  }

  const candles: TfCandleInput[] = raw.map(parseCandle).sort((a, b) => a.time - b.time);
  if (candles.length === 0) {
    return buildInvalidTfBlock(tf, 'insufficient_candles', 'sin velas');
  }

  const now = Date.now();
  const last = candles[candles.length - 1]!;
  const live = isLiveCandle(tf, last.time, now);
  const closed = live ? candles.slice(0, -1) : candles;

  if (closed.length === 0) {
    return buildInvalidTfBlock(tf, 'insufficient_candles', 'solo vela en curso, sin velas cerradas');
  }

  const cierreUltimaCerrada = closed[closed.length - 1]!.close;

  let indicadores: Record<string, unknown>;
  try {
    indicadores = computeLayerIndicators(tf, closed, cierreUltimaCerrada);
  } catch (err) {
    return buildInvalidTfBlock(tf, 'calculation_failed', `error en cálculo: ${errMsg(err)}`);
  }

  const velaViva: VelaViva | undefined = live
    ? {
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
      }
    : undefined;

  const block = buildTfBlock(tf, candles, now, {
    closedCount: closed.length,
    indicadores,
    velaViva,
    cierreUltimaCerrada: cierreUltimaCerrada,
  });

  // METADATA DERIVADA (FASE E — anti-interpretación libre del LLM):
  // - superTrend_rol: 'up' → el nivel es la banda inferior (SOPORTE);
  //   'down' → banda superior (RESISTENCIA). El LLM no debe inferir el rol.
  // - vela_vs_cierre_previo: posición del rango de la vela en curso respecto al
  //   cierre de la vela anterior (above/below/mixed). Prohíbe decir "vela entera
  //   por encima" cuando low <= cierre previo.
  const stDir = block.indicadores['superTrend_direccion'];
  if (stDir === 'up') block.superTrend_rol = 'soporte';
  else if (stDir === 'down') block.superTrend_rol = 'resistencia';

  const vv = block.vela_viva;
  const cierrePrev = block.cierre_ultima_cerrada;
  if (vv && cierrePrev !== null) {
    block.vela_vs_cierre_previo =
      vv.low > cierrePrev ? 'above' : vv.high < cierrePrev ? 'below' : 'mixed';
  } else if (cierrePrev !== null && closed.length > 0) {
    const lastClosed = closed[closed.length - 1]!;
    block.vela_vs_cierre_previo =
      lastClosed.low > cierrePrev ? 'above' : lastClosed.high < cierrePrev ? 'below' : 'mixed';
  }

  return block;
}

/** Precio de respaldo si el ticker no trae lastPr: cierre de la vela viva o de la última cerrada. */
function fallbackPrice(blocks: readonly [TfLabel, TfBlock][]): number {
  for (const [, block] of blocks) {
    if (!block.valido) continue;
    if (block.vela_viva) return block.vela_viva.close;
    if (block.cierre_ultima_cerrada !== null) return block.cierre_ultima_cerrada;
  }
  return 0;
}

/**
 * Fetch completo multitemporal para varios símbolos.
 * Devuelve el contexto agrupado por par (BTCUSDT), con símbolos inválidos
 * marcados valido:false + motivo (sin sustituir nada).
 */
export async function fetchMultiTfData(
  sources: MultiTfSources,
  tickers: readonly string[],
  timeframes: readonly TimeframeRequest[],
  opts: { timeoutMs?: number } = {},
): Promise<MultiTfContext> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const entries: MultiTfSymbolData[] = await mapWithConcurrency(
    tickers,
    MAX_CONCURRENT_FETCHES,
    async (ticker) => {
      const pair = toPerpPair(ticker);
      try {
        const [funding, tickerData] = await withTimeout(
          Promise.all([sources.bitget.getCurrentFunding(pair), sources.bitget.getTicker(pair)]),
          timeoutMs,
          `${pair} funding/ticker`,
        );
        const blocks: Array<[TfLabel, TfBlock]> = await mapWithConcurrency(
          timeframes,
          MAX_CONCURRENT_FETCHES,
          async (req) =>
            [req.tf, await fetchTfBlock(sources, pair, req.tf, timeoutMs)] as [TfLabel, TfBlock],
        );

        const lastPr = Number(tickerData.lastPr ?? 0);
        const price = lastPr > 0 ? lastPr : fallbackPrice(blocks);

        let symbol = buildMultiTfSymbol(ticker, {
          price,
          fundingPct: fmtFunding(funding.fundingRate),
          fundingTsMs: funding.nextUpdate ? Number(funding.nextUpdate) : undefined,
          quoteAsset: quoteAssetFromPair(pair),
        });
        for (const [tf, block] of blocks) symbol = attachTfBlock(symbol, tf, block);
        return symbol;
      } catch (err) {
        const c = classifyError(err);
        return buildInvalidSymbol(ticker, c.error, c.status);
      }
    },
  );
  return buildMultiTfContext(entries);
}
