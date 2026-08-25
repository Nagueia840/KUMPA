/**
 * Corrige transcripciones imperfectas de Whisper (reconocimiento de voz).
 * Errores típicos al decir indicadores o términos en inglés.
 */
export function normalizeTranscript(text: string): string {
  return text
    .replace(/\bbig ?wop\b/gi, 'VWAP')
    .replace(/\bbig ?vop\b/gi, 'VWAP')
    .replace(/\bwop\b/gi, 'VWAP')
    .replace(/\brci\b/gi, 'RSI')
    .replace(/\brey ?ce ?i\b/gi, 'RSI')
    .replace(/\bere ?ese ?i\b/gi, 'RSI')
    .replace(/\bmacd ?e\b/gi, 'MACD')
    .replace(/\bmedia ?movil ?de ?veinte\b/gi, 'media móvil de 20')
    .replace(/\bsma ?veinte\b/gi, 'SMA 20')
    .replace(/\bema ?veinte\b/gi, 'EMA 20')
    .trim();
}
