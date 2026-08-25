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
  bitgetFunding: number; // PRIMARIO
  binanceFunding: number; // cross-check
  bybitFunding: number; // cross-check
  fundingSpreadBps: number; // Bitget vs Bybit
  markPrice: number;
  indexPrice: number;
  bitgetOI: number; // PRIMARIO
  bybitOI: number; // cross-check
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
 * Agrega datos de mercado con Bitget como fuente primaria y Binance/Bybit
 * como cross-check. CoinGecko aporta el panorama global.
 */
export async function buildAggregatedScan(
  symbol: string,
  sources: MarketSources,
): Promise<AggregatedScan> {
  const pair = toPerpPair(symbol);

  const [bgTicker, bgFunding, bgFundingHist, bgOI, bnPremium, byTicker, cgGlobal] =
    await Promise.all([
      sources.bitget.getTicker(pair),
      sources.bitget.getCurrentFunding(pair),
      sources.bitget.getFundingHistory(pair, { pageSize: 21 }),
      sources.bitget.getOpenInterest(pair),
      sources.binance.getPremiumIndex(pair),
      sources.bybit.getTicker(pair),
      sources.coinGecko.getGlobal(),
    ]);

  // Bitget = primaria
  const price = Number(bgTicker.lastPr ?? 0);
  const bitgetFunding = Number(bgFunding.fundingRate);
  const bitgetOI = Number(bgOI.openInterestList?.[0]?.size ?? 0);
  const volume24h = Number(bgTicker.usdtVolume ?? 0);

  // Cross-check (Binance + Bybit)
  const binanceFunding = Number(bnPremium.lastFundingRate);
  const bybitFunding = Number(byTicker.fundingRate);
  const bybitOI = Number(byTicker.openInterest);
  const markPrice = Number(bnPremium.markPrice);
  const indexPrice = Number(bnPremium.indexPrice);

  const fundingRate7dAvg =
    bgFundingHist.length > 0
      ? bgFundingHist.reduce((acc, r) => acc + Number(r.fundingRate), 0) / bgFundingHist.length
      : bitgetFunding;

  const upper = symbol.toUpperCase();

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
      basisAnnualized: bitgetFunding * 3 * 365, // aprox: funding 8h × 3/día × 365
      volume24h,
      updatedAt: Date.now(),
    },
    context: {
      globalCapUsd: cgGlobal.data.total_market_cap.usd ?? 0,
      btcDominancePct: cgGlobal.data.market_cap_percentage.btc ?? 0,
      bitgetFunding,
      binanceFunding,
      bybitFunding,
      fundingSpreadBps: (bitgetFunding - bybitFunding) * 10000,
      markPrice,
      indexPrice,
      bitgetOI,
      bybitOI,
    },
  };
}
