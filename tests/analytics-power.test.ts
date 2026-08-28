import { describe, it, expect } from 'vitest';
import {
  buildSymbolSynthesis,
  buildSynthesisBlock,
  readDerivados,
  formatSynthesis,
} from '../src/agents/synthesis.js';
import {
  buildMultiTfSymbol,
  attachTfBlock,
  buildMultiTfContext,
  type TfBlock,
} from '../src/utils/multitf.js';
import { computeLayerIndicators } from '../src/data/layer-indicators.js';
import { sanitizeOutput } from '../src/utils/sanitize.js';
import { validateReply } from '../src/utils/validator.js';
import { buildAllowedClaims, collectToolResultClaims, withToolClaims } from '../src/agents/claims.js';
import { ANALYTIC_INSTRUCTIONS } from '../src/config/personality.js';
import { processUpdate } from '../src/webhook/queue.js';
import { buildAggregatedScan } from '../src/data/snapshot.js';
import type { Candle } from '../src/data/indicators.js';

/**
 * FASE F — POTENCIA ANALÍTICA ("Ferrari a nafta").
 * Fija el contrato: el pipeline debe comportarse como ANALISTA (familias →
 * confluencias → jerarquía multi-TF → escenarios → niveles → riesgo), NO como
 * impresora de indicadores. Y los defectos A–F quedan prohibidos por test.
 */

// ── fixtures ────────────────────────────────────────────────────────────────
function mkCandles(n: number, endTs: number, step: number, close = 101, vol = 10): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const t = endTs - (n - 1 - i) * step;
    out.push({ time: t, open: close - 10, high: close + 30, low: close - 20, close, volume: vol });
  }
  return out;
}

const HOUR = 3_600_000;
const nowAnchor = Math.floor(Date.now() / HOUR) * HOUR;

function tfBlock(tf: '1W' | '1D' | '4H' | '1H' | '15m' | '5m', n: number, step: number, close: number): TfBlock {
  const cs = mkCandles(n, nowAnchor, step, close);
  const ind = computeLayerIndicators(tf, cs, close);
  const b: TfBlock = {
    valido: true, status: 'ok', granularidad_bitget: tf, fuente: 'Bitget',
    velas_total: n, ultima_vela_estado: 'closed', ultima_vela_ts_ms: cs[cs.length - 1]!.time,
    cierre_ultima_cerrada: close, indicadores_disponibles: [], no_disponible: [],
    indicadores: ind,
  };
  const stDir = ind['superTrend_direccion'];
  if (stDir === 'up') b.superTrend_rol = 'soporte';
  else if (stDir === 'down') b.superTrend_rol = 'resistencia';
  return b;
}

function ethContext() {
  let s = buildMultiTfSymbol('ETH', { price: 2495, fundingPct: '0.0200%', quoteAsset: 'USDT' });
  s = attachTfBlock(s, '1W', tfBlock('1W', 78, 7 * 24 * HOUR, 2380));
  s = attachTfBlock(s, '1D', tfBlock('1D', 220, 24 * HOUR, 2495));
  s = attachTfBlock(s, '4H', tfBlock('4H', 220, 4 * HOUR, 2505));
  s = attachTfBlock(s, '1H', tfBlock('1H', 220, HOUR, 2488));
  s = attachTfBlock(s, '15m', tfBlock('15m', 120, 15 * 60_000, 2492));
  return s;
}

// ── T1. Consulta profunda recibe múltiples familias ─────────────────────────
describe('T1 — análisis profundo recibe información de múltiples familias', () => {
  it('buildSymbolSynthesis expone las 5 familias técnicas por TF', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    const familias = new Set<string>();
    for (const r of syn.timeframes) for (const f of r.familias) familias.add(f.familia);
    for (const fam of ['TENDENCIA', 'MOMENTUM', 'VOLUMEN', 'VOLATILIDAD', 'ESTRUCTURA']) {
      expect(familias.has(fam)).toBe(true);
    }
  });
  it('la síntesis incluye DERIVADOS cuando hay funding', () => {
    const der = readDerivados(ethContext());
    expect(der.familia).toBe('DERIVADOS');
    expect(der.senales.length).toBeGreaterThan(0);
  });
});

// ── T2. Contexto incluye tendencia+momentum+volumen+volatilidad+estructura ──
describe('T2 — el contexto incluye las familias cuando están disponibles', () => {
  it('cada TF con datos aporta señales de sus familias disponibles', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    for (const r of syn.timeframes) {
      // Con fixtures de 78-220 velas, al menos 2 familias tienen señales.
      const conSenales = r.familias.filter((f) => f.senales.length > 0);
      expect(conSenales.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('bloque de síntesis para el contexto completo no vacío', () => {
    const ctx = buildMultiTfContext([ethContext()]);
    const block = buildSynthesisBlock(ctx);
    expect(block.length).toBeGreaterThan(50);
    expect(block).toContain('LECTURA ESTRUCTURADA');
  });
});

// ── T3. Jerarquía 1W/1D/4H/1H/15m/5m conservada ─────────────────────────────
describe('T3 — jerarquía multi-timeframe conservada', () => {
  it('lecturas ordenadas de grueso a fino', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    const tfs = syn.timeframes.map((r) => r.tf);
    const order = ['1W', '1D', '4H', '1H', '15m', '5m'];
    const idx = tfs.map((t) => order.indexOf(t));
    for (let i = 1; i < idx.length; i++) expect(idx[i]!).toBeGreaterThan(idx[i - 1]!);
  });
  it('régimen/estructura/ejecución se derivan por capa', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    expect(['alcista', 'bajista', 'mixto', 'neutral', 's/d']).toContain(syn.regimen);
    expect(['alcista', 'bajista', 'mixto', 'neutral', 's/d']).toContain(syn.estructura);
    expect(['alcista', 'bajista', 'mixto', 'neutral', 's/d']).toContain(syn.ejecucion);
  });
});

// ── T4. No enumera indicadores sin interpretación ───────────────────────────
describe('T4 — no enumera indicadores sin interpretación', () => {
  it('cada señal de familia lleva interpretación direccional', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    for (const r of syn.timeframes) {
      for (const f of r.familias) {
        for (const s of f.senales) {
          // Toda señal describe dirección/estado, no solo el número.
          expect(s.length).toBeGreaterThan(8);
        }
      }
    }
  });
  it('las instrucciones analíticas prohíben imprimir listas', () => {
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/NO enumeres indicadores/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/familias/i);
  });
});

// ── T5. Funding positivo NO = presión compradora ────────────────────────────
/**
 * Validación SEMÁNTICA (no parche de frase): detecta si un texto AFIRMA (sin
 * negación) que existe "presión compradora demostrada/confirmada". Contempla
 * negaciones explícitas inmediatamente previas: "NO presión compradora
 * demostrada" es CORRECTO (frase negada) y NO viola el contrato.
 */
function afirmaPresionCompradora(txt: string): boolean {
  const re = /presi[oó]n compradora (demostrada|confirmada)/gi;
  const NEGADORES =
    /(?:^|[\s,;:—–(])(?:no|nunca|jam[aá]s|sin|no hay|no es|no demuestra|no confirma|no implica|no existe|no prueba|no evidencia|no es evidencia)\s*$/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt)) !== null) {
    // Contexto previo dentro de la misma cláusula (hasta 48 chars antes del match).
    const before = txt.slice(Math.max(0, m.index - 48), m.index);
    if (!NEGADORES.test(before)) return true; // afirmación positiva sin negación
  }
  return false;
}

describe('T5 — funding calibrado (defecto E)', () => {
  it('1-5) síntesis: longs pagan shorts + sesgo long prudente; NO afirma presión compradora (semántica, contempla negación)', () => {
    const der = readDerivados(ethContext());
    const txt = der.senales.join(' ');
    // 1) funding positivo → "longs pagan shorts"
    expect(txt).toMatch(/longs pagan shorts/);
    // 2) sesgo/posicionamiento long, prudente
    expect(txt).toMatch(/sesgo long/i);
    // 3) NO demuestra ni confirma presión compradora (la negación está presente)
    expect(txt).toMatch(/NO presi[oó]n compradora/);
    expect(afirmaPresionCompradora(txt)).toBe(false);
    // 4) afirmación positiva "presión compradora demostrada" VIOLA el contrato
    expect(afirmaPresionCompradora('el funding muestra la presión compradora demostrada por el mercado')).toBe(true);
    // 5) afirmación positiva "presión compradora confirmada" VIOLA el contrato
    expect(afirmaPresionCompradora('los datos confirman la presión compradora confirmada')).toBe(true);
    // Formas NEGADAS correctas → no violan
    expect(afirmaPresionCompradora('NO presión compradora demostrada')).toBe(false);
    expect(afirmaPresionCompradora('no presión compradora confirmada')).toBe(false);
    expect(afirmaPresionCompradora('el funding no demuestra presión compradora demostrada')).toBe(false);
  });
  it('las instrucciones calibran el funding', () => {
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/longs pagan shorts/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/NO demuestra presi[oó]n compradora/);
  });
});

// ── T6. Precio > VWAP NO = momentum confirmado ──────────────────────────────
describe('T6 — VWAP calibrado (defecto F)', () => {
  it('la familia VOLUMEN presenta el VWAP como fortaleza relativa contextual', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    const r1d = syn.timeframes.find((r) => r.tf === '1D');
    const vol = r1d?.familias.find((f) => f.familia === 'VOLUMEN');
    const txt = vol?.senales.join(' ') ?? '';
    // Si hay señal de VWAP, debe decir "fortaleza/debilidad relativa contextual".
    if (vol && vol.senales.length > 0) {
      expect(txt).toMatch(/relativa contextual/);
    }
  });
  it('las instrucciones prohíben "VWAP = momentum confirmado"', () => {
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/momentum confirmado/i);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/fortaleza relativa CONTEXTUAL/);
    // La negación debe existir ("no momentum confirmado" / "no es confirmación").
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/(?:no|no es|nunca)[^.]*momentum confirmado|momentum confirmado[^.]*(?:por s[íi] solo)/i);
  });
});

// ── T7. ETHUSDT usa USDT ────────────────────────────────────────────────────
describe('T7 — ETHUSDT usa USDT (defecto A/C)', () => {
  it('la síntesis etiqueta niveles con USDT', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    expect(syn.quoteAsset).toBe('USDT');
    const todos = syn.timeframes.flatMap((r) => r.niveles).join(' ');
    expect(todos).toContain('USDT');
    expect(todos).not.toMatch(/\d+\s+USD\b/);
  });
  it('las instrucciones exigen quoteAsset para volumen y niveles', () => {
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/quoteAsset/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/USDT ≠ USD|USDT ≠ USD|USDT para ETHUSDT/);
  });
});

// ── T8. SuperTrend en español ───────────────────────────────────────────────
describe('T8 — SuperTrend se presenta en español (defecto B)', () => {
  it('la síntesis usa alcista/bajista + rol soporte/resistencia, nunca up/down crudo', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    const txt = formatSynthesis(syn);
    // El TF puede aparecer entre "SuperTrend" y la dirección ("SuperTrend 1W alcista").
    expect(txt).not.toMatch(/SuperTrend\s+(?:1W|1D|4H|1H|15m|5m)?\s*(?:up|down)\b/i);
    expect(txt).toMatch(/SuperTrend\s+(?:1W|1D|4H|1H|15m|5m)?\s*(?:alcista|bajista)/i);
  });
});

