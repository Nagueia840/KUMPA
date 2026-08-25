import { describe, it, expect } from 'vitest';
import { shouldFallbackProvider, stripReasoning } from '../src/llm/index.js';

describe('stripReasoning', () => {
  it('elimina bloque <think>', () => {
    const raw = '<think>razonamiento interno</think>\n\nBuenas, ¿todo bien?';
    expect(stripReasoning(raw)).toBe('Buenas, ¿todo bien?');
  });

  it('deja texto limpio sin tocar', () => {
    expect(stripReasoning('Hola, ¿cómo va?')).toBe('Hola, ¿cómo va?');
  });

  it('elimina zero-width spaces', () => {
    expect(stripReasoning('precio\u200b\u200b: 78k')).toBe('precio: 78k');
  });
});

describe('shouldFallbackProvider', () => {
  it('hace fallback en 429 (rate limit)', () => {
    expect(shouldFallbackProvider({ status: 429 })).toBe(true);
  });

  it('hace fallback en 5xx', () => {
    expect(shouldFallbackProvider({ status: 502 })).toBe(true);
  });

  it('hace fallback en 401 (auth)', () => {
    expect(shouldFallbackProvider({ status: 401 })).toBe(true);
  });

  it('hace fallback en mensajes de cuota', () => {
    expect(shouldFallbackProvider(new Error('Rate limit reached for model on tokens per day'))).toBe(true);
  });

  it('NO hace fallback en 400 (bad request, el error es del request)', () => {
    expect(shouldFallbackProvider({ status: 400 })).toBe(false);
  });
});
