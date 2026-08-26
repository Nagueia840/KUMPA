import { describe, it, expect } from 'vitest';
import { fetchMultiTfData, type MultiTfSources } from '../src/agents/fetch-multitf.js';
import { resolveTimeframes } from '../src/utils/intent.js';
import type { TimeframeRequest } from '../src/utils/timeframes.js';

/** Crea velas crudas Bitget (string[]) para una granularidad. */
function mkCandles(n: number, endTs: number, step: number, close = 101): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push([String(t), '100', '105', '95', String(close), '10']);
  }
  return out;
}

const HOUR = 3_600_000;
const MIN = 60_000;

/** Fronteras deterministas relativas a "ahora". */
function boundaries() {
  const now = Date.now();
  return {
    hourStart: Math.floor(now / HOUR) * HOUR,
    hourPrev: Math.floor(now / HOUR) * HOUR - HOUR,
    m15Start: Math.floor(now / (15 * MIN)) * 15 * MIN,
  };
}

interface FakeOpts {
  candles?: Record<string, string[][]>;
  candlesHistory?: Record<string, string[][]>;
  rejectGranularities?: string[];
  rejectHistoryGranularities?: string[];
  neverGranularities?: string[];
  fundingReject?: boolean;
}

function fakeSources(opts: FakeOpts = {}): MultiTfSources {
  return {
    bitget: {
      getCandles: async (_symbol: string, granularity: string) => {
        if (opts.neverGranularities?.includes(granularity)) return new Promise<never>(() => {});
        if (opts.rejectGranularities?.includes(granularity)) throw new Error('boom');
        return opts.candles?.[granularity] ?? [];
      },
      getCandlesHistory: async (_symbol: string, granularity: string) => {
        if (opts.rejectHistoryGranularities?.includes(granularity)) throw new Error('boom');
        return opts.candlesHistory?.[granularity] ?? [];
      },
      getCurrentFunding: async () => {
        if (opts.fundingReject) throw new Error('boom funding');
        return { symbol: 'XUSDT', fundingRate: '0.000005', nextUpdate: String(Date.now()) };
      },
      getTicker: async () => ({ symbol: 'XUSDT', lastPr: '78500' }),
    },
  } as unknown as MultiTfSources;
}

const req = (tf: string): TimeframeRequest => ({ tf, bitget: tf, source: 'explicit' }) as TimeframeRequest;

