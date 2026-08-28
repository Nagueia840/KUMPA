import type { BinanceFuturesClient } from './market/binance.js';
import type { BybitClient } from './market/bybit.js';
import type { CoinGeckoClient } from './market/coingecko.js';
import type { BitgetClient } from './bitget/index.js';
import type { MarketSnapshot } from '../types/index.js';

export interface MarketSources {
  bitget: BitgetClient; // FUENTE PRIMARIA (precio, funding, OI, volumen)
  binance: BinanceFuturesClient; // cross-check
  bybit: BybitClient; // cross-check
  coinGecko: CoinGeckoClient; // global (secundaria)
}

export interface ScanContext {
  globalCapUsd: number;
  btcDominancePct: number;
  bitgetFunding: number; // PRIMARIO (0 si fuente primaria no es Bitget)
  binanceFunding: number; // cross-check (0 si no disponible)
  bybitFunding: number; // cross-check (0 si no disponible)
  fundingSpreadBps: number; // Bitget vs Bybit (0 si no se puede calcular)
  markPrice: number;
  indexPrice: number;
  bitgetOI: number; // PRIMARIO (0 si fuente primaria no es Bitget)
  bybitOI: number; // cross-check (0 si no disponible)
}

export type CrosscheckStatus = 'ok' | 'unavailable';

export interface CrosscheckInfo {
  status: CrosscheckStatus;
  error?: string;
}

/**
 * Estado del PREMIUM/DISCOUNT del perpetual vs su índice.
 * Para un perpetual (sin vencimiento) contango/backwardation NO aplican:
 * son conceptos de term structure de futuros con vencimiento. El dato
 * correcto es premium (futuro > índice) / discount (futuro < índice).
 */
export type PremiumState = 'premium' | 'discount' | 'flat' | 'unknown';

export interface AggregatedScan {
  symbol: string;
  pair: string;
  snapshot: MarketSnapshot;
  context: ScanContext;
  /** Fuente que proveyó los datos primarios del snapshot ('Bitget' | 'Bybit' | 'Binance'). */
  primarySource: string;
  /** 'ok' → fuente primaria con datos válidos; 'fallback' → primaria cayó y se usó una secundaria. */
  primaryStatus: 'ok' | 'fallback';
  crosschecks: {
    binance: CrosscheckInfo;
    bybit: CrosscheckInfo;
  };
  /**
   * ESTADO DEL PREMIUM: derivado del PREMIUM REAL (markPrice vs indexPrice),
   * con Bitget como fuente PRIMARIA e independiente de las secundarias.
   * NUNCA del signo del funding. Contango/backwardation NO se usan (perpetual).
   */
  premiumState: PremiumState;
  /**
   * UNIDAD REAL del open interest: Bitget /api/v2/mix/market/open-interest
   * documenta `size` como "specific coins" del par (ej. ETH en ETHUSDT) — es el
   * ACTIVO BASE, no contratos ni USD. Derivado del par (ETHUSDT → 'ETH').
   */
  openInterestUnit: string;
  /**
   * QUOTE ASSET del instrumento (ETHUSDT/BTCUSDT → 'USDT'). Todos los valores de
   * precio/nivel derivados del instrumento llevan ESTA unidad, NO 'USD' (USDT ≠
   * USD, sin paridad asumida).
   */
  quoteAsset: string;
}

