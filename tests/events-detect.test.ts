import { describe, it, expect } from 'vitest';
import {
  detectEventIntent,
  extractClaimedTime,
  extractEventInfo,
  resolveRelativeDate,
} from '../src/events/detect.js';

const NOW = Date.parse('2026-08-26T18:00:00Z');

describe('detectEventIntent — detección determinista (casos 1-13)', () => {
  it.each([
    ['hoy presenta Nvidia', 'earnings'],
    ['resultados de Nvidia', 'earnings'],
    ['Nvidia earnings', 'earnings'],
    ['FOMC hoy', 'macro'],
    ['la Fed decide tasas', 'macro'],
    ['CPI mañana', 'macro'],
    ['sale el dato de empleo', 'macro'],
    ['ETF de Bitcoin', 'crypto'],
    ['la SEC decide sobre el ETF', 'crypto'],
    ['hack de protocolo', 'crypto'],
    ['token unlock mañana', 'crypto'],
  ])('detecta "%s" → %s', (text, expected) => {
    expect(detectEventIntent(text)?.type).toBe(expected);
  });

  it('12) consulta técnica normal → NO dispara web forzada', () => {
    expect(detectEventIntent('¿cómo ves BTC con RSI 78 y el soporte en 77.944?')).toBeNull();
  });

  it('13) conversación general → NO dispara web forzada', () => {
    expect(detectEventIntent('hola, ¿cómo andás?')).toBeNull();
    expect(detectEventIntent('gracias por el análisis')).toBeNull();
  });
});

describe('extractClaimedTime — hora dicha por el usuario', () => {
  it('a las 17 → 17:00', () => {
    expect(extractClaimedTime('Nvidia presenta hoy a las 17')?.hour).toBe(17);
  });
  it('a las 15:30 → 15:30', () => {
    const t = extractClaimedTime('el FOMC es a las 15:30');
    expect(t?.hour).toBe(15);
    expect(t?.minute).toBe(30);
  });
  it('4:20 PM ET → 16:20 con timezone', () => {
    const t = extractClaimedTime('el CPI sale a las 4:20 PM ET');
    expect(t?.hour).toBe(16);
    expect(t?.minute).toBe(20);
    expect(t?.timezone).toBe('ET');
  });
  it('12 PM → 12:00; 12 AM → 00:00', () => {
    expect(extractClaimedTime('a las 12 PM')?.hour).toBe(12);
    expect(extractClaimedTime('a las 12 AM')?.hour).toBe(0);
  });
  it('sin hora → null', () => {
    expect(extractClaimedTime('mirá el gráfico de BTC')).toBeNull();
  });
});

describe('resolveRelativeDate — referencias relativas con fecha real', () => {
  it('hoy → fecha actual; mañana → +1; ayer → -1', () => {
    expect(resolveRelativeDate('hoy presenta Nvidia', NOW)?.label).toBe('hoy');
    expect(resolveRelativeDate('CPI mañana', NOW)?.date).toBe('2026-08-27');
    expect(resolveRelativeDate('pasó ayer', NOW)?.date).toBe('2026-08-25');
  });
  it('sin referencia temporal → null', () => {
    expect(resolveRelativeDate('analizame BTC en 4H', NOW)).toBeNull();
  });
});

describe('extractEventInfo — extracción de entidad/evento/fecha/hora', () => {
  it('Nvidia presenta hoy a las 17 (BTC después)', () => {
    const info = extractEventInfo('Nvidia presenta hoy a las 17 y quiero ver BTC después', NOW);
    expect(info.entity).toBe('Nvidia');
    expect(info.type).toBe('earnings');
    expect(info.relativeDate?.label).toBe('hoy');
    expect(info.claimedTime?.hour).toBe(17);
    expect(info.userAsset).toBe('BTC');
  });

  it('el FOMC es a las 15 → entidad FOMC, hora 15', () => {
    const info = extractEventInfo('el FOMC es a las 15', NOW);
    expect(info.entity).toBe('FOMC');
    expect(info.claimedTime?.hour).toBe(15);
  });

  it('CPI mañana → entidad CPI, fecha mañana', () => {
    const info = extractEventInfo('CPI mañana', NOW);
    expect(info.entity).toBe('CPI');
    expect(info.relativeDate?.date).toBe('2026-08-27');
  });

  it('lo incierto queda null (no se convierte en hecho)', () => {
    const info = extractEventInfo('hay una noticia importante', NOW);
    expect(info.entity).toBeNull();
    expect(info.claimedTime).toBeNull();
  });
});
