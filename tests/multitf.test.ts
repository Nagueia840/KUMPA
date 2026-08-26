import { describe, it, expect } from 'vitest';
import {
  attachTfBlock,
  buildInvalidSymbol,
  buildInvalidTfBlock,
  buildMultiTfContext,
  buildMultiTfSymbol,
  buildTfBlock,
  isLiveCandle,
  type TfCandleInput,
} from '../src/utils/multitf.js';
import { availableIndicators, missingIndicators } from '../src/config/timeframes.js';
import { MULTITF_INSTRUCTIONS } from '../src/config/personality.js';

/** Genera `n` velas cerradas consecutivas terminando en `endTs` (duración fija `step`). */
function makeCandles(n: number, endTs: number, step: number): TfCandleInput[] {
  const out: TfCandleInput[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ time: endTs - (n - 1 - i) * step, open: 100, high: 105, low: 95, close: 101, volume: 10 });
  }
  return out;
}

const HOUR = 3_600_000;

describe('isLiveCandle — vela abierta vs cerrada', () => {
  const now = Date.parse('2026-08-26T18:00:00Z');

  it('5m: vela que abrió hace 1 min → live; hace 10 min → closed', () => {
    expect(isLiveCandle('5m', now - 60_000, now)).toBe(true);
    expect(isLiveCandle('5m', now - 600_000, now)).toBe(false);
  });

  it('1D: vela que abrió hoy 16:00Z → live; la de ayer → closed', () => {
    expect(isLiveCandle('1D', Date.parse('2026-08-26T16:00:00Z'), now)).toBe(true);
    expect(isLiveCandle('1D', Date.parse('2026-08-25T16:00:00Z'), now)).toBe(false);
  });

  it('1M (calendario UTC+8): vela de agosto (abre 31/07 16:00Z) → live en agosto', () => {
    expect(isLiveCandle('1M', Date.parse('2026-07-31T16:00:00Z'), now)).toBe(true);
    expect(isLiveCandle('1M', Date.parse('2026-06-30T16:00:00Z'), now)).toBe(false);
  });
});

describe('buildTfBlock — bloque por timeframe', () => {
  it('1W con 78 velas → sma50 disponible, sma100/sma200 no', () => {
    const block = buildTfBlock('1W', makeCandles(78, Date.parse('2026-08-23T16:00:00Z'), 7 * 24 * HOUR), Date.parse('2026-08-26T18:00:00Z'));
    expect(block.valido).toBe(true);
    expect(block.indicadores_disponibles).toContain('sma50');
    expect(block.no_disponible).toContain('sma100');
    expect(block.no_disponible).toContain('sma200');
  });

  it('1M con 21 velas → rsi/superTrend disponibles, macd/sma50 no', () => {
    const block = buildTfBlock('1M', makeCandles(21, Date.parse('2026-07-31T16:00:00Z'), 30 * 24 * HOUR), Date.parse('2026-08-26T18:00:00Z'));
    expect(block.indicadores_disponibles).toContain('rsi');
    expect(block.indicadores_disponibles).toContain('superTrend');
    expect(block.no_disponible).toContain('macd');
    expect(block.no_disponible).toContain('sma50');
  });

  it('1D con 540 velas → todo disponible en la capa contexto', () => {
    const block = buildTfBlock('1D', makeCandles(540, Date.parse('2026-08-26T16:00:00Z'), 24 * HOUR), Date.parse('2026-08-26T18:00:00Z'));
    expect(block.no_disponible).toEqual([]);
    expect(block.indicadores_disponibles).toContain('sma200');
  });

  it('marca ultima_vela_estado live/closed y timestamp', () => {
    const live = buildTfBlock('1H', makeCandles(10, Date.parse('2026-08-26T17:00:00Z'), HOUR), Date.parse('2026-08-26T18:00:00Z'));
    const closed = buildTfBlock('1H', makeCandles(10, Date.parse('2026-08-26T10:00:00Z'), HOUR), Date.parse('2026-08-26T18:00:00Z'));
    expect(live.ultima_vela_estado).toBe('closed'); // 17:00 + 1h = 18:00, no > 18:00
    expect(closed.ultima_vela_estado).toBe('closed');
    const live5m = buildTfBlock('5m', makeCandles(10, now5m(), 300_000), Date.now());
    expect(live5m.ultima_vela_estado).toBe('live');
    expect(live.ultima_vela_ts_ms).toBe(Date.parse('2026-08-26T17:00:00Z'));
  });

  it('velas insuficientes → no_disponible amplio', () => {
    const block = buildTfBlock('4H', [], Date.now());
    expect(block.velas_total).toBe(0);
    expect(block.ultima_vela_ts_ms).toBeNull();
    expect(block.cierre_ultima_cerrada).toBeNull();
    expect(block.no_disponible.length).toBeGreaterThan(0);
  });
});

