import type { AggregatedScan } from '../data/snapshot.js';
import type { Insight } from '../types/index.js';

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

/** Formatea el snapshot agregado como texto legible. */
export function formatScan(scan: AggregatedScan): string {
  const s = scan.snapshot;
  const c = scan.context;
  return [
    `📊 <b>${scan.symbol}</b> (${scan.pair})`,
    '',
    `• Precio mark: $${s.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    `• Funding Binance: ${pct(c.binanceFunding)} (7d avg ${pct(s.fundingRate7dAvg)})`,
    `• Funding Bybit: ${pct(c.bybitFunding)}`,
    `• Spread funding (BN−BY): ${c.fundingSpreadBps.toFixed(2)} bps`,
    `• Basis anualizado (aprox): ${(s.basisAnnualized * 100).toFixed(2)}%`,
    `• OI Binance: ${c.binanceOI.toLocaleString('en-US')} | Bybit: ${c.bybitOI.toLocaleString('en-US')}`,
    `• Vol 24h Bybit: $${s.volume24h.toLocaleString('en-US')}`,
    `• Market cap global: $${(c.globalCapUsd / 1e12).toFixed(2)}T · BTC dom: ${c.btcDominancePct.toFixed(1)}%`,
  ].join('\n');
}

/** Formatea el Insight del analista. */
export function formatInsight(insight: Insight): string {
  const lines = [`🧠 <b>${insight.title}</b>`, '', insight.summary];
  if (insight.dataPoints.length > 0) {
    lines.push('', '📌 Datos clave:');
    for (const dp of insight.dataPoints) lines.push(`  • ${dp.label}: ${dp.value}`);
  }
  lines.push('', `⚖️ Lectura: ${insight.judgment}`, '', `Confianza: ${insight.confidence}`);
  if (insight.sources.length > 0) lines.push(`Fuentes: ${insight.sources.join(', ')}`);
  return lines.join('\n');
}
