import type { Deps } from '../deps.js';
import { buildAggregatedScan } from '../data/snapshot.js';
import type { AlertRule } from '../types/index.js';

export type ToolName =
  | 'get_market_snapshot'
  | 'get_price'
  | 'set_price_alert'
  | 'set_funding_alert'
  | 'get_onchain_data';

/** Definición de herramientas para function calling (compatible OpenAI/Groq). */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_market_snapshot',
      description:
        'Obtiene precio, funding rate, open interest y basis anualizado de un cripto activo (datos cross-exchange Binance/Bybit). Usala cuando el usuario pida analizar, mirar o consultar un activo.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Ticker o nombre: BTC, ETH, solana, bitcoin, ethereum...',
          },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_price',
      description: 'Precio actual de un activo (cripto) en USD.',
      parameters: {
        type: 'object',
        properties: { symbol: { type: 'string', description: 'Ticker: BTC, ETH, SOL...' } },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_price_alert',
      description:
        'Crea una alerta de precio para avisarle al usuario cuando el precio cruce un umbral. Usala cuando pida "avisame si X supera/baja de ...".',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker: BTC, ETH, SOL...' },
          direction: {
            type: 'string',
            enum: ['above', 'below'],
            description: 'above = avisar si sube por encima; below = si baja por debajo',
          },
          price: { type: 'number', description: 'Precio umbral en USD' },
        },
        required: ['symbol', 'direction', 'price'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_funding_alert',
      description:
        'Crea una alerta de funding rate para avisar cuando el funding cruce un umbral (en %). Usala cuando pida alertas de funding.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          direction: { type: 'string', enum: ['above', 'below'] },
          percent: { type: 'number', description: 'Umbral de funding en % (ej 0.05 = 0.05%)' },
        },
        required: ['symbol', 'direction', 'percent'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_onchain_data',
      description:
        'Datos on-chain/DeFi: TVL por cadena, circulante de stablecoins (USDT/USDC), o panorama global (market cap y dominancia BTC).',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['tvl', 'stablecoins', 'global'] },
        },
        required: ['kind'],
      },
    },
  },
];

/** Ejecuta una herramienta con sus argumentos y devuelve el resultado. */
export async function executeTool(
  deps: Deps,
  chatId: number,
  name: ToolName,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'get_market_snapshot': {
      const symbol = String(args.symbol ?? 'BTC');
      const scan = await buildAggregatedScan(symbol, deps);
      return {
        symbol: scan.symbol,
        pair: scan.pair,
        priceUsd: scan.snapshot.price,
        fundingBitgetPct: scan.context.bitgetFunding * 100,
        fundingBinancePct: scan.context.binanceFunding * 100,
        fundingBybitPct: scan.context.bybitFunding * 100,
        fundingSpreadBps: scan.context.fundingSpreadBps,
        openInterestBitget: scan.context.bitgetOI,
        openInterestBybit: scan.context.bybitOI,
        basisAnnualizedPct: scan.snapshot.basisAnnualized * 100,
        volume24hUsd: scan.snapshot.volume24h,
        btcDominancePct: scan.context.btcDominancePct,
        globalCapUsd: scan.context.globalCapUsd,
      };
    }
    case 'get_price': {
      const symbol = String(args.symbol ?? 'BTC');
      const scan = await buildAggregatedScan(symbol, deps);
      return { symbol: scan.symbol, priceUsd: scan.snapshot.price };
    }
    case 'set_price_alert': {
      const symbol = String(args.symbol ?? 'BTC').toUpperCase();
      const direction = args.direction === 'below' ? 'below' : 'above';
      const price = Number(args.price);
      if (!Number.isFinite(price) || price <= 0) return { error: 'Precio inválido' };
      const rule: AlertRule = {
        chatId,
        type: direction === 'above' ? 'price_above' : 'price_below',
        symbol,
        threshold: price,
        active: true,
        createdAt: Date.now(),
      };
      await deps.memory.saveAlert(rule);
      return { ok: true, symbol, type: rule.type, threshold: price };
    }
    case 'set_funding_alert': {
      const symbol = String(args.symbol ?? 'BTC').toUpperCase();
      const direction = args.direction === 'below' ? 'below' : 'above';
      const percent = Number(args.percent);
      if (!Number.isFinite(percent)) return { error: 'Porcentaje inválido' };
      const rule: AlertRule = {
        chatId,
        type: direction === 'above' ? 'funding_above' : 'funding_below',
        symbol,
        threshold: percent / 100, // % → decimal
        active: true,
        createdAt: Date.now(),
      };
      await deps.memory.saveAlert(rule);
      return { ok: true, symbol, type: rule.type, thresholdPct: percent };
    }
    case 'get_onchain_data': {
      const kind = String(args.kind ?? 'global');
      if (kind === 'tvl') {
        const chains = await deps.defiLlama.getChains();
        const top = [...chains]
          .sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0))
          .slice(0, 10)
          .map((c) => ({ chain: c.name, tvlUsd: c.tvl }));
        return { kind: 'tvl', top };
      }
      if (kind === 'stablecoins') {
        const stables = await deps.defiLlama.getStablecoins();
        const usdt = stables.find((s) => s.symbol === 'USDT')?.circulating?.peggedUSD ?? 0;
        const usdc = stables.find((s) => s.symbol === 'USDC')?.circulating?.peggedUSD ?? 0;
        return { kind: 'stablecoins', usdtCirculatingUsd: usdt, usdcCirculatingUsd: usdc, count: stables.length };
      }
      // global: CoinGecko primario, CoinMarketCap de respaldo
      try {
        const global = await deps.coinGecko.getGlobal();
        return {
          kind: 'global',
          source: 'CoinGecko',
          marketCapUsd: global.data.total_market_cap.usd ?? 0,
          btcDominancePct: global.data.market_cap_percentage.btc ?? 0,
        };
      } catch {
        if (deps.cmc) {
          const cmc = await deps.cmc.getGlobal();
          return {
            kind: 'global',
            source: 'CoinMarketCap',
            marketCapUsd: cmc.data?.total_market_cap_usd ?? 0,
            btcDominancePct: cmc.data?.btc_dominance ?? 0,
          };
        }
        return { error: 'No se pudo obtener el panorama global' };
      }
    }
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}