function now5m(): number {
  const n = Date.now();
  return Math.floor(n / 300_000) * 300_000;
}

describe('Fase B — valido, vela_viva y cierre de última vela cerrada', () => {
  it('buildTfBlock acepta closedCount, indicadores y velaViva', () => {
    const candles = makeCandles(30, now5m(), 300_000);
    const block = buildTfBlock('5m', candles, Date.now(), {
      closedCount: 29,
      indicadores: { rsi: 55.2 },
      velaViva: { time: candles[29]!.time, open: 100, high: 105, low: 95, close: 101 },
      cierreUltimaCerrada: 101,
    });
    expect(block.valido).toBe(true);
    expect(block.indicadores).toEqual({ rsi: 55.2 });
    expect(block.vela_viva?.close).toBe(101);
    expect(block.cierre_ultima_cerrada).toBe(101);
    expect(block.indicadores_disponibles).toEqual(availableIndicators('5m', 29));
  });

  it('buildInvalidTfBlock marca valido:false con status y error (sin sustituir)', () => {
    const block = buildInvalidTfBlock('15m', 'fetch_failed', 'boom');
    expect(block.valido).toBe(false);
    expect(block.status).toBe('fetch_failed');
    expect(block.error).toBe('boom');
    expect(block.granularidad_bitget).toBe('15m');
    expect(block.indicadores).toEqual({});
  });

  it('símbolo con bloque inválido conserva el resto de TF', () => {
    const s = buildMultiTfSymbol('BTC');
    const with15m = attachTfBlock(s, '15m', buildInvalidTfBlock('15m', 'timeout', 'timeout 15m'));
    const with1h = attachTfBlock(with15m, '1H', buildTfBlock('1H', [], Date.now()));
    expect(Object.keys(with1h.timeframes ?? {})).toEqual(['15m', '1H']);
    expect(with1h.timeframes?.['15m']?.valido).toBe(false);
    expect(with1h.timeframes?.['15m']?.status).toBe('timeout');
    expect(with1h.timeframes?.['1H']?.valido).toBe(true);
  });
});

describe('buildMultiTfSymbol / buildMultiTfContext — ensamblado del JSON', () => {
  it('símbolo válido con precio/funding y timeframes vacío', () => {
    const s = buildMultiTfSymbol('btc', { price: 78505, fundingPct: '0.0005%' });
    expect(s.symbol).toBe('BTC');
    expect(s.market).toBe('USDT-FUTURES');
    expect(s.exchange).toBe('Bitget');
    expect(s.valido).toBe(true);
    expect(s.precio).toBe(78505);
    expect(s.funding_pct).toBe('0.0005%');
    expect(s.timeframes).toEqual({});
  });

  it('símbolo inválido lleva error y valido:false', () => {
    const s = buildInvalidSymbol('SOL', 'fetch falló');
    expect(s.valido).toBe(false);
    expect(s.error).toBe('fetch falló');
  });

  it('attachTfBlock adjunta sin pisar otros TF', () => {
    const s = buildMultiTfSymbol('ETH');
    const with1d = attachTfBlock(s, '1D', buildTfBlock('1D', [], Date.now()));
    const with4h = attachTfBlock(with1d, '4H', buildTfBlock('4H', [], Date.now()));
    expect(Object.keys(with4h.timeframes ?? {})).toEqual(['1D', '4H']);
  });

  it('contexto agrupado por par BTCUSDT', () => {
    const ctx = buildMultiTfContext([buildMultiTfSymbol('BTC'), buildInvalidSymbol('SOL', 'x')]);
    expect(ctx['BTCUSDT']?.symbol).toBe('BTC');
    expect(ctx['SOLUSDT']?.valido).toBe(false);
  });
});

describe('availableIndicators / missingIndicators', () => {
  it('1W con 78 velas: sma50 ok, sma100 y sma200 no', () => {
    expect(availableIndicators('1W', 78)).toContain('sma50');
    expect(missingIndicators('1W', 78)).toContain('sma100');
    expect(missingIndicators('1W', 78)).toContain('sma200');
  });

  it('1D con 540 velas: capa contexto completa', () => {
    expect(missingIndicators('1D', 540)).toEqual([]);
  });

  it('5m con 120 velas: capa ejecución (sin sma200, no aplica)', () => {
    expect(availableIndicators('5m', 120)).toContain('vwap_sesion');
    expect(availableIndicators('5m', 120)).toContain('obv');
  });
});

describe('MULTITF_INSTRUCTIONS — reglas de prompt definidas', () => {
  it('incluye la prohibición de sustituir TF y el manejo de no_disponible', () => {
    expect(MULTITF_INSTRUCTIONS).toContain('no_disponible');
    expect(MULTITF_INSTRUCTIONS).toContain('jamás presentes un análisis de otro timeframe');
    expect(MULTITF_INSTRUCTIONS).toContain('ultima_vela_estado');
  });
});
