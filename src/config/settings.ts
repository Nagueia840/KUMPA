import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './env.js';
import { LLM_PROVIDERS } from './constants.js';
import type { LLMProvider } from '../types/index.js';

/** Configuración resuelta del LLM (proveedor + credenciales + modelos). */
export interface LLMSettings {
  provider: LLMProvider;
  apiKey: string;
  baseURL: string;
  model: string;
  fastModel: string;
  smartModel: string;
}

const SETTINGS_KEYS = [
  'llm_provider',
  'llm_api_key',
  'llm_base_url',
  'llm_model',
  'llm_fast_model',
  'llm_smart_model',
] as const;

const PROVIDERS: LLMProvider[] = ['groq', 'deepseek', 'openrouter', 'custom'];

function isLLMProvider(value: string | undefined): value is LLMProvider {
  return value !== undefined && (PROVIDERS as string[]).includes(value);
}

let cached: LLMSettings | null = null;

/**
 * Resuelve la configuración del LLM en este orden:
 *  1) Defaults del proveedor (constants)
 *  2) Variables de entorno (.env / entorno del deploy)
 *  3) Overrides en la tabla `app_settings` de Supabase (cambiar sin redeploy)
 */
export async function getLLMSettings(forceRefresh = false): Promise<LLMSettings> {
  if (cached && !forceRefresh) return cached;

  const env = loadEnv();
  const providerDefaults = LLM_PROVIDERS[env.LLM_PROVIDER];

  const settings: LLMSettings = {
    provider: env.LLM_PROVIDER,
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL ?? providerDefaults.baseURL,
    model: env.LLM_MODEL || providerDefaults.model,
    fastModel: env.LLM_FAST_MODEL || providerDefaults.fastModel,
    smartModel: env.LLM_SMART_MODEL || providerDefaults.smartModel,
  };

  // Overrides desde Supabase (opcional: sin Supabase seguimos con env).
  // Se usa SERVICE_ROLE porque app_settings puede contener llm_api_key (secreto).
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY;
  if (env.SUPABASE_URL && supabaseKey) {
    try {
      const supabase = createClient(env.SUPABASE_URL, supabaseKey);
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', [...SETTINGS_KEYS]);

      if (error) {
        console.warn('[settings] No se pudo leer app_settings (usando env):', error.message);
      } else if (data && data.length > 0) {
        const map = new Map<string, string>(data.map((row) => [row.key, String(row.value)]));

        const providerOverride = map.get('llm_provider');
        if (isLLMProvider(providerOverride)) {
          settings.provider = providerOverride;
          const pd = LLM_PROVIDERS[providerOverride];
          settings.baseURL = map.get('llm_base_url') ?? pd.baseURL;
          settings.model = map.get('llm_model') ?? pd.model;
          settings.fastModel = map.get('llm_fast_model') ?? pd.fastModel;
          settings.smartModel = map.get('llm_smart_model') ?? pd.smartModel;
        } else {
          settings.baseURL = map.get('llm_base_url') ?? settings.baseURL;
          settings.model = map.get('llm_model') ?? settings.model;
          settings.fastModel = map.get('llm_fast_model') ?? settings.fastModel;
          settings.smartModel = map.get('llm_smart_model') ?? settings.smartModel;
        }
        settings.apiKey = map.get('llm_api_key') ?? settings.apiKey;
      }
    } catch (err) {
      console.warn('[settings] Supabase no disponible (usando env):', err instanceof Error ? err.message : err);
    }
  }

  cached = settings;
  return settings;
}

/**
 * Actualiza un setting del LLM en Supabase (requiere SERVICE_ROLE).
 * Permite cambiar de proveedor/modelo sin tocar código ni redeploy.
 */
export async function updateLLMSetting(key: string, value: string): Promise<void> {
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son necesarias para actualizar settings');
  }
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(`No se pudo actualizar ${key}: ${error.message}`);
  cached = null; // invalida caché para que el próximo getLLMSettings relea
}

/** Configuración resuelta de embeddings (memoria semántica). */
export interface EmbeddingSettings {
  apiKey: string;
  baseURL: string;
  model: string;
}

let cachedEmbedding: EmbeddingSettings | null = null;

/**
 * Resuelve la configuración de embeddings (env + app_settings de Supabase).
 * Por defecto OpenAI text-embedding-3-small (dim 1536).
 */
export async function getEmbeddingSettings(forceRefresh = false): Promise<EmbeddingSettings> {
  if (cachedEmbedding && !forceRefresh) return cachedEmbedding;

  const env = loadEnv();
  const settings: EmbeddingSettings = {
    apiKey: env.EMBEDDING_API_KEY,
    baseURL: env.EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1',
    model: env.EMBEDDING_MODEL,
  };

  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY;
  if (env.SUPABASE_URL && supabaseKey) {
    try {
      const supabase = createClient(env.SUPABASE_URL, supabaseKey);
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['embedding_api_key', 'embedding_base_url', 'embedding_model']);
      if (!error && data && data.length > 0) {
        const map = new Map<string, string>(data.map((row) => [row.key, String(row.value)]));
        settings.apiKey = map.get('embedding_api_key') ?? settings.apiKey;
        settings.baseURL = map.get('embedding_base_url') ?? settings.baseURL;
        settings.model = map.get('embedding_model') ?? settings.model;
      }
    } catch (err) {
      console.warn('[settings] Supabase no disponible para embeddings:', err instanceof Error ? err.message : err);
    }
  }

  cachedEmbedding = settings;
  return settings;
}

/** Configuración resuelta de visión (imágenes). */
export interface VisionSettings {
  apiKey: string;
  baseURL: string;
  model: string;
  fallbackModel?: string;
}

export async function getVisionSettings(): Promise<VisionSettings> {
  const env = loadEnv();
  return {
    apiKey: env.VISION_API_KEY,
    // Default: OpenRouter (gratis, funciona global; modelos :free con fallback)
    baseURL: env.VISION_BASE_URL ?? 'https://openrouter.ai/api/v1',
    model: env.VISION_MODEL || 'minimax/minimax-m3:free',
    fallbackModel: env.VISION_MODEL_FALLBACK || 'google/gemma-4-31b-it:free',
  };
}