// ── T9. Sin residuos (defecto D) ────────────────────────────────────────────
describe('T9 — sin residuos de generación', () => {
  it('sanitizeOutput elimina ".commit" pegado y "underway"', () => {
    const out = sanitizeOutput('el régimen es alcista antes de.Commit. y el flujo sigue underway');
    expect(out).not.toMatch(/\.commit/i);
    expect(out).not.toMatch(/underway/i);
  });
  it('sanitizeOutput elimina CJK y tokens rotos conocidos', () => {
    expect(sanitizeOutput('SuperTrend日报 en 2391')).toBe('SuperTrend en 2391');
    expect(sanitizeOutput('la tendenciaup es alcista')).toBe('la tendencia up es alcista');
  });
  it('la regla NO mutila lenguaje válido (números, siglas, decimales)', () => {
    expect(sanitizeOutput('2.391 USDT con funding -0,0007% y RSI 68')).toBe('2.391 USDT con funding -0,0007% y RSI 68');
    expect(sanitizeOutput('EE.UU. es un mercado')).toBe('EE.UU. es un mercado');
  });
});

// ── T10. Números monetarios mantienen unidad ────────────────────────────────
describe('T10 — todos los números monetarios mantienen unidad', () => {
  it('los niveles de la síntesis llevan SIEMPRE quoteAsset', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    const niveles = syn.timeframes.flatMap((r) => r.niveles);
    expect(niveles.length).toBeGreaterThan(0);
    for (const n of niveles) expect(n).toMatch(/USDT|USD|USDC/);
  });
  it('las instrucciones obligan unidad en toda cifra de mercado', () => {
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/UNIDADES \(obligatorio en toda cifra\)/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/quoteAsset/);
  });
});

// ── T11. Guard sigue bloqueando valores inventados ──────────────────────────
describe('T11 — guard anti-alucinación sin regresión', () => {
  it('número inventado sigue rechazado', () => {
    const toolResult = { symbol: 'ETH', price: 2495.84 };
    const claims = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult, 'ETH'));
    expect(validateReply('ETH cotiza en 2000 USDT según mi análisis.', claims).valid).toBe(false);
  });
  it('valor legítimo de los nuevos campos sigue aceptado', () => {
    const toolResult = { symbol: 'ETH', indicators: { stochastic: { k: 70.8, d: 65 }, cci: 120.7, keltner: { upper: 2471, middle: 2405, lower: 2343 } } };
    const claims = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult, 'ETH'));
    const v = validateReply('El stochastic de ETH está en 70.8 y el CCI en 120.7.', claims);
    expect(v.valid).toBe(true);
  });
});

// ── T12. Bybit 403 sigue sin invalidar Bitget ───────────────────────────────
describe('T12 — Bitget-first sin regresión', () => {
  it('Bybit 403 → snapshot válido con fuente Bitget', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.primaryStatus).toBe('ok');
    expect(scan.crosschecks.bybit.status).toBe('unavailable');
  });
});

// ── T13. worker/timeouts/idempotencia sin regresión ─────────────────────────
describe('T13 — worker/timeouts/idempotencia sin regresión', () => {
  it('processUpdate con bot OK marca processed', async () => {
    const store = fakeStore();
    await store.savePendingUpdate(777, { update_id: 777 });
    const p = await store.claimPendingUpdate(777);
    const bot = { handleUpdate: async () => {} };
    expect(await processUpdate(bot as never, store, p!)).toBe(true);
    expect(store.processed.has(777)).toBe(true);
  });
  it('handleUpdate colgado → timeout controlado (no processing eterno)', async () => {
    const store = fakeStore();
    store.rows.set(778, { payload: JSON.stringify({ update_id: 778 }), status: 'processing', attempts: 1, created: 0, startedAt: Date.now() });
    const hangingBot = { handleUpdate: () => new Promise<void>(() => {}) };
    const result = await processUpdate(hangingBot as never, store, { updateId: 778, payload: JSON.stringify({ update_id: 778 }), attempts: 1 }, { budgetMs: 120 });
    expect(result).toBe(false);
    expect(store.rows.get(778)?.status).toBe('pending');
  });
});

// ── T14. BOLLINGER: posición ≠ compresión (corrección conceptual) ────────────
import {
  computeBollingerBandwidthSeries,
  bandwidthPercentile,
  classifyBandwidthState,
  computeBollinger,
  MIN_BANDWIDTH_HISTORY,
} from '../src/data/indicators.js';

/** Closes que oscilan con amplitud constante (bandwidth estable). */
function closesOsc(n: number, amp: number, base = 100): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const close = base + Math.sin(i / 3) * amp;
    out.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close, volume: 10 });
  }
  return out;
}
/** Closes cuya amplitud se estrecha 40 → 0.5 (bandwidth decreciente → contracción). */
function closesSqueezing(n: number, base = 100): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const amp = Math.max(0.5, 40 - (i / n) * 39.5);
    const close = base + Math.sin(i / 3) * amp;
    out.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close, volume: 10 });
  }
  return out;
}
/** Closes cuya amplitud crece 1 → 60 (bandwidth creciente → expansión). */
function closesExpanding(n: number, base = 100): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const amp = 1 + (i / (n - 1)) * 59;
    const close = base + Math.sin(i / 3) * amp;
    out.push({ time: t, open: close - 2, high: close + 2, low: close - 2, close, volume: 10 });
  }
  return out;
}

