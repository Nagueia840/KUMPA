import { loadEnv } from '../../config/env.js';
import { BitgetClient } from './client.js';

export * from './client.js';
export * from './sign.js';
export * from './types.js';

/** Crea un cliente Bitget a partir de la configuración de entorno. */
export function createBitgetClient(): BitgetClient {
  const env = loadEnv();
  return new BitgetClient({
    apiKey: env.BITGET_API_KEY,
    secretKey: env.BITGET_SECRET_KEY,
    passphrase: env.BITGET_PASSPHRASE,
    baseURL: 'https://api.bitget.com',
  });
}
