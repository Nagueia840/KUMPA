import { describe, it, expect } from 'vitest';
import { stripReasoning } from '../src/llm/index.js';

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
