import { describe, it, expect } from 'vitest';
import { collectToolResultClaims, buildAllowedClaims, withToolClaims } from '../src/agents/claims.js';
import { validateReply } from '../src/utils/validator.js';
import { guardedFinalize, GUARD_REFUSAL_TEXT } from '../src/agents/guarded-reply.js';
import { buildMultiTfSymbol, attachTfBlock, buildMultiTfContext } from '../src/utils/multitf.js';

/**
 * REGRESIÓN: FALSO POSITIVO DEL GUARD (-2470 en producción, update 30098837).
 *
 * Causa raíz demostrada: `collectToolResultClaims` etiquetaba los números de las
 * tools con field `tool:<path>` (ej. tool:priceUsd, tool:indicators.macd_histograma),
 * que NUNCA matchea los LABELS[].fields canónicos del validator ('precio',
 * 'macd_linea', 'rsi'...). El LLM citaba números REALES de get_market_snapshot /
 * get_technical_indicators y el guard los marcaba "sin respaldo" → GUARD_REFUSAL_TEXT.
 *
 * Fix: normalizar en el borde — los campos CONOCIDOS de tool se mapean al
 * vocabulario canónico (priceUsd→precio, indicators.macd.histogram→macd_histograma...).
 * `source:'tool'` se mantiene (trazabilidad). Los campos desconocidos conservan
 * `tool:<path>` y NO otorgan respaldo.
 */

// ── Resultado real de get_technical_indicators (computeAllIndicators) ─────────
const techToolResult = {
  symbol: 'ETH',
  timeframe: '1d',
  indicators: {
    price: 3455,
    vwapWeekly: 3430,
    sma20: 3400,
    sma50: 3300,
    rsi14: 42.5,
    macd: { macd: -2400, signal: 70, histogram: -2470 },
    atr14: 95,
    bollinger: { lower: 3200, middle: 3455, upper: 3710 },
    pivotPoints: { pivot: 3455, r1: 3550, s1: 3350 },
  },
};

// ── Resultado real de get_market_snapshot (fix Bitget-first) ──────────────────
const snapshotToolResult = {
  symbol: 'ETH',
  pair: 'ETHUSDT',
  source: 'Bitget',
  primaryStatus: 'ok',
  crosschecks: { binance: 'unavailable', bybit: 'unavailable' },
  price: 3455.5,
  quoteAsset: 'USDT',
  fundingBitgetPct: 0.01,
  fundingBinancePct: 0,
  fundingBybitPct: 0,
  fundingSpreadBps: 1,
  openInterestBitget: 12500,
  openInterestBybit: 0,
  annualizedFundingPct: 10.95,
  premiumPct: 0.1,
  volume24h: 123456789,
  btcDominancePct: 55,
  globalCapUsd: 2.5e12,
};

function claimsFor(results: unknown[], fallback = 'ETH') {
  const toolClaims = results.flatMap((r) => collectToolResultClaims(r, fallback));
  return withToolClaims(buildAllowedClaims({}), toolClaims);
}

describe('T1 — priceUsd legítimo de tool es aceptado', () => {
  it('get_market_snapshot priceUsd → field "precio" → cita aceptada', () => {
    const claims = claimsFor([snapshotToolResult]);
    const v = validateReply('ETH está en 3455.5 según el mercado.', claims);
    expect(v.valid).toBe(true);
  });

  it('get_technical_indicators price → field "precio" → cita aceptada', () => {
    const claims = claimsFor([techToolResult]);
    const v = validateReply('El precio de ETH es 3455.', claims);
    expect(v.valid).toBe(true);
  });
});

describe('T2 — funding legítimo de tool es aceptado', () => {
  it('fundingBitgetPct → field "funding_pct" → cita aceptada', () => {
    const claims = claimsFor([snapshotToolResult]);
    const v = validateReply('ETH tiene un funding de 0.01%.', claims);
    expect(v.valid).toBe(true);
  });
});

describe('T3 — open interest legítimo es aceptado', () => {
  it('openInterestBitget → field "open_interest" → cita aceptada', () => {
    const claims = claimsFor([snapshotToolResult]);
    const v = validateReply('El open interest de ETH es 12500.', claims);
    expect(v.valid).toBe(true);
  });
});

describe('T4 — valores negativos legítimos (como -2470) son aceptados', () => {
  it('macd_histograma = -2470 (caso real de producción) → aceptado', () => {
    const claims = claimsFor([techToolResult]);
    const v = validateReply('El MACD de ETH está en -2470.', claims);
    expect(v.valid).toBe(true);
    expect(v.violations).toEqual([]);
  });

  it('macd_linea = -2400 → aceptado', () => {
    const claims = claimsFor([techToolResult]);
    const v = validateReply('La línea MACD de ETH está en -2400.', claims);
    expect(v.valid).toBe(true);
  });
});