describe('FASE B — fetch multitemporal (fuentes simuladas)', () => {
  it('1) fetch de un TF explícito', async () => {
    const b = boundaries();
    const sources = fakeSources({ candles: { '1H': mkCandles(30, b.hourStart, HOUR) } });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('1H')]);
    const block = ctx['BTCUSDT']?.timeframes?.['1H'];
    expect(block?.valido).toBe(true);
    expect(block?.velas_total).toBe(30);
    expect(block?.granularidad_bitget).toBe('1H');
  });

  it('2) fetch de múltiples TF', async () => {
    const b = boundaries();
    const sources = fakeSources({
      candlesHistory: { '1D': mkCandles(220, b.hourStart, 24 * HOUR) },
      candles: { '4H': mkCandles(220, b.hourStart, 4 * HOUR), '1H': mkCandles(30, b.hourStart, HOUR) },
    });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('1D'), req('4H'), req('1H')]);
    expect(Object.keys(ctx['BTCUSDT']?.timeframes ?? {})).toEqual(['1D', '4H', '1H']);
    for (const tf of ['1D', '4H', '1H'] as const) {
      expect(ctx['BTCUSDT']?.timeframes?.[tf]?.valido).toBe(true);
    }
  });

  it('3) política default: "¿Cómo ves BTC?" → 1W + 1D + 4H', async () => {
    const b = boundaries();
    const sources = fakeSources({
      candlesHistory: {
        '1W': mkCandles(78, b.hourStart, 7 * 24 * HOUR),
        '1D': mkCandles(220, b.hourStart, 24 * HOUR),
      },
      candles: { '4H': mkCandles(220, b.hourStart, 4 * HOUR) },
    });
    const tfs = resolveTimeframes('¿Cómo ves BTC?').map((r) => r.tf);
    expect(tfs).toEqual(['1W', '1D', '4H']);
    const ctx = await fetchMultiTfData(sources, ['BTC'], resolveTimeframes('¿Cómo ves BTC?'));
    expect(Object.keys(ctx['BTCUSDT']?.timeframes ?? {})).toEqual(['1W', '1D', '4H']);
  });

  it('4) política entrada: 1D + 4H + 1H + 15m (tope 4)', async () => {
    const b = boundaries();
    const sources = fakeSources({
      candlesHistory: { '1D': mkCandles(220, b.hourStart, 24 * HOUR) },
      candles: {
        '4H': mkCandles(220, b.hourStart, 4 * HOUR),
        '1H': mkCandles(30, b.hourStart, HOUR),
        '15m': mkCandles(40, b.m15Start, 15 * MIN),
      },
    });
    expect(resolveTimeframes('¿Entrarías ahora en ETH?').map((r) => r.tf)).toEqual(['1D', '4H', '1H', '15m']);
    const ctx = await fetchMultiTfData(sources, ['ETH'], resolveTimeframes('¿Entrarías ahora en ETH?'));
    expect(Object.keys(ctx['ETHUSDT']?.timeframes ?? {})).toEqual(['1D', '4H', '1H', '15m']);
  });

  it('5) política scalp: 1H + 15m + 5m', async () => {
    const b = boundaries();
    const sources = fakeSources({
      candles: {
        '1H': mkCandles(30, b.hourStart, HOUR),
        '15m': mkCandles(40, b.m15Start, 15 * MIN),
        '5m': mkCandles(50, b.m15Start, 5 * MIN),
      },
    });
    expect(resolveTimeframes('Scalp BTC').map((r) => r.tf)).toEqual(['1H', '15m', '5m']);
    const ctx = await fetchMultiTfData(sources, ['BTC'], resolveTimeframes('Scalp BTC'));
    expect(Object.keys(ctx['BTCUSDT']?.timeframes ?? {})).toEqual(['1H', '15m', '5m']);
  });

  it('6) "solo 15m": se respeta el explícito (sin política)', async () => {
    const b = boundaries();
    const sources = fakeSources({ candles: { '15m': mkCandles(40, b.m15Start, 15 * MIN) } });
    const tfs = resolveTimeframes('no me interesa el contexto macro, mirame solo 15m');
    expect(tfs.map((r) => r.tf)).toEqual(['15m']);
    const ctx = await fetchMultiTfData(sources, ['BTC'], tfs);
    expect(Object.keys(ctx['BTCUSDT']?.timeframes ?? {})).toEqual(['15m']);
  });

  it('7) fallo parcial de un TF: 15m falla, 1H funciona, y no se sustituye 15m', async () => {
    const b = boundaries();
    const sources = fakeSources({
      candles: { '1H': mkCandles(30, b.hourStart, HOUR) },
      rejectGranularities: ['15m'],
    });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('15m'), req('1H')]);
    const tf = ctx['BTCUSDT']?.timeframes ?? {};
    expect(Object.keys(tf)).toEqual(['15m', '1H']);
    expect(tf['15m']?.valido).toBe(false);
    expect(tf['15m']?.status).toBe('fetch_failed');
    expect(tf['15m']?.error).toBe('boom');
    expect(tf['1H']?.valido).toBe(true);
  });

  it('8) fallo total de un símbolo → valido:false con motivo', async () => {
    const sources = fakeSources({ fundingReject: true });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('1H')]);
    const s = ctx['BTCUSDT'];
    expect(s?.valido).toBe(false);
    expect(s?.status).toBe('fetch_failed');
    expect(s?.error).toBe('boom funding');
    expect(s?.timeframes).toBeUndefined();
  });

  it('9) vela viva EXCLUIDA del cálculo de indicadores', async () => {
    const b = boundaries();
    // 30 velas 1H: las 29 primeras cierran en 101; la última (live) cierra en 200.
    const raw = mkCandles(29, b.hourStart - HOUR, HOUR, 101);
    raw.push([String(b.hourStart), '100', '205', '95', '200', '10']);
    const sources = fakeSources({ candles: { '1H': raw } });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('1H')]);
    const block = ctx['BTCUSDT']?.timeframes?.['1H'];
    expect(block?.ultima_vela_estado).toBe('live');
    expect(block?.vela_viva?.close).toBe(200);
    expect(block?.cierre_ultima_cerrada).toBe(101); // cierre de la última CERRADA
    expect(block?.indicadores['ema20']).toBe(101); // capa estructura: EMA20 de las cerradas
  });

  it('10) vela viva incluida como metadata solo cuando es live', async () => {
    const b = boundaries();
    const liveSources = fakeSources({ candles: { '1H': mkCandles(30, b.hourStart, HOUR) } });
    const closedSources = fakeSources({ candles: { '1H': mkCandles(30, b.hourPrev, HOUR) } });
    const liveCtx = await fetchMultiTfData(liveSources, ['BTC'], [req('1H')]);
    const closedCtx = await fetchMultiTfData(closedSources, ['BTC'], [req('1H')]);
    expect(liveCtx['BTCUSDT']?.timeframes?.['1H']?.vela_viva).toBeDefined();
    expect(closedCtx['BTCUSDT']?.timeframes?.['1H']?.vela_viva).toBeUndefined();
    expect(closedCtx['BTCUSDT']?.timeframes?.['1H']?.ultima_vela_estado).toBe('closed');
  });

  it('11) indicadores no disponibles por historia insuficiente (1M, 21 velas)', async () => {
    const b = boundaries();
    const sources = fakeSources({ candlesHistory: { '1M': mkCandles(21, b.hourStart, 30 * 24 * HOUR) } });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('1M')]);
    const block = ctx['BTCUSDT']?.timeframes?.['1M'];
    expect(block?.no_disponible).toContain('sma50');
    expect(block?.no_disponible).toContain('macd');
    expect(block?.indicadores['macd_linea']).toBeUndefined();
    expect(block?.indicadores['sma50']).toBeUndefined();
    expect(block?.indicadores['rsi']).toBeDefined();
  });

  it('12) contexto JSON con dos TF, indicadores asociados a cada marco', async () => {
    const b = boundaries();
    const sources = fakeSources({
      candlesHistory: { '1D': mkCandles(220, b.hourStart, 24 * HOUR) },
      candles: { '1H': mkCandles(30, b.hourStart, HOUR) },
    });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('1D'), req('1H')]);
    const tf = ctx['BTCUSDT']?.timeframes ?? {};
    expect(Object.keys(tf)).toEqual(['1D', '1H']);
    expect(tf['1D']?.indicadores['sma200']).toBeDefined(); // capa contexto
    expect(tf['1H']?.indicadores['mfi']).toBeDefined(); // capa estructura
    expect(tf['1H']?.indicadores['sma200']).toBeUndefined(); // no mezclar capas
  });

  it('13) dos activos × varios TF', async () => {
    const b = boundaries();
    const sources = fakeSources({
      candles: {
        '1H': mkCandles(30, b.hourStart, HOUR),
        '15m': mkCandles(40, b.m15Start, 15 * MIN),
      },
    });
    const ctx = await fetchMultiTfData(sources, ['BTC', 'ETH'], [req('1H'), req('15m')]);
    expect(Object.keys(ctx)).toEqual(['BTCUSDT', 'ETHUSDT']);
    for (const pair of ['BTCUSDT', 'ETHUSDT'] as const) {
      expect(Object.keys(ctx[pair]?.timeframes ?? {})).toEqual(['1H', '15m']);
    }
  });

  it('14) timeout de un TF no bloquea al resto', async () => {
    const b = boundaries();
    const sources = fakeSources({
      candles: { '1H': mkCandles(30, b.hourStart, HOUR) },
      neverGranularities: ['15m'],
    });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('15m'), req('1H')], { timeoutMs: 60 });
    const tf = ctx['BTCUSDT']?.timeframes ?? {};
    expect(tf['15m']?.valido).toBe(false);
    expect(tf['15m']?.status).toBe('timeout');
    expect(tf['15m']?.error).toContain('timeout');
    expect(tf['1H']?.valido).toBe(true);
    expect(ctx['BTCUSDT']?.valido).toBe(true);
  });

  it('15) NO sustitución por 1D: si 15m falla, no aparece ningún otro TF', async () => {
    const sources = fakeSources({ rejectGranularities: ['15m'] });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('15m')]);
    const tf = ctx['BTCUSDT']?.timeframes ?? {};
    expect(Object.keys(tf)).toEqual(['15m']);
    expect(tf['15m']?.valido).toBe(false);
    expect(tf['15m']?.error).toBe('boom');
    expect(tf['1D']).toBeUndefined();
    expect(tf['1H']).toBeUndefined();
  });

  it('FASE E — orden de velas normalizado (Bitget puede devolver descendente)', async () => {
    const b = boundaries();
    // Velas en orden DESCENDENTE (nuevo → viejo) como a veces devuelve el endpoint.
    const desc = mkCandles(60, b.hourStart, HOUR).reverse();
    const sources = fakeSources({ candles: { '1H': desc } });
    const ctx = await fetchMultiTfData(sources, ['BTC'], [req('1H')]);
    const block = ctx['BTCUSDT']?.timeframes?.['1H'];
    expect(block?.valido).toBe(true);
    expect(block?.velas_total).toBe(60);
    expect(block?.ultima_vela_ts_ms).toBe(b.hourStart); // la última vela es la más nueva
    expect(block?.indicadores['rsi']).toBeDefined(); // RSI calculado sobre serie ordenada asc
  });
});
