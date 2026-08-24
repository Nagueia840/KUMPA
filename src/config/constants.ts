import type { LLMProvider } from '../types/index.js';

interface ProviderDefaults {
  baseURL: string;
  model: string;
  fastModel: string;
  smartModel: string;
}

/** Catálogo de proveedores LLM compatibles con la API de OpenAI. */
export const LLM_PROVIDERS: Record<LLMProvider, ProviderDefaults> = {
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    fastModel: 'openai/gpt-oss-120b',
    smartModel: 'openai/gpt-oss-120b',
  },
  deepseek: {
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    fastModel: 'deepseek-chat',
    smartModel: 'deepseek-reasoner',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    model: '',
    fastModel: '',
    smartModel: '',
  },
  custom: {
    baseURL: '',
    model: '',
    fastModel: '',
    smartModel: '',
  },
};

export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

// Rate-limit simple por chat (ventana deslizante)
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 30;

// Cantidad máxima de mensajes de contexto que se envían al LLM
export const MAX_CONTEXT_MESSAGES = 20;

// Watchlist por defecto (se refina en fases posteriores)
export const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL'] as const;
