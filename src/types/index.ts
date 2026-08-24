/** Proveedores LLM soportados (todos exponen API compatible con OpenAI). */
export type LLMProvider = 'groq' | 'deepseek' | 'openrouter' | 'custom';

/** Rol de un mensaje en una conversación LLM. */
export type ChatRole = 'system' | 'user' | 'assistant';

/** Mensaje de conversación LLM. */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Snapshot de mercado de un ticker (funding, OI, precio, basis). */
export interface MarketSnapshot {
  symbol: string;
  price: number;
  fundingRate: number; // tasa de funding actual (decimal, ej 0.00035)
  fundingRate7dAvg: number;
  openInterest: number; // USD o contratos
  openInterestDelta24h: number; // % cambio OI 24h
  basisAnnualized: number; // % anualizado spot vs perp
  volume24h: number;
  updatedAt: number;
}

/** Señal on-chain relevante. */
export interface OnchainSignal {
  symbol: string;
  metric: string; // ej 'exchange_netflow', 'whale_deposit', 'stablecoin_mint'
  value: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  source: string; // ej 'Arkham', 'Dune', 'Glassnode'
  description: string;
  timestamp: number;
}

/** Insight accionable que Kumpa entrega al usuario. */
export interface Insight {
  id?: string;
  title: string;
  summary: string;
  dataPoints: { label: string; value: string }[];
  judgment: string; // interpretación de Kumpa (juicio explícito)
  confidence: 'alta' | 'media' | 'baja';
  sources: string[];
  createdAt: number;
}

/** Plan de operación sugerido (Kumpa no ejecuta). */
export interface TradePlan {
  symbol: string;
  direction: 'long' | 'short' | 'neutral';
  entryZone: [number, number];
  stopLoss: number;
  takeProfits: { price: number; sizePct: number }[];
  positionSizePct: number; // % del capital sugerido
  riskReward: number;
  reasoning: string;
  eventRisks: string[]; // earnings, FOMC, unlocks, expiries
  createdAt: number;
}

/** Tipo de regla de alerta persistente. */
export type AlertType =
  | 'funding_above'
  | 'funding_below'
  | 'oi_delta_above'
  | 'price_cross'
  | 'whale_move'
  | 'earnings_surprise';

/** Regla de alerta persistente. */
export interface AlertRule {
  id?: string;
  chatId: number;
  type: AlertType;
  symbol: string;
  threshold: number;
  active: boolean;
  createdAt: number;
  lastTriggeredAt?: number;
}

/** Lección aprendida (loop de aprendizaje). */
export interface Learning {
  id?: string;
  chatId: number;
  topic: string;
  thesis: string;
  outcome: string; // qué pasó realmente
  lesson: string; // qué aprender
  tags: string[];
  createdAt: number;
}

/** Análisis red-team de una tesis de inversión. */
export interface ThesisAnalysis {
  thesis: string;
  bullCase: string[];
  bearCase: string[];
  keyRisks: string[];
  dataGaps: string[];
  verdict: string;
}

/** Borrador de lección que devuelve el LLM en /review (el resto lo completa el comando). */
export interface ReviewDraft {
  topic: string;
  thesis: string;
  outcome: string;
  lesson: string;
  tags: string[];
}
