import type { BinanceFuturesClient } from './market/binance.js';
import type { BybitClient } from './market/bybit.js';
import type { CoinGeckoClient } from './market/coingecko.js';
import type { MarketSnapshot } from '../types/index.js';

export interface MarketSources {
  binance: BinanceFuturesClient;
  bybit: BybitClient;
  coinGecko: CoinGeckoClient;
}

export interface ScanContext {
  globalCapUsd: number;
  btcDominancePct: number;
  binanceFunding: number;
  bybitFunding: number;
  /** Spread de funding entre Binance y Bybit en bps (señal de basis/arbitraje). */
  fundingSpreadBps: number;
  markPrice: number;
  indexPrice: number;
  binanceOI: number;
  bybitOI: number;
}

export interface AggregatedScan {
  symbol: string;
  pair: string;
  snapshot: MarketSnapshot;
  context: ScanContext;
}

/** Convierte 'BTC' → 'BTCUSDT', 'ETHUSD' → 'ETHUSDT', 'BTCUSDT' → 'BTCUSDT'. */
export function toPerpPair(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.endsWith('USDT')) return s;
  if (s.endsWith('USD')) return s.replace(/USD$/, 'USDT');
  return `${s}USDT`;
}

/**
 * Agrega datos cross-exchange (Binance + Bybit + CoinGecko) en un solo snapshot.
 * Es la base de datos real que alimenta al analista LLM.
 */
export async function buildAggregatedScan(
  symbol: string,
  sources: MarketSources,
): Promise<AggregatedScan> {
  const pair = toPerpPair(symbol);

  const [bnPremium, bnOI, bnFundingHist, byTicker, cgGlobal] = await Promise.all([
    sources.binance.getPremiumIndex(pair),
    sources.binance.getOpenInterest(pair),
    sources.binance.getFundingHistory(pair, 21),
    sources.bybit.getTicker(pair),
    sources.coinGecko.getGlobal(),
  ]);

  const markPrice = Number(bnPremium.markPrice);
  const indexPrice = Number(bnPremium.indexPrice);
  const binanceFunding = Number(bnPremium.lastFundingRate);
  const bybitFunding = Number(byTicker.fundingRate);
  const binanceOI = Number(bnOI.openInterest);
  const bybitOI = Number(byTicker.openInterest);

  const fundingRate7dAvg =
    bnFundingHist.length > 0
      ? bnFundingHist.reduce((acc, r) => acc + Number(r.fundingRate), 0) / bnFundingHist.length
      : binanceFunding;

  const upper = symbol.toUpperCase();

  return {
    symbol: upper,
    pair,
    snapshot: {
      symbol: upper,
      price: markPrice,
      fundingRate: binanceFunding,
      fundingRate7dAvg,
      openInterest: binanceOI,
      openInterestDelta24h: 0, // TODO: requiere serie histórica de OI (próxima iteración)
      basisAnnualized: binanceFunding * 3 * 365, // aprox: funding 8h × 3/día × 365
      volume24h: Number(byTicker.volume24h ?? 0),
      updatedAt: Date.now(),
    },
    context: {
      globalCapUsd: cgGlobal.data.total_market_cap.usd ?? 0,
      btcDominancePct: cgGlobal.data.market_cap_percentage.btc ?? 0,
      binanceFunding,
      bybitFunding,
      fundingSpreadBps: (binanceFunding - bybitFunding) * 10000,
      markPrice,
      indexPrice,
      binanceOI,
      bybitOI,
    },
  };
}
