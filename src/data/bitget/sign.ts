import { createHmac } from 'node:crypto';

/** HMAC-SHA256 en base64 (estándar Bitget). */
function hmacBase64(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('base64');
}

/** Encripta la passphrase (header ACCESS-PASSPHRASE). */
export function encryptPassphrase(secretKey: string, passphrase: string): string {
  return hmacBase64(secretKey, passphrase);
}

export interface SignatureInput {
  secretKey: string;
  timestamp: string; // milisegundos como string
  method: string; // 'GET' | 'POST' | ...
  requestPath: string; // ej '/api/v2/mix/market/ticker'
  body: string; // GET: `?query` o ''; POST: JSON.stringify(body)
}

/**
 * Construye la firma Bitget v2:
 *   signature = Base64(HMAC_SHA256(secretKey, timestamp + method + requestPath + body))
 */
export function buildSignature(input: SignatureInput): string {
  const message = input.timestamp + input.method.toUpperCase() + input.requestPath + input.body;
  return hmacBase64(input.secretKey, message);
}
