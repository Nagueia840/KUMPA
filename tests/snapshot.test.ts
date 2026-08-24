import { describe, it, expect } from 'vitest';
import { toPerpPair } from '../src/data/snapshot.js';

describe('toPerpPair', () => {
  it('convierte BTC a BTCUSDT', () => {
    expect(toPerpPair('BTC')).toBe('BTCUSDT');
  });

  it('convierte ETHUSD a ETHUSDT', () => {
    expect(toPerpPair('ETHUSD')).toBe('ETHUSDT');
  });

  it('deja BTCUSDT igual', () => {
    expect(toPerpPair('BTCUSDT')).toBe('BTCUSDT');
  });

  it('normaliza minúsculas', () => {
    expect(toPerpPair('btc')).toBe('BTCUSDT');
  });
});
