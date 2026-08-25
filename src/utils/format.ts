import type { AggregatedScan } from '../data/snapshot.js';
import type { Briefing } from '../data/briefing.js';
import type { Insight, Learning, ThesisAnalysis, TradePlan } from '../types/index.js';

const pct = (x: number) => `${(x * 100).toFixed(4)}%`;

/** Formatea el snapshot agregado como texto legible. */
export function formatScan(scan: AggregatedScan): string {
  const s = scan.snapshot;
  const c = scan.context;
  return [
    `📊 <b>${scan.symbol}</b> (${scan.pair})`,
    '',
    `• Precio mark: $${s.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    `• Funding Bitget: ${pct(c.bitgetFunding)} (7d avg ${pct(s.fundingRate7dAvg)})`,
    `• Funding Binance: ${pct(c.binanceFunding)} · Bybit: ${pct(c.bybitFunding)}`,
    `• Spread funding (BG−BY): ${c.fundingSpreadBps.toFixed(2)} bps`,
    `• Basis anualizado (aprox): ${(s.basisAnnualized * 100).toFixed(2)}%`,
    `• OI Bitget: ${c.bitgetOI.toLocaleString('en-US')} | Bybit: ${c.bybitOI.toLocaleString('en-US')}`,
    `• Vol 24h Bitget: $${s.volume24h.toLocaleString('en-US')}`,
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

/** Formatea un plan de operación. */
export function formatPlan(plan: TradePlan): string {
  const tps = plan.takeProfits
    .map((tp) => `  • $${tp.price.toLocaleString('en-US')} (${tp.sizePct}%)`)
    .join('\n');
  return [
    `📋 <b>Plan ${plan.direction.toUpperCase()} ${plan.symbol}</b>`,
    '',
    `• Entrada: $${plan.entryZone[0].toLocaleString('en-US')} – $${plan.entryZone[1].toLocaleString('en-US')}`,
    `• Stop loss: $${plan.stopLoss.toLocaleString('en-US')}`,
    `• Take profit:`,
    tps,
    `• Tamaño sugerido: ${plan.positionSizePct}%`,
    `• Risk/reward: ${plan.riskReward}`,
    '',
    `💡 Razón: ${plan.reasoning}`,
    ...(plan.eventRisks.length ? [`⚠️ Riesgos de evento: ${plan.eventRisks.join(', ')}`] : []),
  ].join('\n');
}

/** Formatea un análisis red-team. */
export function formatThesis(ta: ThesisAnalysis): string {
  const list = (title: string, items: string[]) =>
    items.length ? `\n${title}:\n${items.map((i) => `  • ${i}`).join('\n')}` : '';
  return [
    '🎯 <b>Red team</b>',
    '',
    `Tesis: ${ta.thesis}`,
    list('📈 A favor', ta.bullCase),
    list('📉 En contra', ta.bearCase),
    list('⚠️ Riesgos clave', ta.keyRisks),
    list('❓ Datos faltantes', ta.dataGaps),
    '',
    `⚖️ Veredicto: ${ta.verdict}`,
  ].join('\n');
}

/** Formatea una lección aprendida. */
export function formatLearning(l: Learning): string {
  return [
    '📚 <b>Lección guardada</b>',
    '',
    `Tema: ${l.topic}`,
    `Tesis: ${l.thesis}`,
    `Resultado: ${l.outcome}`,
    `Lección: ${l.lesson}`,
    ...(l.tags.length ? [`Tags: ${l.tags.join(', ')}`] : []),
  ].join('\n');
}

/** Formatea el briefing en modo datos (sin LLM). */
export function formatBriefingData(b: Briefing): string {
  const lines = [
    '🌅 <b>Briefing</b>',
    '',
    `Market cap: $${(b.globalCapUsd / 1e12).toFixed(2)}T · BTC dom: ${b.btcDominancePct.toFixed(1)}%`,
    `USDT circ: $${(b.usdtCirculating / 1e9).toFixed(1)}B · USDC: $${(b.usdcCirculating / 1e9).toFixed(1)}B`,
    '',
  ];
  for (const t of b.tickers) {
    const s = t.snapshot;
    const c = t.context;
    lines.push(
      `${s.symbol}: $${s.price.toLocaleString('en-US', { maximumFractionDigits: 2 })} · funding ${pct(c.bitgetFunding)} · spread ${c.fundingSpreadBps.toFixed(2)} bps`,
    );
  }
  return lines.join('\n');
}