describe('T14 — Bollinger: POSICIÓN ≠ COMPRESIÓN (corrección conceptual)', () => {
  it('1) precio cerca de banda inferior + bandas ANCHAS → NO compresión', () => {
    const cs = closesOsc(120, 40);
    const bw = computeBollingerBandwidthSeries(cs);
    expect(bw.length).toBeGreaterThan(MIN_BANDWIDTH_HISTORY);
    const pctil = bandwidthPercentile(bw)!;
    expect(classifyBandwidthState(pctil)).not.toBe('contraccion');
    // Precio 60 muy por debajo de la media (posición inferior) con bandas anchas.
    const bb = computeBollinger(cs)!;
    expect(60).toBeLessThan(bb.middle);
    expect(bb.upper - bb.lower).toBeGreaterThan(50); // bandas realmente anchas
  });

  it('2) precio cerca de banda superior + bandas ESTRECHAS → compresión posible (independiente de la posición)', () => {
    const cs = closesSqueezing(120, 100);
    const bw = computeBollingerBandwidthSeries(cs);
    expect(bw.length).toBeGreaterThan(MIN_BANDWIDTH_HISTORY);
    const pctil = bandwidthPercentile(bw)!;
    expect(classifyBandwidthState(pctil)).toBe('contraccion');
    // Comparación RELATIVA (no umbral absoluto): ancho actual < ancho de una
    // serie de amplitud estable.
    const bb = computeBollinger(cs)!;
    const ref = computeBollinger(closesOsc(120, 40))!;
    expect(bb.upper - bb.lower).toBeLessThan(ref.upper - ref.lower);
    // Posición superior (precio 103 sobre la media) + contracción coexisten.
    const ind = computeLayerIndicators('1H', cs, 103);
    let s = buildMultiTfSymbol('ETH', { price: 103, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 103, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const vol = syn.timeframes[0]!.familias.find((f) => f.familia === 'VOLATILIDAD')!;
    expect(vol.senales.join(' ')).toMatch(/banda superior|mitad superior/);
  });

  it('3) bandwidth decreciente históricamente → contracción', () => {
    const cs = closesSqueezing(120, 100);
    const pctil = bandwidthPercentile(computeBollingerBandwidthSeries(cs));
    expect(pctil).not.toBeNull();
    expect(pctil!).toBeLessThan(25);
    expect(classifyBandwidthState(pctil)).toBe('contraccion');
  });

  it('4) bandwidth elevado/creciente → expansión, NO compresión', () => {
    const cs = closesExpanding(120, 100);
    const pctil = bandwidthPercentile(computeBollingerBandwidthSeries(cs));
    expect(pctil).not.toBeNull();
    expect(pctil!).toBeGreaterThan(75);
    expect(classifyBandwidthState(pctil)).toBe('expansion');
  });

  it('5) compresión NO asigna dirección alcista/bajista automáticamente', () => {
    const cs = closesSqueezing(120, 100);
    const ind = computeLayerIndicators('1H', cs, 100);
    expect(ind['bollinger_estado']).toBe('contraccion');
    let s = buildMultiTfSymbol('ETH', { price: 100, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 100, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const vol = syn.timeframes[0]!.familias.find((f) => f.familia === 'VOLATILIDAD')!;
    expect(vol.direccion).toBe('neutral');
    expect(vol.aFavor).toBe(0);
    expect(vol.enContra).toBe(0);
    expect(vol.senales.join(' ')).not.toMatch(/contracci[oó]n.*(alcista|bajista)|(alcista|bajista).*contracci[oó]n/i);
  });

  it('6) historial insuficiente → NO inventa estado de volatilidad', () => {
    const cs = closesOsc(30, 20); // 30 velas → serie de ~11 bandwidths
    const bw = computeBollingerBandwidthSeries(cs);
    expect(bw.length).toBeLessThan(MIN_BANDWIDTH_HISTORY);
    expect(bandwidthPercentile(bw)).toBeNull();
    expect(classifyBandwidthState(bandwidthPercentile(bw))).toBeNull();
    const ind = computeLayerIndicators('1H', cs, 100);
    expect(ind['bollinger_estado']).toBeUndefined(); // no expone estado sin historial
  });

  it('7) precio tocando banda inferior NO equivale a sobreventa automática', () => {
    const cs = closesOsc(120, 40);
    const ind = computeLayerIndicators('1H', cs, 60);
    let s = buildMultiTfSymbol('ETH', { price: 60, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 60, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const vol = syn.timeframes[0]!.familias.find((f) => f.familia === 'VOLATILIDAD')!;
    const txt = vol.senales.join(' ');
    expect(txt).toMatch(/banda inferior/);
    expect(txt).not.toMatch(/sobreventa autom[áa]tica/); // lo prohíbe explícitamente
    expect(vol.aFavor).toBe(0); // tocar banda inferior NO vota bajista
  });

  it('8) precio tocando banda superior NO equivale a sobrecompra automática', () => {
    const cs = closesOsc(120, 40);
    const ind = computeLayerIndicators('1H', cs, 150);
    let s = buildMultiTfSymbol('ETH', { price: 150, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 150, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const vol = syn.timeframes[0]!.familias.find((f) => f.familia === 'VOLATILIDAD')!;
    const txt = vol.senales.join(' ');
    expect(txt).toMatch(/banda superior/);
    expect(txt).not.toMatch(/sobrecompra autom[áa]tica/);
    expect(vol.aFavor).toBe(0);
  });

  it('9) breakout de banda requiere contexto; no genera señal automática', () => {
    const cs = closesOsc(120, 40);
    const ind = computeLayerIndicators('1H', cs, 160); // muy por encima de la banda
    let s = buildMultiTfSymbol('ETH', { price: 160, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 160, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const vol = syn.timeframes[0]!.familias.find((f) => f.familia === 'VOLATILIDAD')!;
    const txt = vol.senales.join(' ');
    expect(txt).toMatch(/no breakout confirmado|POSICIÓN/);
    expect(vol.aFavor).toBe(0); // la posición NO genera voto direccional
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/no es breakout confirmado|breakout confirmado/);
  });
});

// ── T15. Niveles MULTI-TIMEFRAME inequívocos ────────────────────────────────
describe('T15 — niveles multi-TF conservan su timeframe (cierre Fase F)', () => {
  it('cada nivel derivado lleva el TF inequívocamente', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    expect(syn.timeframes.length).toBeGreaterThan(1);
    for (const r of syn.timeframes) {
      expect(r.niveles.length).toBeGreaterThan(0);
      for (const n of r.niveles) {
        // Formato: "R1 1H: 2,589 USDT" — el TF está presente y con unidad.
        expect(n).toMatch(new RegExp(`${r.tf}:`));
        expect(n).toMatch(/USDT|USD|USDC/);
      }
    }
  });

  it('NO mezcla niveles de distintos TF como equivalentes', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    const todos = syn.timeframes.flatMap((r) => r.niveles);
    // Cada nivel menciona UN solo TF (el suyo); un nivel no puede citar dos.
    for (const n of todos) {
      const tfsMencionados = ['1W', '1D', '4H', '1H', '15m', '5m'].filter((tf) => new RegExp(`\\b${tf}:`).test(n));
      expect(tfsMencionados.length).toBe(1);
    }
  });

  it('los niveles multi-TF se usan en la lectura global/escenarios sin perder el TF', () => {
    const syn = buildSymbolSynthesis(ethContext())!;
    const txt = formatSynthesis(syn);
    // Si la síntesis emite niveles, alguno debe aparecer con TF (formato "X 1H:").
    expect(txt).toMatch(/\b(?:R1|S1|R2|S2|VWAP|SuperTrend|Banda inf|Banda sup|Fib)\s+(?:1W|1D|4H|1H|15m|5m):/);
  });
});

// ── T16. MFI calibrado + sin sobreinterpretaciones de osciladores ───────────
describe('T16 — MFI y osciladores calibrados (cierre Fase F)', () => {
  it('A) MFI elevado NO implica BUY (voto neutral + advertencia)', () => {
    // Forzamos MFI alto manipulando el flujo: cerrando siempre arriba.
    const mfiAlto = mkMfiCandles(120, 95); // flujo comprador sostenido
    const ind = computeLayerIndicators('1H', mfiAlto, 101);
    const mfiVal = ind['mfi'];
    expect(typeof mfiVal).toBe('number');
    expect(mfiVal as number).toBeGreaterThan(60);
    let s = buildMultiTfSymbol('ETH', { price: 101, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 101, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const mom = syn.timeframes[0]!.familias.find((f) => f.familia === 'MOMENTUM')!;
    const txt = mom.senales.join(' ');
    // MFI alto: descriptivo + advertencia de sobreextensión, sin voto de compra.
    expect(txt).toMatch(/flujo monetario positivo y elevado/);
    expect(txt).toMatch(/no constituye por s[íi] solo confirmaci[óo]n de compra/);
    // El MFI no aporta voto direccional por su cuenta (es neutral).
    const mfiSenal = mom.senales.find((s2) => s2.includes('MFI'))!;
    expect(mfiSenal).toBeDefined();
  });

  it('B) MFI bajo NO implica SELL (advertencia, no señal)', () => {
    const mfiBajo = mkMfiCandles(120, 5); // flujo vendedor sostenido
    const ind = computeLayerIndicators('1H', mfiBajo, 99);
    const mfiVal = ind['mfi'];
    expect(typeof mfiVal).toBe('number');
    expect(mfiVal as number).toBeLessThan(40);
    let s = buildMultiTfSymbol('ETH', { price: 99, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 99, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const mom = syn.timeframes[0]!.familias.find((f) => f.familia === 'MOMENTUM')!;
    const txt = mom.senales.join(' ');
    expect(txt).toMatch(/flujo monetario negativo y deprimido/);
    expect(txt).toMatch(/no constituye por s[íi] solo se[ñn]al de venta/);
  });

  it('C) MFI elevado marca flujo positivo + sobreextensión, sin dirección operativa', () => {
    const ind = computeLayerIndicators('1H', mkMfiCandles(120, 95), 101);
    let s = buildMultiTfSymbol('ETH', { price: 101, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 101, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const mom = syn.timeframes[0]!.familias.find((f) => f.familia === 'MOMENTUM')!;
    const mfiSenal = mom.senales.find((x) => x.includes('MFI'))!;
    expect(mfiSenal).toMatch(/positivo y elevado/);
    expect(mfiSenal).toMatch(/zona tradicionalmente extrema|extrema/);
    expect(mfiSenal).toMatch(/no constituye por s[íi] solo/);
  });

  it('D) la dirección de MOMENTUM nace de la confluencia (MFI no vota)', () => {
    const ind = computeLayerIndicators('1H', mkMfiCandles(120, 95), 101);
    let s = buildMultiTfSymbol('ETH', { price: 101, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 101, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const mom = syn.timeframes[0]!.familias.find((f) => f.familia === 'MOMENTUM')!;
    // El MFI contribuye a neutras (no a aFavor/enContra).
    expect(mom.neutras).toBeGreaterThanOrEqual(1);
  });

  it('E) MFI no aporta dos votos correlacionados por la misma lectura', () => {
    const ind = computeLayerIndicators('1H', mkMfiCandles(120, 95), 101);
    const senalesMfi = Object.entries(ind).filter(([k]) => k === 'mfi');
    // Una sola señal MFI en la capa.
    expect(senalesMfi.length).toBe(1);
    // Y en la síntesis aparece UNA sola señal MFI (no dos).
    let s = buildMultiTfSymbol('ETH', { price: 101, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 101, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const mom = syn.timeframes[0]!.familias.find((f) => f.familia === 'MOMENTUM')!;
    expect(mom.senales.filter((x) => x.includes('MFI')).length).toBe(1);
  });

  it('RSI > 70 NO es señal de venta automática (zona extrema = neutral)', () => {
    const cs = closesOsc(120, 20);
    let s = buildMultiTfSymbol('ETH', { price: 101, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 101, indicadores_disponibles: [], no_disponible: [],
      indicadores: { ...computeLayerIndicators('1H', cs, 101), rsi: 85, mfi: 50 },
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const mom = syn.timeframes[0]!.familias.find((f) => f.familia === 'MOMENTUM')!;
    const rsiSenal = mom.senales.find((x) => x.includes('RSI'))!;
    expect(rsiSenal).toMatch(/sobreextensi[óo]n/);
    expect(rsiSenal).toMatch(/no es se[ñn]al de venta por s[íi] solo/);
  });
});

// ── T17-T28. FASE F.1 — potencia analítica REAL en el LLM ───────────────────
import { truncateSafe, isLengthTruncation } from '../src/utils/sanitize.js';

/** Contexto ETH multi-TF con señales ricas en TODAS las familias. */
function ethRichContext() {
  let s = buildMultiTfSymbol('ETH', { price: 2495, fundingPct: '0.0200%', quoteAsset: 'USDT' });
  // Velas con variación para que todas las familias tengan datos.
  s = attachTfBlock(s, '1W', tfBlock('1W', 78, 7 * 24 * HOUR, 2380));
  s = attachTfBlock(s, '1D', tfBlock('1D', 220, 24 * HOUR, 2495));
  s = attachTfBlock(s, '4H', tfBlock('4H', 220, 4 * HOUR, 2505));
  s = attachTfBlock(s, '1H', tfBlock('1H', 220, HOUR, 2488));
  return s;
}

describe('T17 — síntesis profunda incluye señales de las 5 familias', () => {
  it('senalesRelevantes incluye TENDENCIA, MOMENTUM, VOLUMEN, VOLATILIDAD y ESTRUCTURA', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    for (const r of syn.timeframes) {
      const familiasConDatos = r.familias.filter((f) => f.senales.length > 0).map((f) => f.familia);
      // Cada familia con datos debe tener al menos UNA señal en senalesRelevantes.
      for (const fam of familiasConDatos) {
        const famSenales = r.familias.find((f) => f.familia === fam)!.senales;
        const enRelevantes = r.senalesRelevantes.filter((s) => famSenales.includes(s));
        expect(enRelevantes.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('T18 — ninguna familia queda excluida por palabras clave', () => {
  it('VOLUMEN/VOLATILIDAD/ESTRUCTURA aparecen aunque no digan alcista/bajista/sobre/bajo', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    for (const r of syn.timeframes) {
      const fams = r.familias.filter((f) => f.senales.length > 0).map((f) => f.familia);
      // Si la familia VOLUMEN tiene datos (VWAP/CMF), su señal está presente.
      if (fams.includes('VOLUMEN')) expect(r.senalesRelevantes.some((s) => r.familias.find((f) => f.familia === 'VOLUMEN')!.senales.includes(s))).toBe(true);
      if (fams.includes('VOLATILIDAD')) expect(r.senalesRelevantes.some((s) => r.familias.find((f) => f.familia === 'VOLATILIDAD')!.senales.includes(s))).toBe(true);
      if (fams.includes('ESTRUCTURA')) expect(r.senalesRelevantes.some((s) => r.familias.find((f) => f.familia === 'ESTRUCTURA')!.senales.includes(s))).toBe(true);
    }
  });
});

describe('T19 — sin doble conteo de indicadores correlacionados', () => {
  it('los votos aFavor/enContra son POR FAMILIA (peso único), no por indicador', () => {
    // Fixture donde TODOS los osciladores de momentum son alcistas → 1 voto de
    // familia MOMENTUM, no 5 votos.
    const ind: Record<string, unknown> = {
      rsi: 65, macd_linea: 5, macd_senal: 3, macd_histograma: 2,
      stochastic_k: 70, stochastic_d: 60, cci: 150, williamsR: -30, roc: 2, mfi: 55,
    };
    let s = buildMultiTfSymbol('ETH', { price: 101, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 101, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1H', b);
    const syn = buildSymbolSynthesis(s)!;
    const mom = syn.timeframes[0]!.familias.find((f) => f.familia === 'MOMENTUM')!;
    // aFavor cuenta señales, pero la DIRECCIÓN de la familia es UNA (alcista),
    // y en la dirección global del TF la familia vota UNA vez con su peso.
    expect(mom.direccion).toBe('alcista');
    // En el peso de la síntesis, MOMENTUM contribuye una sola vez (peso 3).
    const pesoMom = mom.peso;
    expect(pesoMom).toBe(3);
    // Verificación de no-doble-conteo: la dirección global usa el voto de la
    // familia (aFavor>enContra → alcista), no la cantidad de indicadores.
    const votosIndependientes = mom.aFavor;
    expect(votosIndependientes).toBeGreaterThanOrEqual(1);
  });
});

describe('T20 — JSON raw down/up no domina la representación española', () => {
  it('la síntesis usa alcista/bajista, nunca "SuperTrend down/up" crudo', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    const txt = formatSynthesis(syn);
    expect(txt).not.toMatch(/SuperTrend\s+(?:1W|1D|4H|1H|15m|5m)?\s*(?:up|down)\b/i);
    expect(txt).toMatch(/SuperTrend\s+(?:1W|1D|4H|1H|15m|5m)?\s*(?:alcista|bajista)/i);
  });
});

describe('T21 — ETHUSDT mantiene USDT en niveles monetarios', () => {
  it('todos los niveles llevan USDT y nunca USD a secas', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    const todos = syn.timeframes.flatMap((r) => r.niveles).join(' ');
    expect(syn.quoteAsset).toBe('USDT');
    expect(todos).toContain('USDT');
    expect(todos).not.toMatch(/\d+\s+USD\b/);
  });
});

describe('T22 — funding positivo NO se convierte en "presión compradora confirmada"', () => {
  it('la síntesis calibra: longs pagan shorts, NO presión compradora demostrada', () => {
    const der = readDerivados(ethRichContext());
    const txt = der.senales.join(' ');
    expect(txt).toMatch(/longs pagan shorts/);
    expect(txt).toMatch(/NO presi[oó]n compradora/);
    // Semántica: la frase negada "NO presión compradora demostrada" NO viola.
    expect(afirmaPresionCompradora(txt)).toBe(false);
    // Una afirmación positiva real SÍ viola.
    expect(afirmaPresionCompradora('la presión compradora demostrada por el funding')).toBe(true);
  });
});

describe('T23 — precio bajo VWAP NO se convierte en "presión vendedora confirmada"', () => {
  it('la señal de VWAP dice debilidad relativa contextual, no presión vendedora', () => {
    // Fixture con precio bajo VWAP.
    const ind: Record<string, unknown> = { vwap_sesion: 2600, precio: 2495 };
    let s = buildMultiTfSymbol('ETH', { price: 2495, fundingPct: '0.0200%', quoteAsset: 'USDT' });
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 2495, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '4H', b);
    const syn = buildSymbolSynthesis(s)!;
    const vol = syn.timeframes[0]!.familias.find((f) => f.familia === 'VOLUMEN')!;
    const txt = vol.senales.join(' ');
    expect(txt).toMatch(/debilidad relativa contextual/);
    expect(txt).not.toMatch(/presi[oó]n vendedora confirmada/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/NO "presi[oó]n vendedora confirmada"/);
  });
});

describe('T24 — output profundo contempla confluencias/escenarios/trigger/invalidación/riesgo', () => {
  it('las instrucciones analíticas exigen esos conceptos para análisis profundo', () => {
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/CONFLUENCIAS/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/ESCENARIO ALCISTA/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/ESCENARIO BAJISTA/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/Triggers de confirmaci[oó]n/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/Invalidaciones/);
    expect(ANALYTIC_INSTRUCTIONS).toMatch(/Riesgo principal/);
  });
  it('la síntesis produce confluencias y contradicciones por TF', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    expect(syn.timeframes.some((r) => r.confluencias.length > 0)).toBe(true);
    expect(syn.timeframes.some((r) => r.contradicciones.length > 0 || syn.contradiccionesInterTf.length > 0)).toBe(true);
  });
});

describe('T25 — finish_reason=length queda detectable', () => {
  it('isLengthTruncation reconoce length/max_tokens y rechaza stop/null', () => {
    expect(isLengthTruncation('length')).toBe(true);
    expect(isLengthTruncation('max_tokens')).toBe(true);
    expect(isLengthTruncation('max_tokens_reached')).toBe(true);
    expect(isLengthTruncation('stop')).toBe(false);
    expect(isLengthTruncation(null)).toBe(false);
    expect(isLengthTruncation(undefined)).toBe(false);
  });
});

describe('T26 — respuesta no termina en frase rota cuando hay truncamiento', () => {
  it('truncateSafe corta en párrafo/oración completa y agrega cierre', () => {
    const rota = 'El régimen semanal es alcista con soporte en 2.450 USDT y la estructura de 4H muestra momentum positivo, pero el volumen no confirma y el timing todavía está por definirse en el marco de 15 minutos, con el precio operando en la zona media de las bandas de Bollinger y un flujo de volumen que no acompaña la recuperación intradiaria';
    const safe = truncateSafe(rota);
    // No termina a mitad de palabra: o corta en oración completa o agrega cierre.
    expect(safe).toMatch(/Análisis recortado por límite de longitud/);
    // La parte visible no termina en palabra incompleta (siempre cierra con \n\n).
    expect(safe).not.toMatch(/[a-záéíóúñ]$/);
  });
  it('truncateSafe NO mutila texto completo multi-párrafo', () => {
    const completo = 'El régimen es alcista. La estructura 4H acompaña.\n\nEl volumen confirma.';
    expect(truncateSafe(completo)).toBe(completo);
  });
  it('truncateSafe agrega cierre a texto cortado (aunque tenga oraciones)', () => {
    // El helper recorta en el último corte de párrafo/oración y agrega cierre;
    // nunca deja una palabra rota al final.
    const cortado = 'El régimen es alcista.\n\nLa estructura 4H muestra momentum positivo pero el volumen todavía no confirma y el timing';
    const safe = truncateSafe(cortado);
    expect(safe).toMatch(/Análisis recortado por límite de longitud/);
    expect(safe).not.toMatch(/[a-záéíóúñ]$/);
    // El primer párrafo completo se conserva.
    expect(safe).toMatch(/El régimen es alcista\./);
  });
  it('truncateSafe con oración completa corta tras el punto', () => {
    const conOracion = 'Primera oración completa. Segunda oración que quedaría cortada a mitad porque el modelo se quedó sin tokens y siguió escri';
    const safe = truncateSafe(conOracion);
    expect(safe).toMatch(/Primera oración completa\./);
    expect(safe).toMatch(/Análisis recortado/);
  });
});

describe('T27 — Bybit 403 continúa siendo no fatal', () => {
  it('snapshot válido con fuente Bitget a pesar del 403', async () => {
    const scan = await buildAggregatedScan('ETH', fakeSources({ bybitFail: true, bybitStatus: 403 }));
    expect(scan.primarySource).toBe('Bitget');
    expect(scan.primaryStatus).toBe('ok');
    expect(scan.crosschecks.bybit.status).toBe('unavailable');
  });
});

describe('T28 — guard continúa bloqueando números inventados', () => {
  it('precio inventado sigue rechazado', () => {
    const toolResult = { symbol: 'ETH', price: 2495.84 };
    const claims = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult, 'ETH'));
    expect(validateReply('ETH cotiza en 2000 USDT según mi análisis.', claims).valid).toBe(false);
  });
  it('valor legítimo de síntesis sigue aceptado', () => {
    const toolResult = { symbol: 'ETH', price: 2495.84 };
    const claims = withToolClaims(buildAllowedClaims({}), collectToolResultClaims(toolResult, 'ETH'));
    expect(validateReply('ETH cotiza en 2495.84 USDT.', claims).valid).toBe(true);
  });
});

// ── T29-T36. FASE F.2 — cierre operativo (contratos semánticos determinísticos) ──
import {
  priceRelation,
} from '../src/agents/synthesis.js';
import {
  validateSemanticContracts,
  translateTechnicalResiduals,
  type SemanticFacts,
} from '../src/agents/semantic-guard.js';
import { guardedFinalize } from '../src/agents/guarded-reply.js';

describe('T29 — precio vivo vs SuperTrend confirmado (relación calculada, no inferida)', () => {
  it('priceRelation: ABOVE/BELOW/AT numéricos', () => {
    expect(priceRelation(2496.65, 2459)).toBe('ABOVE');
    expect(priceRelation(2400, 2459)).toBe('BELOW');
    expect(priceRelation(2459, 2459)).toBe('AT');
    expect(priceRelation(2459.5, 2459)).toBe('AT'); // dentro de 0.05%
  });
  it('la síntesis NO dice "precio bajo el nivel" cuando el precio vivo está por encima', () => {
    // Fixture: confirmed bearish weekly con level 2459 y precio vivo 2496.65 (caso real v11).
    let s = buildMultiTfSymbol('ETH', { price: 2496.65, fundingPct: '0.0100%', quoteAsset: 'USDT' });
    const ind: Record<string, unknown> = { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia', rsi: 84.6 };
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget',
      velas_total: 78, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 2450, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1W', b);
    const syn = buildSymbolSynthesis(s)!;
    const st = syn.timeframes[0]!.superTrend;
    expect(st).toBeDefined();
    expect(st!.confirmedState).toBe('bajista');
    expect(st!.level).toBe(2459);
    expect(st!.livePrice).toBe(2496.65);
    expect(st!.liveRelationToLevel).toBe('ABOVE');
    // La señal textual NO afirma que el precio está bajo el nivel.
    const txt = syn.timeframes[0]!.familias.find((f) => f.familia === 'TENDENCIA')!.senales.join(' ');
    expect(txt).not.toMatch(/precio vivo.*bajo el nivel/);
    expect(txt).toMatch(/POR ENCIMA/);
  });
});

describe('T30 — contango/backwardation prohibidos sin term structure', () => {
  it('validateSemanticContracts bloquea contango/backwardation con termStructureVerified=false', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    const v = validateSemanticContracts('premium en 0%, así que no hay contango ni backwardation.', facts);
    expect(v.some((x) => x.pattern === 'contango')).toBe(true);
    expect(v.some((x) => x.pattern === 'backwardation')).toBe(true);
  });
  it('respuesta correcta SIN contango/backwardation pasa', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    const v = validateSemanticContracts('El perpetuo cotiza prácticamente alineado con el índice, sin premium ni discount relevante.', facts);
    expect(v).toEqual([]);
  });
  it('guard integrado rechaza la respuesta con contango', async () => {
    const claims = withToolClaims(buildAllowedClaims({}), []);
    const r = await guardedFinalize('premium 0%, no hay contango.', claims, async () => 'el perpetuo cotiza alineado con el índice, sin premium relevante.');
    expect(r.status).toBe('ok');
    const r2 = await guardedFinalize('premium 0%, no hay contango.', claims, async () => 'premium 0%, no hay contango ni backwardation.');
    expect(r2.status).toBe('refused');
  });
});

describe('T31 — OI no identifica longs/shorts sin evidencia direccional', () => {
  it('bloquea "OI demuestra longs entrando" y "apalancamiento largo aumentando"', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('El OI aumenta y demuestra que los longs están entrando.', facts).length).toBeGreaterThan(0);
    expect(validateSemanticContracts('El apalancamiento largo está aumentando.', facts).length).toBeGreaterThan(0);
    expect(validateSemanticContracts('El OI crece: aumenta la exposición abierta.', facts)).toEqual([]);
  });
  it('frase permitida con funding como contexto pasa', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('El OI aumenta mientras el funding es positivo: crece la exposición abierta en un mercado donde los largos pagan a los cortos.', facts)).toEqual([]);
  });
});

describe('T32 — funding "altísimo/extremo" requiere benchmark', () => {
  it('bloquea "funding altísimo" sin benchmark', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('El funding es altísimo.', facts).length).toBeGreaterThan(0);
  });
  it('permite "funding positivo y costoso para longs" sin benchmark', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('El funding es positivo y costoso para longs.', facts)).toEqual([]);
  });
});

describe('T33 — cobertura de familias materiales', () => {
  it('familyCoverage marca las familias con información material', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    const cov = syn.familyCoverage;
    expect(cov.trend).toBe(true);
    expect(cov.momentum).toBe(true);
    expect(cov.volume).toBe(true);
    expect(cov.volatility).toBe(true);
    expect(cov.structure).toBe(true);
    expect(cov.derivatives).toBe(true);
  });
  it('la síntesis formateada declara la cobertura', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    expect(formatSynthesis(syn)).toMatch(/Cobertura de familias/);
  });
});

describe('T34 — confluencias/contradicciones a nivel símbolo', () => {
  it('confluenciasSimbolo/contradiccionesSimbolo derivadas del régimen', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    // Con fixture rico, al menos una familia está alineada con el régimen o en contra.
    expect(syn.confluenciasSimbolo.length + syn.contradiccionesSimbolo.length).toBeGreaterThan(0);
  });
  it('la síntesis formateada las declara', () => {
    const syn = buildSymbolSynthesis(ethRichContext())!;
    const txt = formatSynthesis(syn);
    expect(txt).toMatch(/Confluencias \(r[ée]gimen\)|Contradicciones \(r[ée]gimen\)/);
  });
});

describe('T35 — salida en español, sin residuos técnicos', () => {
  it('translateTechnicalResiduals corrige funding high / stays long / SuperTrend up-down / flat', () => {
    expect(translateTechnicalResiduals('funding high y stays long')).toBe('funding elevado y mantener largos');
    expect(translateTechnicalResiduals('SuperTrend down en 2459')).toMatch(/SuperTrend alcista\/bajista/);
    expect(translateTechnicalResiduals('premium is flat')).toMatch(/premium neutro\/alineado con índice/);
  });
  it('validateSemanticContracts detecta residuos', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('el funding high domina', facts).length).toBeGreaterThan(0);
    expect(validateSemanticContracts('el SuperTrend down marca la estructura', facts).length).toBeGreaterThan(0);
  });
});

describe('T36 — consistencia numérica de relaciones (priceRelation como hecho)', () => {
  it('la relación se calcula ANTES y coincide con los números', () => {
    const rel = priceRelation(2496.65, 2459);
    expect(rel).toBe('ABOVE');
    // Si el hecho dice ABOVE, ningún texto generado desde la síntesis dice BELOW.
    let s = buildMultiTfSymbol('ETH', { price: 2496.65, fundingPct: '0.0100%', quoteAsset: 'USDT' });
    const ind: Record<string, unknown> = { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia' };
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget',
      velas_total: 78, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 2450, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1W', b);
    const syn = buildSymbolSynthesis(s)!;
    expect(syn.timeframes[0]!.numericFacts.priceVsSuperTrend).toBe('ABOVE');
  });
  it('precio vs VWAP / S1 / R1 calculados', () => {
    let s = buildMultiTfSymbol('ETH', { price: 2496.65, fundingPct: '0.0100%', quoteAsset: 'USDT' });
    const ind: Record<string, unknown> = { vwap_sesion: 2507, pivot_s1: 2487, pivot_r1: 2520 };
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 2496.65, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '4H', b);
    const syn = buildSymbolSynthesis(s)!;
    const facts = syn.timeframes[0]!.numericFacts;
    expect(facts.priceVsVwap).toBe('BELOW'); // 2496.65 < 2507
    expect(facts.priceVsS1).toBe('ABOVE'); // 2496.65 > 2487
    expect(facts.priceVsR1).toBe('BELOW'); // 2496.65 < 2520
  });
});

// ── T37+. FASE F.3 — cierre real sobre evidencia de producción ───────────────
// Defectos reales observados: "arriba del VWAP 4H (2507)" con precio 2504.39,
// "Little room for error", "premium sigue flat", "históricamente alto de
// posicionamiento largo", "el posicionamiento no se deshizo", "con volumen",
// "antes de." como oración final rota. Cada uno debe ser IMPOSIBLE o detectado.
import {
  validateNumericRelations,
  detectLanguageResiduals,
} from '../src/agents/semantic-guard.js';
import type { RelationFact } from '../src/agents/synthesis.js';
import { ensureCompleteEnding, classifyEnding, truncateSafe } from '../src/utils/sanitize.js';
import { chunkText } from '../src/utils/telegram.js';
import type { ClaimSet, MarketClaim } from '../src/agents/claims.js';

function claimsFrom(list: MarketClaim[]): ClaimSet {
  const bySymbol = new Map<string, MarketClaim[]>();
  for (const c of list) {
    const arr = bySymbol.get(c.symbol) ?? [];
    arr.push(c);
    bySymbol.set(c.symbol, arr);
  }
  return { claims: list, bySymbol, isEmpty: list.length === 0 };
}

function f3ClaimsList(): MarketClaim[] {
  return [
    { symbol: 'ETH', field: 'precio', value: 2504.39, source: 'ticker' },
    { symbol: 'ETH', field: 'funding_pct', value: 0.01, source: 'funding' },
    { symbol: 'ETH', field: 'open_interest', value: 762000, source: 'tool' },
    { symbol: 'ETH', field: 'open_interest_prev', value: 747000, source: 'tool' },
    { symbol: 'ETH', field: 'funding_anualizado_pct', value: 10.95, source: 'tool' },
    { symbol: 'ETH', timeframe: '4H', field: 'vwap_sesion', value: 2507, source: 'calculado' },
    { symbol: 'ETH', timeframe: '4H', field: 'pivot_s1', value: 2487, source: 'calculado' },
    { symbol: 'ETH', timeframe: '4H', field: 'pivot_r1', value: 2520, source: 'calculado' },
    { symbol: 'ETH', timeframe: '1W', field: 'superTrend_nivel', value: 2459, source: 'calculado' },
    { symbol: 'ETH', timeframe: '1D', field: 'rsi', value: 84.6, source: 'calculado' },
  ];
}

/** Caso real F.3: precio 2504.39, VWAP 4H 2507 (BELOW), ST 1W 2459 (ABOVE), S1 2487 (ABOVE), R1 2520 (BELOW). */
const F3_REL: RelationFact[] = [
  { label: 'VWAP 4H', value: 2507, relation: 'BELOW' },
  { label: 'SuperTrend 1W', value: 2459, relation: 'ABOVE' },
  { label: 'S1 4H', value: 2487, relation: 'ABOVE' },
  { label: 'R1 4H', value: 2520, relation: 'BELOW' },
];

describe('T37 — F.3-A/B: contrato numérico VWAP (el hecho calculado es autoritativo)', () => {
  it('2504.39 < 2507 → BELOW; "arriba/superó/recuperó el VWAP (2507)" es violación', () => {
    const rel: RelationFact[] = [{ label: 'VWAP 4H', value: 2507, relation: 'BELOW' }];
    expect(validateNumericRelations('El precio está otra vez arriba del VWAP 4H (2507).', rel).length).toBeGreaterThan(0);
    expect(validateNumericRelations('El precio recuperó los 2500 y está otra vez arriba del VWAP 4H (2507 según el último dato).', rel).length).toBeGreaterThan(0);
    expect(validateNumericRelations('El precio superó el VWAP 4H (2.507 USDT).', rel).length).toBeGreaterThan(0);
    expect(validateNumericRelations('El precio opera por debajo del VWAP 4H (2.507 USDT).', rel)).toEqual([]);
    expect(validateNumericRelations('El precio sigue debajo del VWAP 4H (2507).', rel)).toEqual([]);
  });
  it('2510 > 2507 → ABOVE; "debajo del VWAP" es violación', () => {
    const rel: RelationFact[] = [{ label: 'VWAP 4H', value: 2507, relation: 'ABOVE' }];
    expect(validateNumericRelations('El precio cotiza por debajo del VWAP 4H (2507).', rel).length).toBeGreaterThan(0);
    expect(validateNumericRelations('El precio está por encima del VWAP 4H (2.507 USDT).', rel)).toEqual([]);
  });
  it('oraciones condicionales/escenario no se auditan (describen supuestos, no el estado actual)', () => {
    const rel: RelationFact[] = [{ label: 'VWAP 4H', value: 2507, relation: 'BELOW' }];
    expect(validateNumericRelations('Si el precio supera 2507, el escenario alcista gana peso.', rel)).toEqual([]);
    expect(validateNumericRelations('Un cierre por encima de 2.507 USDT confirmaría la recuperación.', rel)).toEqual([]);
    expect(validateNumericRelations('Si el precio pierde 2487, aumentaría la evidencia bajista.', rel)).toEqual([]);
  });
  it('negaciones no se interpretan como afirmación ("no perdió", "no superó")', () => {
    const rel: RelationFact[] = [{ label: 'S1 4H', value: 2487, relation: 'ABOVE' }];
    expect(validateNumericRelations('El precio no perdió el soporte de 2487 todavía.', rel)).toEqual([]);
    expect(validateNumericRelations('El precio no superó el nivel de 2459.', rel)).toEqual([]);
  });
});

describe('T38 — F.3-P: guardedFinalize conserva el contrato numérico (integración)', () => {
  it('respuesta con "arriba del VWAP" (hecho BELOW) → se regenera; la corregida pasa', async () => {
    const claims = claimsFrom(f3ClaimsList());
    const r = await guardedFinalize(
      'Precio en 2504.39 USDT. El precio está otra vez arriba del VWAP 4H (2507).',
      claims,
      async () => 'Precio en 2504.39 USDT. El precio opera por debajo del VWAP 4H (2.507 USDT).',
      undefined,
      F3_REL,
    );
    expect(r.status).toBe('ok');
    expect((r as { text: string }).text).toMatch(/por debajo del VWAP/);
  });
  it('regeneración que insiste en la contradicción → refused', async () => {
    const claims = claimsFrom(f3ClaimsList());
    const r = await guardedFinalize(
      'El precio está arriba del VWAP 4H (2507).',
      claims,
      async () => 'El precio superó el VWAP 4H (2507).',
      undefined,
      F3_REL,
    );
    expect(r.status).toBe('refused');
  });
});

describe('T39 — F.3-C/D: residuos lingüísticos (Little room for error, premium flat, corrupto)', () => {
  it('translateTechnicalResiduals repara los residuos narrativos observados', () => {
    expect(translateTechnicalResiduals('estás operando con Little room for error')).toBe('estás operando con poco margen de error');
    expect(translateTechnicalResiduals('el premium sigue flat')).toBe('el premium sigue plano');
    expect(translateTechnicalResiduals('flip del régimen')).toBe('cambio del régimen');
    expect(translateTechnicalResiduals('premium is flat')).toMatch(/premium neutro/);
  });
  it('detectLanguageResiduals marca inglés/italiano/corrupción', () => {
    const r = detectLanguageResiduals('muy largapgando molto');
    expect(r.some((x) => x.kind === 'corrupt' && x.token === 'largapgando')).toBe(true);
    expect(r.some((x) => x.kind === 'foreign' && x.token === 'molto')).toBe(true);
    expect(detectLanguageResiduals('Little room for error').some((x) => x.token === 'Little')).toBe(true);
    expect(detectLanguageResiduals('el funding es positivo y costoso para los largos')).toEqual([]);
    expect(detectLanguageResiduals('opera por debajo del VWAP 4H con stop en 2459')).toEqual([]);
  });
  it('guardedFinalize: residuo reparable → reparado; no reparable → refused', async () => {
    const claims = claimsFrom([]);
    const r1 = await guardedFinalize('estás operando con Little room for error', claims, async () => 'tenés poco margen para equivocarte');
    expect(r1.status).toBe('ok');
    expect((r1 as { text: string }).text).toContain('poco margen');
    const r2 = await guardedFinalize('estás operando con molto margine', claims, async () => 'seguí con molto margine');
    expect(r2.status).toBe('refused');
  });
});

describe('T40 — F.3-E/F: OI y funding sin atribución direccional', () => {
  it('"nivel históricamente alto de posicionamiento largo" → violación', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('sigues con ese nivel históricamente alto de posicionamiento largo', facts).length).toBeGreaterThan(0);
  });
  it('"el funding no aflojó, lo que te dice que el posicionamiento no se deshizo" → violación', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('El funding no aflojó, lo que te dice que el posicionamiento no se deshizo.', facts).length).toBeGreaterThan(0);
  });
  it('frases permitidas: exposición abierta + coste de mantener largos', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    const ok = 'El OI aumentó mientras el funding sigue positivo: hay más exposición abierta y mantener largos sigue teniendo costo; no alcanza para saber qué lado está iniciando esas posiciones.';
    expect(validateSemanticContracts(ok, facts)).toEqual([]);
  });
});

