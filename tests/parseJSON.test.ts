import { describe, it, expect } from 'vitest';
import { parseJSON } from '../src/llm/index.js';

describe('parseJSON', () => {
  it('parsea JSON plano', () => {
    expect(parseJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('tolera fences markdown', () => {
    expect(parseJSON('```json\n{"b": 2}\n```')).toEqual({ b: 2 });
  });

  it('extrae JSON de texto con relleno', () => {
    expect(parseJSON('Acá va: {"c": 3} y más texto')).toEqual({ c: 3 });
  });

  it('lanza error con JSON inválido', () => {
    expect(() => parseJSON('esto no es json')).toThrow();
  });
});
