const KNOWN_TICKERS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT',
  'MATIC', 'POL', 'ARB', 'OP', 'TON', 'TRX', 'LTC', 'BCH', 'UNI', 'AAVE',
  'ATOM', 'NEAR', 'APT', 'SUI', 'PEPE', 'SHIB', 'WIF', 'JUP', 'TIA', 'SEI',
];

const NAME_TO_TICKER: Record<string, string> = {
  bitcoin: 'BTC',
  ethereum: 'ETH',
  ether: 'ETH',
  solana: 'SOL',
  binance: 'BNB',
  bnb: 'BNB',
  ripple: 'XRP',
  dogecoin: 'DOGE',
  cardano: 'ADA',
  polkadot: 'DOT',
  chainlink: 'LINK',
  avalanche: 'AVAX',
  polygon: 'MATIC',
  matic: 'MATIC',
  litecoin: 'LTC',
  toncoin: 'TON',
  tron: 'TRX',
  near: 'NEAR',
  sui: 'SUI',
  aptos: 'APT',
};

/**
 * Detecta un ticker mencionado en texto libre. Devuelve el símbolo (ej 'BTC')
 * o null si no hay ninguno. Soporta cashtag ($BTC), ticker standalone (btc),
 * par (BTCUSDT) y nombre (bitcoin → BTC).
 */
export function detectTicker(text: string): string | null {
  // 1) cashtag $BTC / $ETH
  const cashtag = text.match(/\$([A-Za-z]{2,10})/);
  if (cashtag?.[1]) return cashtag[1].toUpperCase();

  // 2) ticker standalone o par "...USDT"
  const words = text.toUpperCase().split(/[^A-Z0-9]+/);
  for (const w of words) {
    if (KNOWN_TICKERS.includes(w)) return w;
    if (w.endsWith('USDT') && w.length > 4) return w.slice(0, -4);
  }

  // 3) nombre → ticker (bitcoin → BTC, solana → SOL)
  const lower = text.toLowerCase();
  for (const [name, ticker] of Object.entries(NAME_TO_TICKER)) {
    if (lower.includes(name)) return ticker;
  }

  return null;
}

/** Extrae TODOS los tickers únicos mencionados en un texto (multi-activo). */
export function extractAllTickers(text: string): string[] {
  const found = new Set<string>();

  for (const m of text.matchAll(/\$([A-Za-z]{2,10})/g)) {
    if (m[1]) found.add(m[1].toUpperCase());
  }

  for (const w of text.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (KNOWN_TICKERS.includes(w)) found.add(w);
    if (w.endsWith('USDT') && w.length > 4) found.add(w.slice(0, -4));
  }

  const lower = text.toLowerCase();
  for (const [name, ticker] of Object.entries(NAME_TO_TICKER)) {
    if (lower.includes(name)) found.add(ticker);
  }

  return [...found];
}