describe('T41 — F.3-G: funding sin benchmark', () => {
  it('"históricamente alto"/"récord"/"anormal" sin benchmark → violación', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('Funding en 0.01%: el nivel anualizado sería históricamente alto.', facts).length).toBeGreaterThan(0);
    expect(validateSemanticContracts('El funding está en un récord.', facts).length).toBeGreaterThan(0);
  });
  it('con benchmark documentado → permitido', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: true };
    expect(validateSemanticContracts('El funding está históricamente alto (percentil 97%).', facts)).toEqual([]);
  });
  it('sin benchmark: "positivo/costoso para longs" permitido', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('El funding es positivo y costoso para los largos; anualizado serían ~10.95%.', facts)).toEqual([]);
  });
});

describe('T42 — F.3-H/I: volumen sin/con benchmark', () => {
  it('"con volumen"/"volumen confirma"/"venta confirmada" sin benchmark → violación', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('si el precio pierde 2487 con volumen, ahí tenés primeras ventas.', facts).length).toBeGreaterThan(0);
    expect(validateSemanticContracts('la ruptura viene con expansión de volumen, lo que confirma ventas.', facts).length).toBeGreaterThan(0);
    expect(validateSemanticContracts('venta confirmada al perder el soporte.', facts).length).toBeGreaterThan(0);
  });
  it('semántica acumulativa permitida sin benchmark (y negación de volumen)', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('Una pérdida de 2487 aumentaría la evidencia bajista.', facts)).toEqual([]);
    expect(validateSemanticContracts('El volumen no acompaña plenamente la extensión del precio.', facts)).toEqual([]);
  });
  it('con benchmark de volumen validado → la ruptura puede ganar peso', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false, volumeBenchmarkAvailable: true };
    expect(validateSemanticContracts('Si pierde 2487 y la ruptura viene con expansión de volumen validada, la señal bajista gana peso.', facts)).toEqual([]);
  });
});

