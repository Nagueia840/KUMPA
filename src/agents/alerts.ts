import type { AggregatedScan } from '../data/snapshot.js';
import type { AlertRule, AlertType } from '../types/index.js';

export interface AlertParseResult {
  type: AlertType;
  symbol: string;
  threshold: number;
}

export interface AlertCheckResult {
  triggered: boolean;
  currentValue: number;
  message?: string;
}

/**
 * Parsea un comando de alerta:
 *   "funding BTC > 0.05"  → funding_above, threshold 0.0005 (funding en %, 0.05 = 0.05%)
 *   "funding BTC < 0.01"  → funding_below
 *   "precio BTC > 80000"  → price_above, threshold 80000 (USD)
 *   "precio BTC < 75000"  → price_below
 */
export function parseAlert(input: string): AlertParseResult | null {
  const m = input.trim().match(/^(funding|precio|price)\s+([A-Za-z0-9]+)\s*(>|<)\s*([\d.]+)$/i);
  if (!m) return null;

  const metric = (m[1] ?? '').toLowerCase();
  const symbol = (m[2] ?? '').toUpperCase();
  const above = m[3] === '>';
  const value = Number(m[4]);

  if (!symbol || Number.isNaN(value)) return null;

  if (metric === 'funding') {
    // El usuario da funding en %: 0.05 → 0.0005 (decimal)
    return { type: above ? 'funding_above' : 'funding_below', symbol, threshold: value / 100 };
  }
  return { type: above ? 'price_above' : 'price_below', symbol, threshold: value };
}

/** Evalúa una regla contra datos en vivo. Puro y testeable. */
export function checkAlert(rule: AlertRule, scan: AggregatedScan): AlertCheckResult {
  const funding = scan.context.binanceFunding; // decimal
  const price = scan.snapshot.price;

  let currentValue: number;
  let triggered = false;
  let label = '';

  switch (rule.type) {
    case 'funding_above':
      currentValue = funding;
      triggered = funding > rule.threshold;
      label = `funding ${(funding * 100).toFixed(4)}% > ${(rule.threshold * 100).toFixed(4)}%`;
      break;
    case 'funding_below':
      currentValue = funding;
      triggered = funding < rule.threshold;
      label = `funding ${(funding * 100).toFixed(4)}% < ${(rule.threshold * 100).toFixed(4)}%`;
      break;
    case 'price_above':
      currentValue = price;
      triggered = price > rule.threshold;
      label = `precio $${price.toLocaleString('en-US')} > $${rule.threshold.toLocaleString('en-US')}`;
      break;
    case 'price_below':
      currentValue = price;
      triggered = price < rule.threshold;
      label = `precio $${price.toLocaleString('en-US')} < $${rule.threshold.toLocaleString('en-US')}`;
      break;
    default:
      currentValue = 0;
  }

  return {
    triggered,
    currentValue,
    message: triggered ? `🔔 Alerta <b>${rule.symbol}</b>: ${label}` : undefined,
  };
}
