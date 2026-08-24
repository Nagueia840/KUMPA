import { LLMClient } from '../llm/index.js';
import { KUMPA_SYSTEM_PROMPT } from '../config/personality.js';
import type { AggregatedScan } from '../data/snapshot.js';
import type { Insight } from '../types/index.js';

/**
 * Analiza un scan con el LLM y devuelve un Insight estructurado (JSON).
 * Separa HECHOS (datos) de JUICIO (interpretación), según la personalidad de Kumpa.
 */
export async function analyzeScan(
  llm: LLMClient,
  scan: AggregatedScan,
): Promise<Insight> {
  const userPrompt = [
    `Analizá ${scan.symbol} (par ${scan.pair}) con estos HECHOS recolectados en vivo:`,
    '',
    JSON.stringify(
      {
        snapshot: scan.snapshot,
        context: scan.context,
      },
      null,
      2,
    ),
    '',
    'Devolvé ÚNICAMENTE un JSON con esta estructura exacta (sin markdown):',
    '{',
    '  "title": "título corto",',
    '  "summary": "resumen en 2-3 frases con los números clave",',
    '  "dataPoints": [{"label": "funding Binance", "value": "+0.0081%"}],',
    '  "judgment": "tu interpretación crítica: ¿qué señalás y por qué? ¿qué riesgo ves?",',
    '  "confidence": "alta | media | baja",',
    '  "sources": ["Binance", "Bybit", "CoinGecko"],',
    '  "createdAt": <timestamp en ms>',
    '}',
    '',
    'Separás HECHOS de JUICIO. No prometás retornos. Si hay divergencia de funding entre exchanges, señalala.',
  ].join('\n');

  return llm.chatJSON<Insight>(
    [{ role: 'user', content: userPrompt }],
    {
      system: KUMPA_SYSTEM_PROMPT,
      model: llm.settings.smartModel,
      temperature: 0.4,
      maxTokens: 1200,
    },
  );
}