describe('T43 — F.3: evidencia acumulativa (no interruptores)', () => {
  it('"señal de venta"/"venta confirmada" bloqueadas', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('Perder 2487 sería una señal de venta.', facts).length).toBeGreaterThan(0);
    expect(validateSemanticContracts('El quiebre de 2459 es una venta confirmada.', facts).length).toBeGreaterThan(0);
  });
  it('negación permitida: "sin que eso sea señal de venta automática"', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('RSI 84,6 advierte de agotamiento, sin que eso sea señal de venta automática.', facts)).toEqual([]);
  });
  it('lenguaje acumulativo permitido', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('La pérdida de 2487 aumentaría la evidencia bajista; todavía no alcanza para confirmarla.', facts)).toEqual([]);
  });
});

describe('T44 — F.3-J: SuperTrend confirmado vs precio vivo (regresión F.2)', () => {
  it('la síntesis mantiene ambos conceptos sin contradicción', () => {
    let s = buildMultiTfSymbol('ETH', { price: 2504.39, fundingPct: '0.0100%', quoteAsset: 'USDT' });
    const ind: Record<string, unknown> = { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia', vwap_sesion: 2507, pivot_s1: 2487 };
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '1W', fuente: 'Bitget',
      velas_total: 78, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 2450, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '1W', b);
    const syn = buildSymbolSynthesis(s)!;
    const st = syn.timeframes[0]!.superTrend!;
    expect(st.confirmedState).toBe('bajista');
    expect(st.liveRelationToLevel).toBe('ABOVE');
    const rel: RelationFact[] = [{ label: 'SuperTrend 1W', value: 2459, relation: 'ABOVE' }];
    expect(validateNumericRelations('El SuperTrend semanal confirmado continúa bajista en 2459 USDT, mientras el precio vivo (2.504,39 USDT) cotiza POR ENCIMA de ese nivel.', rel)).toEqual([]);
  });
  it('la síntesis formateada declara las relaciones calculadas (hechos, no narrativa)', () => {
    let s = buildMultiTfSymbol('ETH', { price: 2504.39, fundingPct: '0.0100%', quoteAsset: 'USDT' });
    const ind: Record<string, unknown> = { superTrend_nivel: 2459, superTrend_direccion: 'down', superTrend_rol: 'resistencia', vwap_sesion: 2507, pivot_s1: 2487, pivot_r1: 2520 };
    const b: TfBlock = {
      valido: true, status: 'ok', granularidad_bitget: '4H', fuente: 'Bitget',
      velas_total: 120, ultima_vela_estado: 'closed', ultima_vela_ts_ms: nowAnchor,
      cierre_ultima_cerrada: 2504.39, indicadores_disponibles: [], no_disponible: [],
      indicadores: ind,
    };
    s = attachTfBlock(s, '4H', b);
    const syn = buildSymbolSynthesis(s)!;
    expect(formatSynthesis(syn)).toMatch(/Relaciones \(hechos calculados/);
    expect(syn.timeframes[0]!.relationFacts.some((f) => f.label === 'VWAP 4H' && f.relation === 'BELOW')).toBe(true);
  });
});

describe('T45 — F.3-K: term structure preservada (regresión F.2)', () => {
  it('contango/backwardation siguen bloqueados en perpetuos', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('el premium es 0%, sin contango.', facts).some((x) => x.pattern === 'contango')).toBe(true);
  });
});

