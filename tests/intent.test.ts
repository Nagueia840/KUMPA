import { describe, it, expect } from 'vitest';
import { detectIntent, policyTimeframes, resolveTimeframes } from '../src/utils/intent.js';

const tfs = (text: string) => resolveTimeframes(text).map((t) => t.tf);

describe('detectIntent — intención por regex', () => {
  it('default general: "¿Cómo ves BTC?"', () => {
    expect(detectIntent('¿Cómo ves BTC?')).toBe('general');
  });

  it('entrada: "¿Entrarías ahora en ETH?"', () => {
    expect(detectIntent('¿Entrarías ahora en ETH?')).toBe('entrada');
  });

  it('scalp: "Scalp BTC"', () => {
    expect(detectIntent('Scalp BTC')).toBe('scalp');
  });

  it('alerta: "avisame si BTC supera 80000"', () => {
    expect(detectIntent('avisame si BTC supera 80000')).toBe('alerta');
  });

  it('análisis completo: "mirá el panorama completo"', () => {
    expect(detectIntent('mirá el panorama completo')).toBe('analisis_completo');
  });

  it('swing y niveles', () => {
    expect(detectIntent('quiero un trade swing')).toBe('swing');
    expect(detectIntent('dónde está el soporte?')).toBe('niveles');
  });
});

describe('policyTimeframes — política por intención', () => {
  it('general → contexto 1W+1D, estructura 4H', () => {
    expect(policyTimeframes('general')).toEqual(['1W', '1D', '4H']);
  });

  it('entrada → 1D + 4H/1H + 15m (tope 4)', () => {
    expect(policyTimeframes('entrada')).toEqual(['1D', '4H', '1H', '15m']);
  });

  it('scalp → 1H + 15m + 5m', () => {
    expect(policyTimeframes('scalp')).toEqual(['1H', '15m', '5m']);
  });

  it('análisis completo → 1W,1D,4H,1H', () => {
    expect(policyTimeframes('analisis_completo')).toEqual(['1W', '1D', '4H', '1H']);
  });

  it('alerta → solo 1D de contexto', () => {
    expect(policyTimeframes('alerta')).toEqual(['1D']);
  });
});

describe('resolveTimeframes — el usuario manda; la política solo si no especifica', () => {
  it('sin TF → política general', () => {
    const r = resolveTimeframes('¿Cómo ves BTC?');
    expect(tfs('¿Cómo ves BTC?')).toEqual(['1W', '1D', '4H']);
    expect(r.every((t) => t.source === 'policy')).toBe(true);
    expect(r.every((t) => t.bitget.length > 0)).toBe(true);
  });

  it('TF explícito respetado: "mirame solo 15m" → solo 15m (sin sustituir)', () => {
    expect(tfs('no me interesa el contexto macro, mirame solo 15m')).toEqual(['15m']);
  });

  it('TF explícito respetado: "contexto semanal y entrada en 15 minutos"', () => {
    expect(tfs('quiero contexto semanal y gatillo de entrada en 15 minutos')).toEqual(['1W', '15m']);
  });

  it('comparación multi-TF: "Comparame RSI 4H con RSI 1H"', () => {
    expect(tfs('Comparame RSI 4H con RSI 1H')).toEqual(['4H', '1H']);
  });

  it('estructura 5m vs 1H: "¿La estructura de 5m acompaña la de 1H?" (orden grueso→fino)', () => {
    expect(tfs('¿La estructura de 5m acompaña la de 1H?')).toEqual(['1H', '5m']);
  });
});