describe('T5 — número inventado por LLM sigue siendo rechazado', () => {
  it('3000 no está en ningún claim → rechazado', () => {
    const claims = claimsFor([snapshotToolResult, techToolResult]);
    const v = validateReply('ETH va a 3000 seguro, es soporte clave.', claims);
    expect(v.valid).toBe(false);
    expect(v.violations[0]?.reason).toMatch(/3000/);
  });
});

describe('T6 — número cercano pero fuera de tolerancia sigue rechazado', () => {
  it('precio 2900 vs real 3455 (fuera de 0.5%) → rechazado', () => {
    const claims = claimsFor([snapshotToolResult]);
    const v = validateReply('ETH cotiza en 2900 según el análisis, lejos del precio actual.', claims);
    expect(v.valid).toBe(false);
  });
});

describe('T7 — número perteneciente a otro símbolo no valida ETH', () => {
  it('BTC priceUsd no respalda cita sobre ETH', () => {
    const btc = { ...snapshotToolResult, symbol: 'BTC', priceUsd: 98000 };
    const claims = claimsFor([btc], 'BTC');
    const v = validateReply('ETH está en 3455.5 según el análisis, cerca del soporte.', claims); // cita de ETH, claims solo BTC
    expect(v.valid).toBe(false);
  });
});

describe('T8 — ausencia de claim sigue rechazando el número', () => {
  it('hay claims (funding) pero el número de precio citado NO tiene claim → rechazado', () => {
    // ClaimSet NO vacío (funding existe) pero SIN claim de precio → "3455.5" sin respaldo
    const claims = claimsFor([{ symbol: 'ETH', fundingBitgetPct: 0.01 }]);
    const v = validateReply('ETH está en 3455.5 según el análisis, cerca del soporte.', claims);
    expect(v.valid).toBe(false);
  });

  it('ClaimSet completamente vacío → el guard no audita (diseño: sin claims no hay números permitidos que citar)', () => {
    // Caso límite de diseño (documentado como riesgo): isEmpty → valid:true.
    // El guard protege cuando hay claims; sin claims el prompt es la única barrera.
    const claims = buildAllowedClaims({});
    expect(claims.isEmpty).toBe(true);
    expect(validateReply('ETH está en 3455.5 según el análisis, cerca del soporte.', claims).valid).toBe(true);
  });
});

describe('T9 — flujo con toolClaims + canonical claims funciona conjuntamente', () => {
  it('pre-fetch canónico (precio/rsi) + toolClaims (macd -2470) juntos', () => {
    // pre-fetch multi-TF con ETH valido:true
    const tf1d = {
      valido: true,
      status: 'ok' as const,
      candleCount: 220,
      cierre_ultima_cerrada: 3440,
      vela_viva: { time: Date.now(), open: 3450, high: 3460, low: 3445, close: 3455 },
      indicadores: { rsi: 58.2, vwap_sesion: 3435.5 },
    };
    let s = buildMultiTfSymbol('ETH', { price: 3455, fundingPct: '0.0100%' });
    s = attachTfBlock(s, '1D', tf1d as never);
    const canonical = buildAllowedClaims(buildMultiTfContext([s]));
    const toolClaims = collectToolResultClaims(techToolResult, 'ETH');
    const claims = withToolClaims(canonical, toolClaims);
    const v = validateReply('ETH está en 3455, el RSI en 58.2 y el MACD en -2470.', claims);
    expect(v.valid).toBe(true);
  });
});

describe('T10 — guardedFinalize deja de devolver GUARD_REFUSAL_TEXT para respuesta respaldada', () => {
  it('respuesta completamente respaldada por toolClaims → status ok', async () => {
    const claims = claimsFor([techToolResult]);
    const result = await guardedFinalize(
      'El MACD de ETH está en -2470 y el RSI en 42.5.',
      claims,
      async () => '',
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.text).not.toBe(GUARD_REFUSAL_TEXT);
  });
});

describe('T11 — guardedFinalize SIGUE devolviendo refusal ante números inventados', () => {
  it('respuesta con 3000 inventado 2 veces → refused → GUARD_REFUSAL_TEXT', async () => {
    const claims = claimsFor([techToolResult]);
    const result = await guardedFinalize(
      'ETH va a 3000 según mi análisis, es soporte clave.',
      claims,
      async () => 'Reitero: ETH va a 3000 según mi análisis.',
    );
    expect(result.status).toBe('refused');
    if (result.status === 'refused') expect(result.reason).toMatch(/sin respaldo|violación/);
  });
});
