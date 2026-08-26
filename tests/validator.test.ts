import { describe, it, expect } from 'vitest';
import { parseMarketNumber } from '../src/utils/numbers.js';
import { validateReply } from '../src/utils/validator.js';
import { buildAllowedClaims } from '../src/agents/claims.js';
import type { ClaimSet, MarketClaim } from '../src/agents/claims.js';

function claims(list: MarketClaim[]): ClaimSet {
  const bySymbol = new Map<string, MarketClaim[]>();
  for (const c of list) {
    const a = bySymbol.get(c.symbol) ?? [];
    a.push(c);
    bySymbol.set(c.symbol, a);
  }
  return { claims: list, bySymbol, isEmpty: list.length === 0 };
}

/** Set típico de claims de BTC (+ ETH) como los que genera el pre-fetch de Fase B. */
function btcEthClaims(): ClaimSet {
  return claims([
    { symbol: 'BTC', field: 'precio', value: 78429.7, source: 'ticker' },
    { symbol: 'BTC', field: 'funding_pct', value: -0.0004, source: 'funding' },
    { symbol: 'BTC', timeframe: '1D', field: 'rsi', value: 78.5, source: 'calculado' },
    { symbol: 'BTC', timeframe: '1D', field: 'atr', value: 2287, source: 'calculado' },
    { symbol: 'BTC', timeframe: '1D', field: 'sma20', value: 68833, source: 'calculado' },
    { symbol: 'BTC', timeframe: '1D', field: 'sma50', value: 66030, source: 'calculado' },
    { symbol: 'BTC', timeframe: '1D', field: 'cierre', value: 77973.9, source: 'candles' },
    { symbol: 'BTC', timeframe: '1D', field: 'viva_close', value: 78429.7, source: 'candles' },
    { symbol: 'BTC', timeframe: '1D', field: 'williamsR', value: -38.6, source: 'calculado' },
    { symbol: 'BTC', timeframe: '4H', field: 'rsi', value: 53.5, source: 'calculado' },
    { symbol: 'BTC', timeframe: '1H', field: 'mfi', value: 26.9, source: 'calculado' },
    { symbol: 'BTC', timeframe: '1M', field: 'rsi', value: 60, source: 'calculado' },
    { symbol: 'ETH', field: 'precio', value: 2471.3, source: 'ticker' },
    { symbol: 'ETH', field: 'funding_pct', value: 0.0021, source: 'funding' },
  ]);
}

const valid = (text: string, set: ClaimSet = btcEthClaims()) => validateReply(text, set).valid;

describe('parseMarketNumber — formatos AR/internacionales', () => {
  it.each([
    ['78.429', 78429],
    ['78,429', 78429],
    ['78.429,7', 78429.7],
    ['78,429.7', 78429.7],
    ['79,3', 79.3],
    ['0,0007', 0.0007],
    ['78.4k', 78400],
    ['1.2M', 1200000],
    ['-0,0004%', -0.0004],
    ['−38.6', -38.6],
    ['100.000', 100000],
    ['1.971', 1971],
    ['2.466,5', 2466.5],
    ['abc', null],
  ])('parseMarketNumber(%s) → %s', (input, expected) => {
    expect(parseMarketNumber(input)).toBe(expected);
  });
});

