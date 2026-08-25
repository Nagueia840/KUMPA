import { describe, it, expect } from 'vitest';
import { parseAlert, checkAlert } from '../src/agents/alerts.js';
import type { AggregatedScan } from '../src/data/snapshot.js';
import type { AlertRule } from '../src/types/index.js';

function makeScan(funding: number, price: number): AggregatedScan {
  return {
    symbol: 'BTC',
    pair: 'BTCUSDT',
    snapshot: {
      symbol: 'BTC',
      price,
      fundingRate: funding,
      fundingRate7dAvg: funding,
      openInterest: 0,
      openInterestDelta24h: 0,
      basisAnnualized: 0,
      volume24h: 0,
      updatedAt: 0,
    },
    context: {
      globalCapUsd: 0,
      btcDominancePct: 0,
      bitgetFunding: funding,
      binanceFunding: funding,
      bybitFunding: funding,
      fundingSpreadBps: 0,
      markPrice: price,
      indexPrice: price,
      bitgetOI: 0,
      bybitOI: 0,
    },
  };
}

describe('parseAlert', () => {
  it('parsea funding above (0.05% → 0.0005)', () => {
    expect(parseAlert('funding BTC > 0.05')).toEqual({
      type: 'funding_above',
      symbol: 'BTC',
      threshold: 0.0005,
    });
  });

  it('parsea precio below', () => {
    expect(parseAlert('precio ETH < 3000')).toEqual({
      type: 'price_below',
      symbol: 'ETH',
      threshold: 3000,
    });
  });

  it('rechaza texto inválido', () => {
    expect(parseAlert('hola mundo')).toBeNull();
  });
});

describe('checkAlert', () => {
  it('dispara funding_above cuando supera el umbral', () => {
    const rule: AlertRule = {
      chatId: 1,
      type: 'funding_above',
      symbol: 'BTC',
      threshold: 0.0005,
      active: true,
      createdAt: 0,
    };
    expect(checkAlert(rule, makeScan(0.0006, 78000)).triggered).toBe(true);
  });

  it('no dispara funding_above si está debajo', () => {
    const rule: AlertRule = {
      chatId: 1,
      type: 'funding_above',
      symbol: 'BTC',
      threshold: 0.0005,
      active: true,
      createdAt: 0,
    };
    expect(checkAlert(rule, makeScan(0.0004, 78000)).triggered).toBe(false);
  });

  it('dispara price_below', () => {
    const rule: AlertRule = {
      chatId: 1,
      type: 'price_below',
      symbol: 'BTC',
      threshold: 80000,
      active: true,
      createdAt: 0,
    };
    expect(checkAlert(rule, makeScan(0.0005, 79000)).triggered).toBe(true);
  });
});
