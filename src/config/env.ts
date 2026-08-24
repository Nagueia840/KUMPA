import { z } from 'zod';

// Carga .env nativo de Node (>= 20.12). No lanza si el archivo no existe
// (en producción las variables vienen del entorno del deploy).
try {
  process.loadEnvFile();
} catch {
  // .env opcional
}

const envSchema = z.object({
  // ── Runtime ──────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),

  // ── Telegram ─────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_USER_IDS: z.string().default(''),

  // ── Supabase ─────────────────────────────────────────────
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // ── LLM (opcional: puede venir de app_settings en Supabase)
  LLM_PROVIDER: z.enum(['groq', 'deepseek', 'openrouter', 'custom']).default('groq'),
  LLM_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_MODEL: z.string().default(''),
  LLM_FAST_MODEL: z.string().default(''),
  LLM_SMART_MODEL: z.string().default(''),

  // ── Fuentes de datos ─────────────────────────────────────
  BITGET_API_KEY: z.string().default(''),
  BITGET_SECRET_KEY: z.string().default(''),
  BITGET_PASSPHRASE: z.string().default(''),
  DUNE_API_KEY: z.string().default(''),
  FLIPSIDE_API_KEY: z.string().default(''),
  ARKHAM_API_KEY: z.string().default(''),
  GLASSNODE_API_KEY: z.string().default(''),
  ALCHEMY_API_KEY: z.string().default(''),

  // ── Redis (BullMQ, opcional en MVP) ──────────────────────
  UPSTASH_REDIS_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Valida y cachea la configuración de entorno. Lanza un error claro si falta algo crítico. */
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida o incompleta:\n${details}`);
  }
  cached = parsed.data;
  return parsed.data;
}
