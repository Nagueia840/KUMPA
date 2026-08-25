import type { Deps } from '../deps.js';
import { buildAggregatedScan, toPerpPair } from '../data/snapshot.js';
import { computeEMA, computeRSI, computeSMA, computeVWAP, parseCandle } from '../data/indicators.js';
import { weatherCodeDescription } from '../data/web/weather.js';
import type { AlertRule } from '../types/index.js';

export type ToolName =
  | 'get_market_snapshot'
  | 'get_price'
  | 'set_price_alert'
  | 'set_funding_alert'
  | 'get_onchain_data'
  | 'get_technical_indicators'
  | 'web_search'
  | 'get_weather';

/** Definición de herramientas para function calling (compatible OpenAI/Groq). */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_market_snapshot',
      description:
        'Obtiene precio, funding rate, open interest y basis anualizado de un cripto activo (fuente primaria Bitget, cross-check Binance/Bybit). Usala cuando el usuario pida analizar, mirar o consultar un activo.',
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
        'Crea una alerta de funding rate para avisar cuando el funding cruce un umbral (en %).',
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
  {
    type: 'function',
    function: {
      name: 'get_technical_indicators',
      description:
        'Obtiene indicadores técnicos de un activo: VWAP (semanal por defecto), media móvil simple 20, EMA 20 y RSI 14, calculados desde velas de Bitget. Usala cuando el usuario pida VWAP, medias móviles, RSI, análisis técnico o niveles.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker: BTC, ETH, SOL...' },
          timeframe: {
            type: 'string',
            enum: ['1h', '1d'],
            description: 'Temporalidad de las velas (default 1d)',
          },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Busca información general en internet: noticias, especificaciones técnicas de un aparato o componente, identificación de objetos, clima, cualquier cosa. Usala cuando el usuario pida buscar algo que no sea un dato de mercado.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Consulta de búsqueda' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Obtiene el clima actual de una ciudad o lugar.',
      parameters: {
        type: 'object',
        properties: { place: { type: 'string', description: 'Ciudad o lugar (ej Buenos Aires, CABA)' } },
        required: ['place'],
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
        source: 'Bitget (primario)',
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
      return { symbol: scan.symbol, priceUsd: scan.snapshot.price, source: 'Bitget' };
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
        threshold: percent / 100,
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
    case 'get_technical_indicators': {
      const symbol = String(args.symbol ?? 'BTC');
      // Bitget usa granularidades en mayúscula (1H, 1D...)
      const tfMap: Record<string, string> = {
        '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
        '1h': '1H', '4h': '4H', '6h': '6H', '12h': '12H',
        '1d': '1D', '1w': '1W',
      };
      const timeframe = tfMap[String(args.timeframe ?? '1d').toLowerCase()] ?? '1D';
      const raw = await deps.bitget.getCandles(toPerpPair(symbol), timeframe, { limit: 200 });
      const candles = raw.map(parseCandle).sort((a, b) => a.time - b.time);
      if (candles.length < 20) return { error: 'Velas insuficientes para indicadores' };
      const closes = candles.map((c) => c.close);
      // VWAP semanal: últimas 7 velas diarias (o 168 de 1H)
      const vwapWindow = timeframe === '1H' ? candles.slice(-168) : candles.slice(-7);
      const last = candles[candles.length - 1];
      const scan = await buildAggregatedScan(symbol, deps);
      return {
        symbol: symbol.toUpperCase(),
        timeframe,
        price: scan.snapshot.price,
        vwapWeekly: computeVWAP(vwapWindow),
        ma20: computeSMA(closes, 20),
        ema20: computeEMA(closes, 20),
        rsi14: computeRSI(closes, 14),
        weekHigh: vwapWindow.length ? Math.max(...vwapWindow.map((c) => c.high)) : undefined,
        weekLow: vwapWindow.length ? Math.min(...vwapWindow.map((c) => c.low)) : undefined,
        lastClose: last?.close,
      };
    }
    case 'web_search': {
      if (!deps.exa) return { error: 'Búsqueda web no configurada (falta EXA_API_KEY)' };
      const results = await deps.exa.search(String(args.query ?? ''), 5);
      return results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet:
          (r.highlights ?? []).join(' ').slice(0, 500) ||
          (r.text ?? '').slice(0, 500),
      }));
    }
    case 'get_weather': {
      const place = String(args.place ?? '');
      const geo = await deps.weather.geocode(place);
      if (!geo) return { error: `No encontré el lugar "${place}"` };
      const w = await deps.weather.getCurrent(geo.latitude, geo.longitude);
      return {
        place: `${geo.name}${geo.admin1 ? ', ' + geo.admin1 : ''}${geo.country ? ', ' + geo.country : ''}`,
        temperatureC: w.temperature,
        description: weatherCodeDescription(w.weatherCode),
        windKmh: w.windSpeed,
        humidityPct: w.relativeHumidity,
      };
    }
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}
