import { describe, it, expect } from 'vitest';
import { toVectorLiteral } from '../src/llm/embed.js';

describe('toVectorLiteral', () => {
  it('convierte array a literal vector', () => {
    expect(toVectorLiteral([1, 2, 3])).toBe('[1,2,3]');
  });

  it('maneja array vacío', () => {
    expect(toVectorLiteral([])).toBe('[]');
  });

  it('maneja floats', () => {
    expect(toVectorLiteral([0.1, -0.2])).toBe('[0.1,-0.2]');
  });
});