describe('T46 — F.3-L/M/N: cierre de texto (nunca una oración final rota)', () => {
  it('"antes de." no puede quedar como final', () => {
    const t = 'esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.';
    expect(classifyEnding(t)).toBe('dangling');
    const out = ensureCompleteEnding(t);
    expect(out).not.toMatch(/antes de\.$/);
    expect(out).toMatch(/puedo continuar si quer[eé]s\.\)$/);
  });
  it('"y el timing." tampoco', () => {
    const t = 'esperaría un pullback y el timing.';
    expect(classifyEnding(t)).toBe('dangling');
    const out = ensureCompleteEnding(t);
    expect(out).not.toMatch(/el timing\.$/);
    expect(out).toMatch(/puedo continuar si quer[eé]s\.\)$/);
  });
  it('"porque el" (sin puntuación final) es mid-sentence → se cierra', () => {
    const t = 'no me gusta porque el';
    expect(classifyEnding(t)).toBe('mid-sentence');
    expect(ensureCompleteEnding(t)).toMatch(/puedo continuar si quer[eé]s\.\)$/);
  });
  it('respuesta completa y gramatical NO se mutila', () => {
    const t = 'El SuperTrend semanal confirmado continúa bajista en 2459 USDT, mientras el precio vivo cotiza por encima de ese nivel. La estructura no se rompe.';
    expect(classifyEnding(t)).toBe('complete');
    expect(ensureCompleteEnding(t)).toBe(t);
  });
  it('truncateSafe también corta el final colgante con aviso', () => {
    const out = truncateSafe('esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.');
    expect(out).not.toMatch(/antes de\.$/);
    expect(out).toMatch(/puedo continuar si quer[eé]s\.\)$/);
  });
});

describe('T47 — F.3: chunkText nunca parte palabras ni oraciones', () => {
  it('los cortes duros caen en límites de oración/espacio (sin partir palabras)', () => {
    const sentence = 'El precio opera por debajo del VWAP 4H en 2507 USDT. ';
    const text = sentence.repeat(40);
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i]!.endsWith('.')).toBe(true);
      expect(/^[A-ZÁÉÍÓÚÑ]/.test(chunks[i + 1]!)).toBe(true);
    }
  });
});

describe('T48 — F.3-P: pipeline final (defecto real completo) — no llega a Telegram', () => {
  const realResponse = [
    'Precio en 2504.39 USDT. Funding se mantiene en 0.01%, que anualizado es 10.95% — sigues con ese nivel históricamente alto de posicionamiento largo.',
    'OI subió ligeramente a 762K ETH y el premium sigue flat.',
    'el precio recuperó los 2500 y está otra vez arriba del VWAP 4H (2507 según el último dato).',
    'El funding no aflojó, lo que te dice que el posicionamiento no se deshizo.',
    'con este funding y este RSI estás operando con Little room for error.',
    'si el precio pierde 2487 con volumen, ahí tenés primeras ventas.',
    'esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.',
  ].join('\n\n');

  it('la respuesta real defectuosa NO puede pasar guardedFinalize sin reparación', async () => {
    const claims = claimsFrom(f3ClaimsList());
    // La regeneración insiste en el MISMO texto defectuoso → el guard debe rechazarla.
    const r = await guardedFinalize(realResponse, claims, async () => realResponse, undefined, F3_REL);
    expect(r.status).toBe('refused');
  });
  it('una regeneración corregida pasa y su cierre final es completo', async () => {
    const claims = claimsFrom(f3ClaimsList());
    const corregida =
      'Precio en 2504.39 USDT, funding 0.01% (10,95% anualizado, extrapolado), OI en 762K ETH (creciendo desde ~747K), premium prácticamente nulo (alineado con el índice). ' +
      'El SuperTrend semanal confirmado continúa bajista en 2459 USDT, mientras el precio vivo (2.504,39 USDT) cotiza POR ENCIMA de ese nivel: un cambio requiere confirmación del cierre. ' +
      'En 4H el precio opera por debajo del VWAP (2.507 USDT): recuperó parte del terreno pero todavía no alcanza para decir que recuperó aceptación sobre esa referencia. ' +
      'El OI aumentó mientras el funding sigue positivo: hay más exposición abierta y mantener largos sigue teniendo costo; no alcanza para saber qué lado está iniciando esas posiciones. ' +
      'Si el precio pierde 2487, aumentaría la evidencia bajista; todavía no alcanza para confirmarla.';
    const r = await guardedFinalize(realResponse, claims, async () => corregida, undefined, F3_REL);
    expect(r.status).toBe('ok');
    const final = ensureCompleteEnding((r as { text: string }).text);
    expect(final).not.toMatch(/arriba del VWAP/);
    expect(final).not.toMatch(/Little room for error/);
    expect(final).not.toMatch(/posicionamiento no se deshizo/);
    expect(final).not.toMatch(/históricamente alto/);
    expect(final).not.toMatch(/antes de\.$/);
    expect(classifyEnding(final)).toBe('complete');
  });
});

// ── T49. FASE F.3.1 — TARGETED RETRY (el retry conoce las causas exactas de r1) ──
import { buildTargetedRetryPrompt, GUARD_RETRY_PROMPT } from '../src/agents/guarded-reply.js';
import type { ViolationSummary } from '../src/agents/guarded-reply.js';