/** Convierte 'BTC' → 'BTCUSDT', 'ETHUSD' → 'ETHUSDT', 'BTCUSDT' → 'BTCUSDT'. */
export function toPerpPair(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT')) return s;
  if (s.endsWith('USD')) return s.replace(/USD$/, 'USDT');
  return `${s}USDT`;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

/** Ejecuta una fuente SIN dejar que su fallo tumbe el resto (nunca fatal). */
async function settle<T>(fn: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Horas del intervalo de funding Bitget: 1 | 2 | 4 | 8. null si inválido/faltante
 *  (certificación: NO asumir 8h por defecto — anualización unavailable). */
function fundingIntervalHours(rate: { fundingRateInterval?: string } | undefined): number | null {
  const h = Number(rate?.fundingRateInterval);
  return [1, 2, 4, 8].includes(h) ? h : null;
}

/**
 * FUNDING ANUALIZADO EXTRAPOLADO (%): fundingRate × (24/intervaloHs) × 365 × 100.
 * Es extrapolación del funding actual — NO basis, NO rendimiento garantizado.
 * Devuelve null si fundingRateInterval falta/es inválido: la anualización queda
 * UNAVAILABLE (el funding actual sigue siendo válido; la extrapolación no).
 */
export function annualizedFundingPct(
  fundingRate: number,
  rate: { fundingRateInterval?: string } | undefined,
): number | null {
  const hours = fundingIntervalHours(rate);
  if (hours === null) return null;
  return fundingRate * (24 / hours) * 365 * 100;
}

/**
 * Clasifica el estado del PREMIUM (mark vs index), %: premium/discount/flat.
 * NO acepta funding como input: el estado del premium NO se infiere del funding.
 */
export function classifyPremiumState(premiumPct: number | null | undefined): PremiumState {
  if (premiumPct === null || premiumPct === undefined || !Number.isFinite(premiumPct)) return 'unknown';
  if (premiumPct > 0.05) return 'premium';
  if (premiumPct < -0.05) return 'discount';
  return 'flat';
}

/** Deriva la unidad del OI desde el par: ETHUSDT → 'ETH' (activo base, doc Bitget). */
export function openInterestUnitFromPair(pair: string): string {
  const base = pair.replace(/USDT$|USD$|USDC$/i, '');
  return base || 'contracts';
}

/**
 * QUOTE ASSET del par: ETHUSDT/BTCUSDT → 'USDT' (NO USD — sin paridad asumida).
 * Los precios y niveles (lastPr, VWAP, EMAs, SuperTrend, ATR, Bollinger, pivots,
 * fib, MACD absoluto, volumen quote) derivan del instrumento USDT → se etiquetan
 * 'USDT'. USDT ≠ USD: no etiquetar como USD sin conversión real.
 */
export function quoteAssetFromPair(pair: string): string {
  const m = pair.toUpperCase().match(/USDT$|USDC$|USD$|BUSD$/);
  return m ? m[0] : 'quote';
}

/**
 * Agrega datos de mercado con Bitget como fuente PRIMARIA y Binance/Bybit como
 * cross-check NO FATAL. CoinGecko aporta el panorama global (no fatal).
 *
 * POLÍTICA (fix diagnóstico 403 Bybit): la disponibilidad de una fuente
 * secundaria NUNCA invalida datos primarios válidos. Si Bitget devuelve datos,
 * el snapshot es válido aunque Binance/Bybit/CoinGecko fallen; el resultado
 * expone qué cross-check falló. Solo si Bitget cae se evalúa una degradación
 * segura con una secundaria, y el resultado identifica explícitamente la fuente
 * usada (NUNCA se presenta como Bitget).
 */
export async function buildAggregatedScan(
  symbol: string,
  sources: MarketSources,
): Promise<AggregatedScan> {
  const pair = toPerpPair(symbol);
  const upper = symbol.toUpperCase();

  // ── Secundarias en paralelo: si fallan, quedan registradas, NO tiran el scan ──
  const [bn, by, cg] = await Promise.all([
    settle(() => sources.binance.getPremiumIndex(pair)),
    settle(() => sources.bybit.getTicker(pair)),
    settle(() => sources.coinGecko.getGlobal()),
  ]);

  const crosschecks = {
    binance: bn.ok ? { status: 'ok' as const } : { status: 'unavailable' as const, error: bn.error },
    bybit: by.ok ? { status: 'ok' as const } : { status: 'unavailable' as const, error: by.error },
  };
  // Visibilidad en logs: un cross-check caído NUNCA invalida datos primarios.
  if (!bn.ok) console.warn(`[snapshot] crosscheck Binance unavailable para ${pair}: ${bn.error}`);
  if (!by.ok) console.warn(`[snapshot] crosscheck Bybit unavailable para ${pair}: ${by.error}`);

  // ── Primaria: Bitget ─────────────────────────────────────────────────────────
  const bg = await settle(async () => {
    const [bgTicker, bgFunding, bgFundingHist, bgOI, bgMark] = await Promise.all([
      sources.bitget.getTicker(pair),
      sources.bitget.getCurrentFunding(pair),
      sources.bitget.getFundingHistory(pair, { pageSize: 21 }),
      sources.bitget.getOpenInterest(pair),
      // Premium independiente de secundarias: mark/index de Bitget (no fatal si
      // el endpoint no está disponible → premiumState 'unknown').
      settle(() => sources.bitget.getMarkPrice(pair)),
    ]);
    return { bgTicker, bgFunding, bgFundingHist, bgOI, bgMark };
  });

  if (bg.ok) {
    const { bgTicker, bgFunding, bgFundingHist, bgOI, bgMark } = bg.value;

    const price = Number(bgTicker.lastPr ?? 0);
    const bitgetFunding = Number(bgFunding.fundingRate);
    const bitgetOI = Number(bgOI.openInterestList?.[0]?.size ?? 0);
    const volume24h = Number(bgTicker.usdtVolume ?? 0);

    const binanceFunding = bn.ok ? Number(bn.value.lastFundingRate) : 0;
    const bybitFunding = by.ok ? Number(by.value.fundingRate) : 0;
    const bybitOI = by.ok ? Number(by.value.openInterest) : 0;

    const fundingRate7dAvg =
      bgFundingHist.length > 0
        ? bgFundingHist.reduce((acc, r) => acc + Number(r.fundingRate), 0) / bgFundingHist.length
        : bitgetFunding;

    // PREMIUM REAL (mark vs index) con Bitget como fuente PRIMARIA. Binance solo
    // como cross-check si Bitget no expone mark/index. Sin ninguna fuente
    // comparable → premiumPct null → premiumState 'unknown' (no se afirma nada).
    const bgMarkPrice = bgMark.ok ? Number(bgMark.value.markPrice) : NaN;
    const bgIndexPrice = bgMark.ok ? Number(bgMark.value.indexPrice) : NaN;
    const bnMarkPrice = bn.ok ? Number(bn.value.markPrice) : NaN;
    const bnIndexPrice = bn.ok ? Number(bn.value.indexPrice) : NaN;

    const useBitgetPremium =
      Number.isFinite(bgMarkPrice) && Number.isFinite(bgIndexPrice) && bgIndexPrice > 0;
    const useBinancePremium =
      !useBitgetPremium && Number.isFinite(bnMarkPrice) && Number.isFinite(bnIndexPrice) && bnIndexPrice > 0;

    const markPrice = useBitgetPremium ? bgMarkPrice : useBinancePremium ? bnMarkPrice : price;
    const indexPrice = useBitgetPremium ? bgIndexPrice : useBinancePremium ? bnIndexPrice : price;

    const premiumPct =
      indexPrice > 0 && markPrice !== indexPrice ? ((markPrice - indexPrice) / indexPrice) * 100 : null;
    const premiumState = classifyPremiumState(premiumPct);
    const annualized = annualizedFundingPct(bitgetFunding, bgFunding);

    return {
      symbol: upper,
      pair,
      snapshot: {
        symbol: upper,
        price,
        fundingRate: bitgetFunding,
        fundingRate7dAvg,
        openInterest: bitgetOI,
        openInterestDelta24h: 0, // TODO: serie histórica de OI
        annualizedFundingPct: annualized,
        volume24h,
        updatedAt: Date.now(),
      },
      context: {
        globalCapUsd: cg.ok ? cg.value.data.total_market_cap.usd ?? 0 : 0,
        btcDominancePct: cg.ok ? cg.value.data.market_cap_percentage.btc ?? 0 : 0,
        bitgetFunding,
        binanceFunding,
        bybitFunding,
        fundingSpreadBps: (bitgetFunding - bybitFunding) * 10000,
        markPrice,
        indexPrice,
        bitgetOI,
        bybitOI,
      },
      primarySource: 'Bitget',
      primaryStatus: 'ok',
      crosschecks,
      premiumState,
      openInterestUnit: openInterestUnitFromPair(pair),
      quoteAsset: quoteAssetFromPair(pair),
    };
  }

  // ── Bitget cayó → degradación segura SOLO si una secundaria tiene precio ────
  // Preferimos Bybit (ticker completo: precio+funding+OI+volumen), luego Binance
  // (mark/index + funding). El resultado SIEMPRE etiqueta la fuente real.
  if (by.ok) {
    const price = Number(by.value.lastPrice ?? 0);
    if (price > 0) {
      const bybitFunding = Number(by.value.fundingRate);
      const bybitOI = Number(by.value.openInterest);
      const byMark = Number(by.value.markPrice ?? price);
      const byIndex = Number(by.value.indexPrice ?? price);
      const premiumPct =
        byIndex > 0 && byMark !== byIndex ? ((byMark - byIndex) / byIndex) * 100 : null;
      return {
        symbol: upper,
        pair,
        snapshot: {
          symbol: upper,
          price,
          fundingRate: bybitFunding,
          fundingRate7dAvg: bybitFunding, // sin historial en degradación
          openInterest: bybitOI,
          openInterestDelta24h: 0,
          annualizedFundingPct: annualizedFundingPct(bybitFunding, undefined),
          volume24h: Number(by.value.volume24h ?? 0),
          updatedAt: Date.now(),
        },
        context: {
          globalCapUsd: cg.ok ? cg.value.data.total_market_cap.usd ?? 0 : 0,
          btcDominancePct: cg.ok ? cg.value.data.market_cap_percentage.btc ?? 0 : 0,
          bitgetFunding: 0,
          binanceFunding: bn.ok ? Number(bn.value.lastFundingRate) : 0,
          bybitFunding,
          fundingSpreadBps: 0,
          markPrice: byMark,
          indexPrice: byIndex,
          bitgetOI: 0,
          bybitOI,
        },
        primarySource: 'Bybit',
        primaryStatus: 'fallback',
        crosschecks,
        premiumState: classifyPremiumState(premiumPct),
        openInterestUnit: openInterestUnitFromPair(pair),
        quoteAsset: quoteAssetFromPair(pair),
      };
    }
  }

  if (bn.ok) {
    const price = Number(bn.value.markPrice ?? 0) || Number(bn.value.indexPrice ?? 0);
    if (price > 0) {
      const binanceFunding = Number(bn.value.lastFundingRate);
      const bnMark = Number(bn.value.markPrice ?? price);
      const bnIndex = Number(bn.value.indexPrice ?? price);
      const premiumPct =
        bnIndex > 0 && bnMark !== bnIndex ? ((bnMark - bnIndex) / bnIndex) * 100 : null;
      return {
        symbol: upper,
        pair,
        snapshot: {
          symbol: upper,
          price,
          fundingRate: binanceFunding,
          fundingRate7dAvg: binanceFunding,
          openInterest: 0,
          openInterestDelta24h: 0,
          annualizedFundingPct: annualizedFundingPct(binanceFunding, undefined),
          volume24h: 0,
          updatedAt: Date.now(),
        },
        context: {
          globalCapUsd: cg.ok ? cg.value.data.total_market_cap.usd ?? 0 : 0,
          btcDominancePct: cg.ok ? cg.value.data.market_cap_percentage.btc ?? 0 : 0,
          bitgetFunding: 0,
          binanceFunding,
          bybitFunding: 0,
          fundingSpreadBps: 0,
          markPrice: bnMark,
          indexPrice: bnIndex,
          bitgetOI: 0,
          bybitOI: 0,
        },
        primarySource: 'Binance',
        primaryStatus: 'fallback',
        crosschecks,
        premiumState: classifyPremiumState(premiumPct),
        openInterestUnit: openInterestUnitFromPair(pair),
        quoteAsset: quoteAssetFromPair(pair),
      };
    }
  }

  // ── Nada disponible → error controlado, NUNCA datos inventados ──────────────
  throw new Error(
    `Sin datos de mercado para ${pair}: Bitget ${bg.error ?? 'sin datos'}; ` +
      `Bybit ${crosschecks.bybit.status}; Binance ${crosschecks.binance.status}`,
  );
}
