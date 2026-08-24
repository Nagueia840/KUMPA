import { describe, it, expect } from 'vitest';
import { buildSignature, encryptPassphrase } from '../src/data/bitget/sign.js';

describe('bitget signing', () => {
  it('firma con el vector conocido', () => {
    const sig = buildSignature({
      secretKey: 'test-secret',
      timestamp: '1620000000000',
      method: 'GET',
      requestPath: '/api/v2/mix/market/ticker',
      body: '?symbol=BTCUSDT&productType=USDT-FUTURES',
    });
    expect(sig).toBe('S+3cyDr4luVCTu62iVZ0rGx4A3nDlrRR4YyYucSpIE0=');
  });

  it('encripta passphrase con el vector conocido', () => {
    expect(encryptPassphrase('test-secret', 'my-passphrase')).toBe(
      'skH1gY3Fa2juwcL2yojKpyJOTE4d3kaipsMvSedWgQI=',
    );
  });

  it('es determinista', () => {
    const args = {
      secretKey: 'k',
      timestamp: '1',
      method: 'GET',
      requestPath: '/p',
      body: '',
    };
    expect(buildSignature(args)).toBe(buildSignature(args));
  });
});