describe('T49 — F.3.1: retry dirigido con razones exactas (cierre incidente v12)', () => {
  const v11Real =
    'Precio en 2504.39 USDT. Funding se mantiene en 0.01%, que anualizado es 10.95% — sigues con ese nivel históricamente alto de posicionamiento largo. ' +
    'OI subió ligeramente a 762K ETH y el premium sigue flat. ' +
    'el precio recuperó los 2500 y está otra vez arriba del VWAP 4H (2507 según el último dato). ' +
    'El funding no aflojó, lo que te dice que el posicionamiento no se deshizo. ' +
    'con este funding y este RSI estás en un setup de riesgo con molto margen para equivocarte. ' +
    'si el precio pierde 2487 con volumen, ahí tenés primeras ventas. ' +
    'esperaría un pullback a 2487 o una ruptura confirmada sobre 2507 antes de.';

  const corregida =
    'Precio en 2504.39 USDT, funding 0.01% (10,95% anualizado, extrapolado), OI en 762K ETH, premium prácticamente nulo. ' +
    'El SuperTrend semanal confirmado continúa bajista en 2459 USDT, mientras el precio vivo (2.504,39 USDT) cotiza POR ENCIMA de ese nivel: un cambio requiere confirmación del cierre. ' +
    'En 4H el precio opera por debajo del VWAP (2.507 USDT). ' +
    'El OI aumentó mientras el funding sigue positivo: hay más exposición abierta; no alcanza para saber qué lado está iniciando esas posiciones. ' +
    'Si el precio pierde 2487, aumentaría la evidencia bajista; todavía no alcanza para confirmarla.';

  it('el retry recibe las violaciones EXACTAS de r1 (no un prompt genérico)', async () => {
    const claims = claimsFrom(f3ClaimsList());
    let received: ViolationSummary[] | null = null;
    const r = await guardedFinalize(v11Real, claims, async (violations) => {
      received = violations ?? null;
      return corregida;
    }, undefined, F3_REL);
    expect(r.status).toBe('ok');
    expect(received).not.toBeNull();
    expect(received!.length).toBeGreaterThan(0);
    const allReasons = received!.flatMap((v) => v.reasons).join(' | ').toLowerCase();
    // Causas REALES que hicieron fallar r1 (la respuesta real v11). "setup" y
    // "molto" NO son auto-traducibles (sobreviven a translateTechnicalResiduals)
    // y por eso aparecen como violaciones de idioma en el retry.
    expect(allReasons).toMatch(/vwap/); // relación VWAP
    expect(allReasons).toMatch(/posicionamiento/); // semántica OI/funding
    expect(allReasons).toMatch(/molto|setup/); // idioma (residuos no traducibles)
  });
  it('buildTargetedRetryPrompt incluye categoría + descripción + RelationFact esperado', () => {
    const violations: ViolationSummary[] = [
      {
        category: 'relations',
        reasons: ['la respuesta afirma "por encima de" VWAP 4H (2507) pero el hecho calculado es BELOW'],
      },
      { category: 'semantic', reasons: ['"el posicionamiento (no) se deshizo" sin evidencia direccional'] },
      { category: 'language', reasons: ['palabra narrativa no española: "molto"'] },
    ];
    const prompt = buildTargetedRetryPrompt(violations);
    expect(prompt).toMatch(/RELATIONS:/);
    expect(prompt).toMatch(/VWAP 4H \(2507\)/);
    expect(prompt).toMatch(/BELOW/);
    expect(prompt).toMatch(/SEMANTIC:/);
    expect(prompt).toMatch(/LANGUAGE:/);
    expect(prompt).toMatch(/molto/);
    // Compacto: NO incluye el prompt completo de contratos ni la respuesta.
    expect(prompt.length).toBeLessThan(GUARD_RETRY_PROMPT.length + 500);
    expect(prompt).not.toContain(v11Real.slice(0, 80));
  });
  it('retry que repite la contradicción → refused; provider error → refused', async () => {
    const claims = claimsFrom(f3ClaimsList());
    const r1 = await guardedFinalize(v11Real, claims, async () => 'El precio está otra vez arriba del VWAP 4H (2507) y el funding es altísimo.', undefined, F3_REL);
    expect(r1.status).toBe('refused');
    const r2 = await guardedFinalize(v11Real, claims, async () => { throw new Error('provider timeout'); }, undefined, F3_REL);
    expect(r2.status).toBe('refused');
    expect((r2 as { reason: string }).reason).toMatch(/proveedor/);
  });
  it('respuesta válida → ok sin llamar al retry', async () => {
    const claims = claimsFrom(f3ClaimsList());
    let retryCalled = false;
    const r = await guardedFinalize(corregida, claims, async () => { retryCalled = true; return 'x'; }, undefined, F3_REL);
    expect(r.status).toBe('ok');
    expect(retryCalled).toBe(false);
  });
});

// ── T50. FASE F.3.1.1 — retry de EDICIÓN RESTRINGIDA (incidente v13, update 30098845) ──
// Causa demostrada: el retry reenviaba TODO el system prompt + dump JSON + historial
// + tool schemas (≈16.7k tokens en producción → 413 de Groq TPM 8000). El retry nuevo
// es UN mensaje compacto (consulta + R1 + violaciones + whitelist de facts + relations).
import { buildRetryEditPrompt } from '../src/agents/guarded-reply.js';

describe('T50 — F.3.1.1: retry de edición restringida (compacto, sin regeneración abierta)', () => {
  const incidentQuery =
    'Analizame ETH ahora. Quiero panorama completo multi-timeframe, derivados, contradicciones, escenarios, triggers, invalidaciones y riesgo. No enumeres indicadores: sintetizá.';
  const r1Incident =
    'Precio en 2504.39 USDT y funding positivo. El posicionamiento largo aumentó y el funding no aflojó, lo que te dice que el posicionamiento no se deshizo. ' +
    'Para ver el get de market data hay que get el contexto del mercado: el mercado está en un setup de 2507.';
  const whitelist =
    'ETH precio=2504.39\nETH funding_pct=0.01\nETH[4H] vwap_sesion=2507\nETH[4H] pivot_s1=2487\nETH[1W] superTrend_nivel=2459';
  const incidentViolations: ViolationSummary[] = [
    { category: 'semantic', reasons: ['atribución direccional de posicionamiento sin evidencia', '"el posicionamiento (no) se deshizo" sin evidencia direccional', 'funding no demuestra persistencia direccional del posicionamiento'] },
    { category: 'language', reasons: ['palabra narrativa no española: "get"', 'palabra narrativa no española: "market"'] },
  ];
  // Respuesta corregida válida (scope de T50; corrige las violaciones del r1Incident).
  const corregida =
    'Precio en 2504.39 USDT, funding 0.01% (10,95% anualizado, extrapolado), OI en 762K ETH, premium prácticamente nulo. ' +
    'El SuperTrend semanal confirmado continúa bajista en 2459 USDT, mientras el precio vivo (2.504,39 USDT) cotiza POR ENCIMA de ese nivel: un cambio requiere confirmación del cierre. ' +
    'En 4H el precio opera por debajo del VWAP (2.507 USDT). ' +
    'El OI aumentó mientras el funding sigue positivo: hay más exposición abierta; no alcanza para saber qué lado está iniciando esas posiciones. ' +
    'Si el precio pierde 2487, aumentaría la evidencia bajista; todavía no alcanza para confirmarla.';

  it('T2/T3: retry compacto con query+R1+violaciones+facts; presupuesto << 8000 tok aprox', () => {
    const prompt = buildRetryEditPrompt({ query: incidentQuery, r1: r1Incident, violations: incidentViolations, factsWhitelist: whitelist, relations: F3_REL });
    expect(prompt).toContain(incidentQuery);
    expect(prompt).toContain(r1Incident.slice(0, 60));
    expect(prompt).toMatch(/SEMANTIC:/);
    expect(prompt).toMatch(/VERIFIED_FACTS/);
    expect(prompt).toMatch(/RELATION_FACTS/);
    expect(prompt).toMatch(/BELOW/);
    // No reenvía dumps de datos ni system prompt (el dump JSON tiene "indicadores_").
    expect(prompt).not.toContain('indicadores_disponibles');
    // Presupuesto: 4 chars/token aprox (documentado); objetivo << 8000 con margen.
    const approxTokens = Math.round(prompt.length / 4);
    expect(approxTokens).toBeLessThan(4000);
  });
  it('T8: el retry incluye R1 completo para EDICIÓN (conservar contenido válido)', () => {
    const prompt = buildRetryEditPrompt({ query: incidentQuery, r1: r1Incident, violations: incidentViolations, factsWhitelist: whitelist, relations: F3_REL });
    expect(prompt).toContain(r1Incident);
  });
  it('T4: números ausentes de los claims → rechazados por el guard final', () => {
    const claims = claimsFrom(f3ClaimsList());
    const num = validateReply('El soporte de ETH quedó en 2401 y el nivel 2555 ya se perdió.', claims);
    expect(num.valid).toBe(false);
    expect(num.violations.some((v) => v.token === '2401')).toBe(true);
    expect(num.violations.some((v) => v.token === '2555')).toBe(true);
  });
  it('T5/T7: contango y residuos get/market/commit siguen rechazados', () => {
    const facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false };
    expect(validateSemanticContracts('hay contango en el mercado', facts).some((v) => v.pattern === 'contango')).toBe(true);
    expect(detectLanguageResiduals('get the market data and commit').map((l) => l.token.toLowerCase())).toEqual(
      expect.arrayContaining(['get', 'market', 'commit']),
    );
  });
  it('T10: R2 con violación NO reparable (posicionamiento/funding) → refused', async () => {
    const claims = claimsFrom(f3ClaimsList());
    const r = await guardedFinalize(r1Incident, claims, async () => 'El posicionamiento no se deshizo y el funding es altísimo.', undefined, F3_REL);
    expect(r.status).toBe('refused');
  });
  it('T10b: R2 con violación REPARABLE (contango/relación/número ausente) → reparada → ok', async () => {
    const claims = claimsFrom(f3ClaimsList());
    const r = await guardedFinalize(r1Incident, claims, async () => 'El precio está arriba del VWAP 4H (2507) y hay contango: el soporte de ETH quedó en 2401.', undefined, F3_REL);
    expect(r.status).toBe('ok');
    const text = (r as { text: string }).text;
    expect(text).toMatch(/por debajo del VWAP 4H \(2507\)/);
    expect(text).not.toMatch(/contango|2401/);
  });
  it('T11/T12: retry válido → ok; provider error total → refused seguro', async () => {
    const claims = claimsFrom(f3ClaimsList());
    const okR = await guardedFinalize(r1Incident, claims, async () => corregida, undefined, F3_REL);
    expect(okR.status).toBe('ok');
    const errR = await guardedFinalize(r1Incident, claims, async () => { throw new Error('all providers failed'); }, undefined, F3_REL);
    expect(errR.status).toBe('refused');
  });
});

// ── T51. FASE F.3.1.2 — capa determinista entre R2 y el guard final (incidente v14) ──
// R2 real v14: 2480/2481/2349 (números ausentes), contango/backwardation,
// "volumen confirma", SuperTrend 1H ABOVE (canonical BELOW), SuperTrend 4H BELOW
// (canonical ABOVE). La capa repara SIN tercer LLM; el guard final re-valida.
import { repairResponseDeterministic } from '../src/agents/deterministic-repair.js';

