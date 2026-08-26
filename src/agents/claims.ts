import { parseMarketNumber } from '../utils/numbers.js';
import type { MultiTfContext, TfStatus } from '../utils/multitf.js';

/**
 * ALLOWED NUMERIC CLAIMS (FASE C).
 * Registro programático de los números de mercado que KUMPA tiene permitido
 * citar, con procedencia: symbol + timeframe + field + value + source.
 * Se construye desde el contexto multitemporal (pre-fetch) y se enriquece con
 * los resultados de herramientas (datos también obtenidos, reales).
 * El post-validator valida la respuesta contra este registro.
 */

export interface MarketClaim {
  symbol: string; // 'BTC' | 'ETH' | ... | 'GLOBAL' (datos sin símbolo, ej on-chain)
  timeframe?: string; // TfLabel cuando el valor pertenece a un marco
  field: string; // 'precio' | 'funding_pct' | 'rsi' | ... | 'tool:<path>' | 'event:*'
  value: number;
  source: 'ticker' | 'funding' | 'candles' | 'calculado' | 'tool' | 'event';
}

export interface ClaimSet {
  claims: MarketClaim[];
  bySymbol: Map<string, MarketClaim[]>;
  isEmpty: boolean;
}

function index(claims: MarketClaim[]): Map<string, MarketClaim[]> {
  const bySymbol = new Map<string, MarketClaim[]>();
  for (const c of claims) {
    const arr = bySymbol.get(c.symbol) ?? [];
    arr.push(c);
    bySymbol.set(c.symbol, arr);
  }
  return bySymbol;
}

/** Construye el registro desde el contexto multitemporal (Fase B). */
export function buildAllowedClaims(ctx: MultiTfContext): ClaimSet {
  const claims: MarketClaim[] = [];
  for (const s of Object.values(ctx)) {
    if (!s.valido) continue;
    const sym = s.symbol;
    if (typeof s.precio === 'number' && Number.isFinite(s.precio)) {
      claims.push({ symbol: sym, field: 'precio', value: s.precio, source: 'ticker' });
    }
    if (s.funding_pct) {
      const v = parseMarketNumber(s.funding_pct);
      if (v !== null) claims.push({ symbol: sym, field: 'funding_pct', value: v, source: 'funding' });
    }
    for (const [tf, b] of Object.entries(s.timeframes ?? {})) {
      if (!b?.valido) continue;
      if (b.cierre_ultima_cerrada !== null) {
        claims.push({ symbol: sym, timeframe: tf, field: 'cierre', value: b.cierre_ultima_cerrada, source: 'candles' });
      }
      if (b.vela_viva) {
        const vv = b.vela_viva;
        claims.push(
          { symbol: sym, timeframe: tf, field: 'viva_open', value: vv.open, source: 'candles' },
          { symbol: sym, timeframe: tf, field: 'viva_high', value: vv.high, source: 'candles' },
          { symbol: sym, timeframe: tf, field: 'viva_low', value: vv.low, source: 'candles' },
          { symbol: sym, timeframe: tf, field: 'viva_close', value: vv.close, source: 'candles' },
        );
      }
      for (const [k, v] of Object.entries(b.indicadores)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          claims.push({ symbol: sym, timeframe: tf, field: k, value: v, source: 'calculado' });
        }
      }
    }
  }
  return { claims, bySymbol: index(claims), isEmpty: claims.length === 0 };
}

/** Extrae claims de un resultado de herramienta (datos reales obtenidos). */
export function collectToolResultClaims(result: unknown, fallbackSymbol: string): MarketClaim[] {
  const out: MarketClaim[] = [];
  const resultObj = (result ?? {}) as { symbol?: string; timeframe?: string };
  const symbol = typeof resultObj.symbol === 'string' && resultObj.symbol ? resultObj.symbol.toUpperCase() : fallbackSymbol || 'GLOBAL';
  const timeframe = typeof resultObj.timeframe === 'string' ? resultObj.timeframe : undefined;

  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'number' && Number.isFinite(node)) {
      out.push({ symbol, timeframe, field: path ? `tool:${path}` : 'tool:value', value: node, source: 'tool' });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, path ? `${path}[${i}]` : `[${i}]`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(result, '');
  return out;
}

/** Devuelve una copia del ClaimSet incluyendo claims de herramientas. */
export function withToolClaims(base: ClaimSet, toolClaims: readonly MarketClaim[]): ClaimSet {
  if (toolClaims.length === 0) return base;
  const all = [...base.claims, ...toolClaims];
  return { claims: all, bySymbol: index(all), isEmpty: all.length === 0 };
}

/** Devuelve una copia del ClaimSet incluyendo claims de eventos verificados (FASE D). */
export function withEventClaims(base: ClaimSet, eventClaims: readonly MarketClaim[]): ClaimSet {
  if (eventClaims.length === 0) return base;
  const all = [...base.claims, ...eventClaims];
  return { claims: all, bySymbol: index(all), isEmpty: all.length === 0 };
}

/**
 * VALIDACIÓN PRE-LLM (FASE C): bloque legible de validez por símbolo/TF.
 * Si un símbolo no tiene NINGÚN dato válido, el modelo lo ve explícito.
 */
export function buildValidityBlock(ctx: MultiTfContext): string {
  const lines: string[] = [];
  for (const [pair, s] of Object.entries(ctx)) {
    const sym = s.symbol;
    if (!s.valido) {
      lines.push(`${pair} (${sym}): SIN DATOS DE MERCADO VERIFICADOS PARA ESTE ACTIVO (${s.status ?? 'error'}: ${s.error ?? 'desconocido'})`);
      continue;
    }
    const tfs = Object.entries(s.timeframes ?? {});
    const allFailed = tfs.length === 0 || tfs.every(([, b]) => !b?.valido);
    if (allFailed) {
      lines.push(`${pair} (${sym}): SIN DATOS DE MERCADO VERIFICADOS PARA ESTE ACTIVO`);
      continue;
    }
    const detail = tfs
      .map(([tf, b]) => `${tf}=${b?.valido ? 'ok' : (b?.status ?? 'fail')}`)
      .join(', ');
    lines.push(`${pair} (${sym}): ${detail}`);
  }
  return lines.join('\n');
}

/** Convierte un ClaimSet a JSON legible (solo para logs/diagnóstico; sin secretos). */
export function summarizeClaims(claims: ClaimSet): string {
  return claims.claims.map((c) => `${c.symbol}${c.timeframe ? ':' + c.timeframe : ''}:${c.field}=${c.value}`).join(' ');
}

export type { TfStatus };
