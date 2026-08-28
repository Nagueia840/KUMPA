// KUMPA — Simulación local de la condición GUARD_REFUSAL_TEXT para "Analizame ETH ahora".
// Demuestra (sin red, reproducible) QUÉ configuraciones de claims producen la
// respuesta exacta "No tengo datos verificados suficientes para darte ese valor
// con confianza." y cuáles NO pueden producirla.
// Correr tras compilar: node node_modules/typescript/lib/tsc.js -p tsconfig.verify.json
//   node scripts/guard-condition-harness.mjs
import { buildAllowedClaims, collectToolResultClaims, withToolClaims } from '../.verify/agents/claims.js';
import { validateReply } from '../.verify/utils/validator.js';
import { buildMultiTfSymbol, attachTfBlock, buildMultiTfContext } from '../.verify/utils/multitf.js';
import { GUARD_REFUSAL_TEXT, guardedFinalize } from '../.verify/agents/guarded-reply.js';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  [${extra}]` : ''}`);
  if (!cond) failures++;
};

// ── Escenario A: ETH valido:true (Bitget OK) con 1D/4H ──────────────────────
function ethValidContext() {
  const tf1d = {
    valido: true,
    status: 'ok',
    candleCount: 220,
    cierre_ultima_cerrada: 3440,
    vela_viva: { time: Date.now(), open: 3450, high: 3460, low: 3445, close: 3455 },
    indicadores: { rsi: 58.2, vwap_sesion: 3435.5, ema20: 3400 },
  };
  const tf4h = {
    valido: true,
    status: 'ok',
    candleCount: 220,
    cierre_ultima_cerrada: 3452,
    vela_viva: undefined,
    indicadores: { rsi: 55.1, vwap_sesion: 3448 },
  };
  let s = buildMultiTfSymbol('ETH', { price: 3455, fundingPct: '0.0100%', fundingTsMs: Date.now() });
  s = attachTfBlock(s, '1D', tf1d);
  s = attachTfBlock(s, '4H', tf4h);
  return buildMultiTfContext([s]);
}

// ── Escenario B: ETH valido:false (sin datos de Bitget) ──────────────────────
function ethInvalidContext() {
  const ctx = {};
  ctx.ETHUSDT = { symbol: 'ETH', valido: false, status: 'fetch_failed', error: 'timeout ETHUSDT funding/ticker (3000ms)', market: 'USDT-FUTURES', exchange: 'Bitget' };
  return ctx;
}

// ── 1. Claims de cada escenario ───────────────────────────────────────────────
{
  const claimsA = buildAllowedClaims(ethValidContext());
  const claimsB = buildAllowedClaims(ethInvalidContext());
  check('A) ETH valido:true → claims NO vacíos', !claimsA.isEmpty, `claims=${claimsA.claims.length}`);
  check('B) ETH valido:false → claims VACÍOS (guard no puede bloquear por números)', claimsB.isEmpty === true, `claims=${claimsB.claims.length}`);
}

// ── 2. validateReply con respuesta correcta (cita números del contexto) ───────
{
  const claims = buildAllowedClaims(ethValidContext());
  const good = validateReply(
    'ETH cotiza cerca de 3455. El RSI en 1D está en 58.2 y el VWAP semanal en 3435.5.',
    claims,
  );
  check('A) respuesta citando datos REALES → válida', good.valid, good.violations.map((v) => v.reason).join(' | '));
}

// ── 3. validateReply con número inventado (sin respaldo) → violación ──────────
{
  const claims = buildAllowedClaims(ethValidContext());
  const bad = validateReply(
    'ETH va a romper el soporte en 3000 y el próximo objetivo es 2700.',
    claims,
  );
  check('A) número inventado (3000/2700) → VIOLACIÓN', !bad.valid, bad.violations.map((v) => v.reason).join(' | '));
}

// ── 4. Escenario B: ETH sin claims → validateReply pasa TODO ─────────────────
{
  const claims = buildAllowedClaims(ethInvalidContext());
  const any = validateReply(
    'ETH está en 3000 y va a 2700, confío en mi memoria.',
    claims,
  );
  // CLAVE: con claims vacíos el guard no audita nada → la respuesta "inventada" pasa.
  check('B) ETH sin claims → incluso respuesta con números inventados pasa (isEmpty → valid)', any.valid === true);
}

// ── 5. guardedFinalize con claims vacíos: v1 válido → nunca llega a refused ──
{
  const claims = buildAllowedClaims(ethInvalidContext());
  let regenCalled = false;
  const result = await guardedFinalize('algo inventado con 3000', claims, async () => {
    regenCalled = true;
    return 'otra cosa';
  });
  check('B) guardedFinalize con claims vacíos → status ok (NO refused)', result.status === 'ok' && regenCalled === false);
  check('B) por lo tanto GUARD_REFUSAL_TEXT NO puede venir de ETH sin claims', result.text !== GUARD_REFUSAL_TEXT);
}

// ── 6. guardedFinalize con claims reales y respuesta inventada → refused ─────
{
  const claims = buildAllowedClaims(ethValidContext());
  const result = await guardedFinalize(
    'ETH va a 3000 según mi análisis, es soporte clave.',
    claims,
    async () => 'Reitero: ETH va a 3000 según mi análisis.',
  );
  check('A) respuesta inventada 2 veces → REFUSED → GUARD_REFUSAL_TEXT', result.status === 'refused');
  check('A) texto exacto coincide con el de producción', GUARD_REFUSAL_TEXT === 'No tengo datos verificados suficientes para darte ese valor con confianza.');
}

// ── 7. guardedFinalize: regenerate() lanza (429 OpenRouter) → refused ────────
{
  const claims = buildAllowedClaims(ethValidContext());
  const result = await guardedFinalize(
    'ETH va a 3000 según mi análisis.',
    claims,
    async () => { throw new Error('429 rate limit OpenRouter'); },
  );
  check('A) regeneración falla (429) tras v1 inválido → REFUSED', result.status === 'refused');
  check('A) razón registra fallo de proveedor', /regeneración falló/i.test(result.reason));
}

// ── 8. toolClaims: get_market_snapshot (fix) → claims de tool ────────────────
{
  const toolResult = {
    symbol: 'ETH', pair: 'ETHUSDT', source: 'Bitget', primaryStatus: 'ok',
    crosschecks: { binance: 'ok', bybit: 'unavailable' },
    priceUsd: 3455.5, fundingBitgetPct: 0.01, openInterestBitget: 12500,
  };
  const toolClaims = collectToolResultClaims(toolResult, 'ETH');
  const claims = withToolClaims(buildAllowedClaims(ethInvalidContext()), toolClaims);
  check('tool con fix → claims de ETH vía tool (symbol ETH)', claims.bySymbol.has('ETH'), `toolClaims=${toolClaims.length}`);
  const v = validateReply('ETH está en 3455.5 con funding 0.01%.', claims);
  check('tool result → respuesta citando esos números → válida', v.valid, v.violations.map((x) => x.reason).join(' | '));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