describe('T51 — F.3.1.2: reparación determinista de R2 (cierre incidente v14)', () => {
  // Fixture v14: SuperTrend 1H→BELOW(2512), SuperTrend 4H→ABOVE(2499), VWAP 4H→BELOW(2507).
  const v14Facts: SemanticFacts = { termStructureVerified: false, evidenceDirectionalPositioning: false, fundingBenchmarkAvailable: false, volumeBenchmarkAvailable: false };
  const v14Claims: MarketClaim[] = [
    { symbol: 'ETH', field: 'precio', value: 2504.39, source: 'ticker' },
    { symbol: 'ETH', field: 'funding_pct', value: 0.01, source: 'funding' },
    { symbol: 'ETH', field: 'open_interest', value: 762000, source: 'tool' },
    { symbol: 'ETH', field: 'funding_anualizado_pct', value: 10.95, source: 'tool' },
    { symbol: 'ETH', timeframe: '1W', field: 'superTrend_nivel', value: 2459, source: 'calculado' },
    { symbol: 'ETH', timeframe: '1D', field: 'rsi', value: 84.6, source: 'calculado' },
    { symbol: 'ETH', timeframe: '4H', field: 'superTrend_nivel', value: 2499, source: 'calculado' },
    { symbol: 'ETH', timeframe: '4H', field: 'vwap_sesion', value: 2507, source: 'calculado' },
    { symbol: 'ETH', timeframe: '4H', field: 'pivot_s1', value: 2500, source: 'calculado' },
    { symbol: 'ETH', timeframe: '4H', field: 'pivot_r1', value: 2520, source: 'calculado' },
    { symbol: 'ETH', timeframe: '1H', field: 'superTrend_nivel', value: 2512, source: 'calculado' },
  ];
  const v14Rel: RelationFact[] = [
    { label: 'SuperTrend 1W', value: 2459, relation: 'ABOVE' },
    { label: 'SuperTrend 4H', value: 2499, relation: 'ABOVE' },
    { label: 'VWAP 4H', value: 2507, relation: 'BELOW' },
    { label: 'S1 4H', value: 2500, relation: 'ABOVE' },
    { label: 'R1 4H', value: 2520, relation: 'BELOW' },
    { label: 'SuperTrend 1H', value: 2512, relation: 'BELOW' },
  ];
  const r2V14 =
    'El precio está por encima del SuperTrend 1H (2512) y por debajo del SuperTrend 4H (2499). ' +
    'El soporte quedó en 2480 y el máximo en 2481, con un piso en 2349. ' +
    'Hay contango y backwardation en el mercado. ' +
    'El volumen confirma la ruptura. ' +
    'El precio opera por debajo del VWAP 4H (2507) y el RSI diario está en 84.6.';

  it('canónico v14: repair elimina/corrige y el guard final = OK (sin tercer LLM)', () => {
    const claims = claimsFrom(v14Claims);
    const repaired = repairResponseDeterministic(r2V14, claims, v14Facts, v14Rel);
    // Cifras ausentes eliminadas, contango/volumen eliminados, relaciones canonicalizadas.
    expect(repaired).not.toMatch(/2480|2481|2349/);
    expect(repaired).not.toMatch(/contango|backwardation/i);
    expect(repaired).not.toMatch(/volumen confirma/);
    expect(repaired).toMatch(/por debajo del SuperTrend 1H \(2512\)/);
    expect(repaired).toMatch(/por encima del SuperTrend 4H \(2499\)/);
    // Contenido válido conservado.
    expect(repaired).toMatch(/por debajo del VWAP 4H \(2507\)/);
    expect(repaired).toMatch(/84\.6/);
    // Guard final re-valida = OK.
    expect(validateReply(repaired, claims).valid).toBe(true);
    expect(validateSemanticContracts(repaired, v14Facts)).toEqual([]);
    expect(validateNumericRelations(repaired, v14Rel)).toEqual([]);
  });
  it('1/2) número permitido se conserva; número ausente se elimina sin crear otro', () => {
    const claims = claimsFrom(v14Claims);
    const repaired = repairResponseDeterministic(r2V14, claims, v14Facts, v14Rel);
    expect(repaired).toMatch(/84\.6/);
    const nums = (repaired.match(/\d{3,4}(?:[.,]\d+)?/g) ?? []).map((t) => parseFloat(t.replace(/[.,](\d{2})$/, '.$1')));
    for (const n of nums) {
      expect(claims.claims.some((c) => Math.abs(n - c.value) <= Math.max(1, Math.abs(c.value) * 0.005))).toBe(true);
    }
  });
  it('3/4) contango sin term structure desaparece; premium/discount válido se conserva', () => {
    const claims = claimsFrom(v14Claims);
    const rep = repairResponseDeterministic(r2V14 + ' El premium está prácticamente nulo (alineado con el índice).', claims, v14Facts, v14Rel);
    expect(rep).not.toMatch(/contango|backwardation/i);
    expect(rep).toMatch(/premium está prácticamente nulo/);
  });
  it('5/6) relación invertida se canonicaliza; relación correcta no se toca', () => {
    const claims = claimsFrom(v14Claims);
    const repaired = repairResponseDeterministic(r2V14, claims, v14Facts, v14Rel);
    expect(repaired).toMatch(/por debajo del SuperTrend 1H \(2512\)/); // ABOVE→BELOW
    expect(repaired).toMatch(/por encima del SuperTrend 4H \(2499\)/); // BELOW→ABOVE
    expect(repaired).toMatch(/por debajo del VWAP 4H \(2507\)/);        // ya era BELOW
  });
  it('7) volumen sin benchmark se neutraliza', () => {
    const claims = claimsFrom(v14Claims);
    expect(repairResponseDeterministic(r2V14, claims, v14Facts, v14Rel)).not.toMatch(/volumen confirma/);
  });
  it('8) contenido sano no cambia', () => {
    const claims = claimsFrom(v14Claims);
    const sano = 'El precio opera por debajo del VWAP 4H (2507) y el RSI diario está en 84.6.';
    expect(repairResponseDeterministic(sano, claims, v14Facts, v14Rel)).toBe(sano);
  });
  it('9) violación NO reparable sigue rechazada por el guard', () => {
    const claims = claimsFrom(v14Claims);
    const rep = repairResponseDeterministic(r2V14 + ' El posicionamiento no se deshizo.', claims, v14Facts, v14Rel);
    expect(validateSemanticContracts(rep, v14Facts).some((v) => /posicionamiento/.test(v.reason))).toBe(true);
  });
  it('10) guardedFinalize: R2 reparable → ok tras reparación, sin tercer retry', async () => {
    const claims = claimsFrom(v14Claims);
    let retries = 0;
    const r = await guardedFinalize('El precio está por encima del SuperTrend 1H (2512).', claims, async () => { retries++; return r2V14; }, v14Facts, v14Rel);
    expect(retries).toBe(1);
    expect(r.status).toBe('ok');
    expect((r as { text: string }).text).not.toMatch(/2480|2481|2349|contango|backwardation|volumen confirma/i);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────
/**
 * Velas con flujo de dinero controlado para MFI:
 * - `pctSube` = % de velas que cierran por encima del cierre previo (flujo
 *   comprador cuando es alto, vendedor cuando es bajo).
 */
function mkMfiCandles(n: number, pctSube: number, base = 100): Candle[] {
  const out: Candle[] = [];
  let prev = base;
  for (let i = 0; i < n; i++) {
    const t = nowAnchor - (n - 1 - i) * HOUR;
    const sube = (i % 100) < pctSube;
    const close = sube ? prev + 1 : prev - 1;
    out.push({ time: t, open: prev, high: Math.max(prev, close) + 1, low: Math.min(prev, close) - 1, close, volume: 10 });
    prev = close;
  }
  return out;
}

function fakeSources(o: { bybitFail?: boolean; bybitStatus?: number } = {}) {
  return {
    bitget: {
      getTicker: async () => ({ symbol: 'ETHUSDT', lastPr: '2495.84', usdtVolume: '2490000000' }),
      getCurrentFunding: async () => ({ symbol: 'ETHUSDT', fundingRate: '-0.000007', nextUpdate: String(Date.now() + 3_600_000) }),
      getFundingHistory: async () => [
        { symbol: 'ETHUSDT', fundingRate: '-0.000007', fundingTime: String(Date.now()) },
        { symbol: 'ETHUSDT', fundingRate: '-0.000006', fundingTime: String(Date.now() - 3_600_000) },
      ],
      getOpenInterest: async () => ({ openInterestList: [{ size: '720800' }] }),
      getMarkPrice: async () => ({ symbol: 'ETHUSDT', markPrice: '2496', indexPrice: '2495.9' }),
    } as never,
    binance: {
      getPremiumIndex: async () => ({ symbol: 'ETHUSDT', markPrice: '2496', indexPrice: '2495.9', lastFundingRate: '-0.0000065', nextFundingTime: Date.now(), interestRate: '0', estimatedSettlePrice: '2496', time: Date.now() }),
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', time: Date.now() }),
    } as never,
    bybit: {
      getTicker: async () => {
        if (o.bybitFail) {
          const e = new Error('HTTP 403 para https://api.bybit.com/v5/market/tickers?category=linear&symbol=ETHUSDT');
          (e as { status?: number }).status = o.bybitStatus ?? 403;
          throw e;
        }
        return { symbol: 'ETHUSDT', lastPrice: '2495.9', fundingRate: '-0.0000065', nextFundingTime: String(Date.now()), turnover24h: '1e9', volume24h: '1e8', openInterest: '700000', markPrice: '2496', indexPrice: '2495.9' };
      },
      getFundingHistory: async () => [],
      getOpenInterest: async () => ({ symbol: 'ETHUSDT', openInterest: '700000', timestamp: String(Date.now()) }),
    } as never,
    coinGecko: {
      getGlobal: async () => ({ data: { total_market_cap: { usd: 2.5e12 }, market_cap_percentage: { btc: 55 } } }),
    } as never,
  };
}

function fakeStore() {
  const rows = new Map<number, { payload: string; status: string; attempts: number; created: number; startedAt: number }>();
  const processed = new Set<number>();
  return {
    rows, processed,
    async savePendingUpdate(updateId: number, payload: unknown) {
      rows.set(updateId, { payload: JSON.stringify(payload), status: 'pending', attempts: 0, created: Date.now(), startedAt: 0 });
      return 'inserted' as const;
    },
    async claimPendingUpdate(updateId?: number) {
      const id = updateId ?? [...rows.keys()][0];
      const row = rows.get(id!);
      if (!row || row.status !== 'pending') return null;
      row.status = 'processing';
      row.attempts++;
      row.startedAt = Date.now();
      return { updateId: id!, payload: row.payload, attempts: row.attempts };
    },
    async finishPendingUpdate(updateId: number, ok: boolean, opts?: { error?: string; permanent?: boolean }) {
      const row = rows.get(updateId);
      if (!row) return;
      if (ok) {
        processed.add(updateId);
        rows.delete(updateId);
      } else if (opts?.permanent || row.attempts >= 3) {
        row.status = 'failed';
      } else {
        row.status = 'pending';
      }
    },
    async isUpdateProcessed(updateId: number) {
      return processed.has(updateId);
    },
    async recoverStuckProcessing() { return 0; },
  };
}
