import { describe, it, expect } from 'vitest';
import { detectTicker } from '../src/utils/tickers.js';

describe('detectTicker', () => {
  it('detecta cashtag', () => {
    expect(detectTicker('compré $SOL')).toBe('SOL');
  });

  it('detecta ticker standalone', () => {
    expect(detectTicker('qué onda btc')).toBe('BTC');
  });

  it('detecta par USDT', () => {
    expect(detectTicker('mirá ETHUSDT')).toBe('ETH');
  });

  it('detecta nombre', () => {
    expect(detectTicker('cómo está bitcoin hoy')).toBe('BTC');
  });

  it('no detecta nada en un saludo', () => {
    expect(detectTicker('buenas cómo va')).toBeNull();
  });
});
