import { DEFAULT_WATCHLIST } from '../config/constants.js';
import { buildAggregatedScan, type AggregatedScan, type MarketSources } from './snapshot.js';
import type { DefiLlamaClient } from './onchain/defillama.js';

export interface Briefing {
  generatedAt: number;
  globalCapUsd: number;
  btcDominancePct: number;
  usdtCirculating: number;
  usdcCirculating: number;
  tickers: AggregatedScan[];
}

/**
 * Arma el briefing matutino: global + funding/OI de cada ticker de la watchlist
 * + circulante de stablecoins (DefiLlama). Todo en paralelo, tolerante a fallos.
 */
export async function buildMorningBriefing(
  market: MarketSources,
  defiLlama: DefiLlamaClient,
  symbols: readonly string[] = DEFAULT_WATCHLIST,
): Promise<Briefing> {
  const tickers = await Promise.all(symbols.map((s) => buildAggregatedScan(s, market)));

  let usdtCirculating = 0;
  let usdcCirculating = 0;
  try {
    const stables = await defiLlama.getStablecoins();
    usdtCirculating = stables.find((s) => s.symbol === 'USDT')?.circulating?.peggedUSD ?? 0;
    usdcCirculating = stables.find((s) => s.symbol === 'USDC')?.circulating?.peggedUSD ?? 0;
  } catch (err) {
    console.warn('[briefing] DefiLlama stablecoins no disponible:', err instanceof Error ? err.message : err);
  }

  const first = tickers[0];
  return {
    generatedAt: Date.now(),
    globalCapUsd: first?.context.globalCapUsd ?? 0,
    btcDominancePct: first?.context.btcDominancePct ?? 0,
    usdtCirculating,
    usdcCirculating,
    tickers,
  };
}
