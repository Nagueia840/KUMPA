import { LLMClient } from '../llm/index.js';
import { KUMPA_SYSTEM_PROMPT } from '../config/personality.js';
import type { AggregatedScan } from '../data/snapshot.js';
import type { Briefing } from '../data/briefing.js';
import type { Insight, ReviewDraft, ThesisAnalysis, TradePlan } from '../types/index.js';

/**
 * Analiza un scan con el LLM y devuelve un Insight estructurado (JSON).
 * Separa HECHOS (datos) de JUICIO (interpretación), según la personalidad de Kumpa.
 */
export async function analyzeScan(llm: LLMClient, scan: AggregatedScan): Promise<Insight> {
  const userPrompt = [
    `Analizá ${scan.symbol} (par ${scan.pair}) con estos HECHOS recolectados en vivo:`,
    '',
    JSON.stringify({ snapshot: scan.snapshot, context: scan.context }, null, 2),
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

  return llm.chatJSON<Insight>([{ role: 'user', content: userPrompt }], {
    system: KUMPA_SYSTEM_PROMPT,
    model: llm.settings.smartModel,
    temperature: 0.4,
    maxTokens: 1200,
  });
}

/** Convierte un setup del usuario en un plan de operación estructurado. */
export async function analyzePlan(
  llm: LLMClient,
  scan: AggregatedScan,
  setup: string,
): Promise<TradePlan> {
  const userPrompt = [
    `El usuario propone este setup para ${scan.symbol}: "${setup}"`,
    '',
    'Datos en vivo:',
    JSON.stringify({ snapshot: scan.snapshot, context: scan.context }, null, 2),
    '',
    'Devolvé ÚNICAMENTE un JSON con esta estructura exacta (precios en USD):',
    '{',
    '  "symbol": "' + scan.symbol + '",',
    '  "direction": "long | short | neutral",',
    '  "entryZone": [precio_min, precio_max],',
    '  "stopLoss": precio,',
    '  "takeProfits": [{"price": precio, "sizePct": 50}, {"price": precio, "sizePct": 30}],',
    '  "positionSizePct": 0,',
    '  "riskReward": 0,',
    '  "reasoning": "por qué este plan, con los datos",',
    '  "eventRisks": ["FOMC", "unlock", ...],',
    '  "createdAt": <timestamp en ms>',
    '}',
    '',
    'El tamaño sugerido (positionSizePct) debe ser prudente (1-5%). No ejecutás nada: solo sugerís.',
  ].join('\n');

  return llm.chatJSON<TradePlan>([{ role: 'user', content: userPrompt }], {
    system: KUMPA_SYSTEM_PROMPT,
    model: llm.settings.smartModel,
    temperature: 0.4,
    maxTokens: 1200,
  });
}

/** Desafía una tesis del usuario (red team) con casos a favor, en contra y riesgos. */
export async function analyzeThesis(
  llm: LLMClient,
  thesis: string,
  scan?: AggregatedScan,
): Promise<ThesisAnalysis> {
  const parts = [
    `El usuario propone esta TESIS: "${thesis}"`,
    scan
      ? `Datos de contexto en vivo:\n${JSON.stringify({ snapshot: scan.snapshot, context: scan.context }, null, 2)}`
      : '',
    'Devolvé ÚNICAMENTE un JSON con esta estructura exacta:',
    '{',
    '  "thesis": "la tesis reformulada",',
    '  "bullCase": ["argumento a favor 1", "argumento a favor 2"],',
    '  "bearCase": ["argumento en contra 1", "argumento en contra 2"],',
    '  "keyRisks": ["riesgo clave 1", "riesgo clave 2"],',
    '  "dataGaps": ["qué dato falta para validar"],',
    '  "verdict": "tu veredicto crítico y honesto"',
    '}',
  ];
  return llm.chatJSON<ThesisAnalysis>([{ role: 'user', content: parts.filter(Boolean).join('\n') }], {
    system: KUMPA_SYSTEM_PROMPT,
    model: llm.settings.smartModel,
    temperature: 0.5,
    maxTokens: 1200,
  });
}

/** Extrae una lección estructurada de un post-mortem de operación. */
export async function analyzeReview(llm: LLMClient, userInput: string): Promise<ReviewDraft> {
  const userPrompt = [
    `El usuario hace este post-mortem de una operación: "${userInput}"`,
    '',
    'Devolvé ÚNICAMENTE un JSON con esta estructura exacta:',
    '{',
    '  "topic": "ticker o tema (ej ETH)",',
    '  "thesis": "la tesis original de la operación",',
    '  "outcome": "qué pasó realmente (resultado)",',
    '  "lesson": "la lección accionable para no repetir el error",',
    '  "tags": ["tag1", "tag2"]',
    '}',
  ].join('\n');

  return llm.chatJSON<ReviewDraft>([{ role: 'user', content: userPrompt }], {
    system: KUMPA_SYSTEM_PROMPT,
    model: llm.settings.smartModel,
    temperature: 0.4,
    maxTokens: 800,
  });
}

/** Arma un briefing matutino conciso a partir de los datos agregados. */
export async function analyzeBriefing(llm: LLMClient, briefing: Briefing): Promise<string> {
  const userPrompt = [
    'Armá un briefing matutino conciso y accionable en español (es-AR) con estos datos:',
    JSON.stringify(briefing, null, 2),
    '',
    'Máximo 15 líneas. Resaltá lo más relevante para un trader de perpetuos: funding, OI, divergencias entre exchanges, narrativa y stablecoins.',
  ].join('\n');

  return llm.chat([{ role: 'user', content: userPrompt }], {
    system: KUMPA_SYSTEM_PROMPT,
    model: llm.settings.fastModel,
    temperature: 0.5,
    maxTokens: 800,
  });
}
