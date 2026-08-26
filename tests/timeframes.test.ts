import { describe, it, expect } from 'vitest';
import { extractTimeframes } from '../src/utils/timeframes.js';

const tfs = (text: string) => extractTimeframes(text).map((t) => t.tf);

describe('extractTimeframes — parser de timeframes', () => {
  it('detecta 4H en "Analizame BTC en 4 horas"', () => {
    expect(tfs('Analizame BTC en 4 horas')).toEqual(['4H']);
  });

  it('detecta 1H en "Mirá ETH en 1 hora"', () => {
    expect(tfs('Mirá ETH en 1 hora')).toEqual(['1H']);
  });

  it('detecta múltiples TF ordenados de grueso a fino', () => {
    expect(tfs('Analizame BTC completo: semanal, diario, 4H y 1H')).toEqual(['1W', '1D', '4H', '1H']);
  });

  it('detecta 15m y 5m por nombre y abreviatura', () => {
    expect(tfs('entrada en 15 minutos')).toEqual(['15m']);
    expect(tfs('entrada en quince minutos')).toEqual(['15m']);
    expect(tfs('scalp en 5m')).toEqual(['5m']);
    expect(tfs('scalp en cinco minutos')).toEqual(['5m']);
  });

  it('"5m" y "1H" juntos salen ordenados grueso→fino', () => {
    expect(tfs('¿la estructura de 5m acompaña la de 1H?')).toEqual(['1H', '5m']);
  });

  it('1M mayúscula = mensual; 1m minúscula NO es un TF de la política', () => {
    expect(tfs('mirá el gráfico 1M')).toEqual(['1M']);
    expect(tfs('mensual')).toEqual(['1M']);
    expect(tfs('5 meses')).toContain('1M');
    expect(tfs('escaloná cada 1m')).toEqual([]);
  });

  it('distingue tiempo relativo de timeframe ("hace 4 horas" no es 4H)', () => {
    expect(tfs('subió hace 4 horas')).toEqual([]);
    expect(tfs('te confirmo dentro de 15 minutos')).toEqual([]);
  });

  it('no confunde "1M usd" (millón) con el timeframe mensual', () => {
    expect(tfs('capitalización de 1M usd')).toEqual([]);
  });

  it('alias por nombre: semanal/semana/diario/día/daily', () => {
    expect(tfs('contexto semanal')).toEqual(['1W']);
    expect(tfs('mirá la semana')).toEqual(['1W']);
    expect(tfs('análisis diario')).toEqual(['1D']);
    expect(tfs('cierre del día')).toEqual(['1D']);
    expect(tfs('daily view')).toEqual(['1D']);
  });

  it('devuelve [] cuando no hay ningún timeframe', () => {
    expect(tfs('hola, ¿cómo andás?')).toEqual([]);
    expect(tfs('hoy entrega resultados Nvidia')).toEqual([]);
  });

  it('devuelve bitget correcto para cada TF', () => {
    const r = extractTimeframes('semanal, diario, 4H, 1H, 15m, 5m, 1M');
    expect(r.map((x) => x.bitget)).toEqual(['1M', '1W', '1D', '4H', '1H', '15m', '5m']);
  });
});