describe('GUARD — casos obligatorios (20)', () => {
  it('1) precio exacto permitido', () => {
    expect(valid('BTC está en 78.429')).toBe(true);
  });

  it('2) precio redondeado permitido', () => {
    expect(valid('BTC cerró en 78.430')).toBe(true);
  });

  it('3) formato k permitido', () => {
    expect(valid('BTC está en 78.4k')).toBe(true);
  });

  it('4) funding permitido', () => {
    expect(valid('el funding de BTC es -0,0004%')).toBe(true);
  });

  it('5) funding inventado bloqueado', () => {
    expect(valid('el funding de BTC es 0,05%')).toBe(false);
  });

  it('6) RSI correcto permitido', () => {
    expect(valid('el RSI diario de BTC es 78')).toBe(true);
  });

  it('7) RSI inventado bloqueado', () => {
    expect(valid('el RSI diario de BTC es 95')).toBe(false);
  });

  it('8) RSI correcto pero TF incorrecto bloqueado', () => {
    // 53 es el RSI 4H; la frase dice "diario" (1D) → no respalda
    expect(valid('el RSI diario de BTC es 53')).toBe(false);
    expect(valid('el RSI 4H de BTC es 53')).toBe(true);
  });

  it('9) número BTC usado como ETH bloqueado', () => {
    expect(valid('ETH está en 78.429')).toBe(false);
  });

  it('10) indicador no_disponible bloqueado (SMA50 mensual)', () => {
    expect(valid('el SMA50 mensual de BTC es 20.000')).toBe(false);
  });

  it('11) TF fallido no genera números (RSI 15m sin datos)', () => {
    expect(valid('el RSI de 15m de BTC es 55')).toBe(false);
  });

  it('12) símbolo totalmente fallido', () => {
    const sinEth = claims(btcEthClaims().claims.filter((c) => c.symbol !== 'ETH'));
    expect(valid('ETH está en 2.000', sinEth)).toBe(false);
  });

  it('13) números conversacionales inocuos', () => {
    expect(valid('miraría 3 escenarios y tengo 2 posibilidades')).toBe(true);
  });

  it('16) múltiples activos', () => {
    expect(valid('BTC en 78.429 y ETH en 2.471')).toBe(true);
  });

  it('17) múltiples TF', () => {
    expect(valid('RSI diario de BTC 78 y RSI 4H 53')).toBe(true);
    expect(valid('RSI diario de BTC 53 y RSI 4H 78')).toBe(false); // valores cruzados
  });

  it('18) valor negativo (Williams %R)', () => {
    expect(valid('el Williams %R diario de BTC está en -38.6')).toBe(true);
    expect(valid('el Williams %R diario de BTC está en -80')).toBe(false);
  });

  it('19) porcentajes', () => {
    expect(valid('funding de ETH 0,0021%')).toBe(true);
    expect(valid('funding de ETH 0,05%')).toBe(false);
  });

  it('20) vela viva correctamente identificada', () => {
    expect(valid('la vela viva de BTC está en 78.429')).toBe(true);
    expect(valid('la vela viva de BTC está en 100.000')).toBe(false);
  });
});

describe('GUARD — hipótesis vs dato', () => {
  it('frase hipotética NO se audita (escenario, no dato)', () => {
    expect(valid('Si BTC estuviera en 100.000, el mercado sería otro')).toBe(true);
    expect(valid('Supongamos que BTC vale 100.000: ¿qué harías?')).toBe(true);
  });

  it('afirmación sin marca hipotética SÍ se bloquea', () => {
    expect(valid('BTC está en 100.000')).toBe(false);
  });

  it('estimación explícita se bloquea', () => {
    expect(valid('te estimo el RSI diario en 55')).toBe(false);
  });
});

describe('FASE E — campos nuevos fluyen a allowed claims', () => {
  it('superTrend_nivel/vwap_sesion/ema9 del contexto entran a los claims', () => {
    const ctx = {
      BTCUSDT: {
        symbol: 'BTC', market: 'USDT-FUTURES', exchange: 'Bitget', valido: true, precio: 78429.7,
        timeframes: {
          '1H': {
            valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget', velas_total: 220,
            ultima_vela_estado: 'closed', ultima_vela_ts_ms: 1, cierre_ultima_cerrada: 78400,
            indicadores_disponibles: [], no_disponible: [],
            indicadores: { superTrend_nivel: 78123, superTrend_direccion: 'up', vwap_sesion: 78200, ema9: 78350, rsi: 55.2 },
          },
        },
      },
    } as never;
    const set = buildAllowedClaims(ctx);
    const fields = set.claims.map((c) => c.field);
    expect(fields).toContain('superTrend_nivel');
    expect(fields).toContain('vwap_sesion');
    expect(fields).toContain('ema9');
    expect(fields).toContain('rsi');
  });
});
