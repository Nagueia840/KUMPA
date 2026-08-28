import OpenAI from 'openai';
import type { ChatMessage } from '../types/index.js';
import type { LLMSettings } from '../config/settings.js';

type OpenAIMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type CreateParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

export interface ChatOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string; // override del modelo (ej: fast/smart)
}

interface ChainEntry {
  client: OpenAI;
  settings: LLMSettings;
}

/**
 * Timeout por llamada LLM (30s). El SDK openai trae DEFAULT_TIMEOUT=600000
 * (10 min), pero el Edge Worker (plan free) recicla la instancia a los ~150s
 * de wall-clock: un provider que cuelga dejaría la llamada pendiente hasta que
 * la plataforma mate la instancia SIN que `finishPendingUpdate` corra (la fila
 * queda `processing` para siempre). Con 30s el hang se convierte en error
 * controlado (timeout → fallback → retry/failed) y deja presupuesto para el
 * resto del pipeline dentro de 150s.
 */
export const LLM_TIMEOUT_MS = 30_000;

/** Info del proveedor/modelo que atendió una llamada (observabilidad, sin secretos). */
export interface LLMProviderInfo {
  provider: string;
  model: string;
  attempt: number;
}

/**
 * Cliente LLM OpenAI-compatible con FALLBACK automático de proveedor:
 * ante 429 (rate limit), 5xx o errores de auth, prueba el siguiente
 * proveedor de la cadena (ej. Groq → OpenRouter :free → DeepSeek).
 */
export class LLMClient {
  private chain: ChainEntry[];
  readonly settings: LLMSettings;
  private readonly timeoutMs: number;

  constructor(
    primary: LLMSettings,
    fallbacks: LLMSettings[] = [],
    opts: { timeoutMs?: number } = {},
  ) {
    if (!primary.apiKey) {
      throw new Error(
        'Falta LLM_API_KEY. Agregala en .env o en la tabla app_settings de Supabase (llm_api_key).',
      );
    }
    this.settings = primary;
    this.timeoutMs = opts.timeoutMs ?? LLM_TIMEOUT_MS;
    this.chain = [this.buildEntry(primary), ...fallbacks.filter((f) => f.apiKey).map((f) => this.buildEntry(f))];
  }

  private buildEntry(s: LLMSettings): ChainEntry {
    // timeout: aborta la llamada colgada (AbortController del SDK) ANTES del
    // reciclaje de la plataforma. maxRetries: 0 → el fallback entre proveedores
    // es el reintento (el retry interno del SDK multiplicaría el tiempo muerto).
    return {
      client: new OpenAI({
        baseURL: s.baseURL,
        apiKey: s.apiKey,
        timeout: this.timeoutMs,
        maxRetries: 0,
      }),
      settings: s,
    };
  }

  /** Cliente del proveedor primario (compat). */
  get client(): OpenAI {
    return this.chain[0]!.client;
  }

  /** Chat completions con fallback automático entre proveedores. */
  async completionsCreate(
    params: CreateParams,
    opts: { onProvider?: (info: LLMProviderInfo) => void } = {},
  ) {
    let lastError: unknown = new Error('Sin proveedores LLM disponibles');
    let attempt = 0;
    for (const entry of this.chain) {
      attempt++;
      try {
        const model = this.mapModel(params.model, entry.settings);
        const res = await entry.client.chat.completions.create({ ...params, model });
        // Observabilidad (F.3.1.1): qué proveedor/modelo atendió realmente.
        opts.onProvider?.({ provider: entry.settings.provider, model, attempt });
        return res;
      } catch (err) {
        lastError = err;
        if (!shouldFallbackProvider(err)) throw err;
        console.warn(
          `[llm] proveedor ${entry.settings.provider} falló, probando siguiente:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    throw lastError;
  }

  /** Mapea el modelo pedido (del primario) al equivalente del proveedor de turno. */
  private mapModel(requested: string, entry: LLMSettings): string {
    if (requested === this.settings.model) return entry.model;
    if (requested === this.settings.fastModel) return entry.fastModel;
    if (requested === this.settings.smartModel) return entry.smartModel;
    return requested;
  }

  private buildMessages(messages: ChatMessage[], system?: string): OpenAIMessageParam[] {
    return (system
      ? [{ role: 'system' as const, content: system }, ...messages]
      : messages) as OpenAIMessageParam[];
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const res = await this.completionsCreate({
      model: opts.model ?? this.settings.model,
      messages: this.buildMessages(messages, opts.system),
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1500,
    });
    const raw = res.choices[0]?.message?.content?.trim() ?? '';
    return stripReasoning(raw);
  }

  /** Pide JSON y lo parsea con tolerancia a fences markdown. */
  async chatJSON<T>(messages: ChatMessage[], opts: ChatOptions = {}): Promise<T> {
    const jsonInstruction =
      'Respondé ÚNICAMENTE con un JSON válido, sin markdown ni texto alrededor.';
    const system = opts.system ? `${opts.system}\n\n${jsonInstruction}` : jsonInstruction;

    const attempt = async (withResponseFormat: boolean): Promise<T> => {
      const res = await this.completionsCreate({
        model: opts.model ?? this.settings.model,
        messages: this.buildMessages(messages, system),
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 2000,
        response_format: withResponseFormat ? { type: 'json_object' } : undefined,
      });
      const raw = res.choices[0]?.message?.content?.trim() ?? '';
      return parseJSON<T>(raw);
    };

    try {
      return await attempt(true);
    } catch {
      // Algunos proveedores no soportan response_format json_object → reintentar sin él
      return await attempt(false);
    }
  }

  /** Transcribe audio a texto con Whisper (Groq). */
  async transcribeAudio(file: File, model: string, language = 'es'): Promise<string> {
    const res = await this.chain[0]!.client.audio.transcriptions.create({ model, file, language });
    return res.text;
  }
}

/** ¿Debe probarse el siguiente proveedor ante este error? (429/5xx/auth/red) */
export function shouldFallbackProvider(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    // "timed out" (APIConnectionTimeoutError del SDK openai) + variantes de red
    /rate limit|quota|tokens per (day|minute)|authentication|fetch failed|ECONNREFUSED|ETIMEDOUT|timed out|timeout/i.test(
      msg,
    )
  );
}

/** Extrae y parsea JSON, tolerando fences markdown ```json ... ```. */
export function parseJSON<T>(raw: string): T {
  let cleaned = raw.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence?.[1]) cleaned = fence[1];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned) as T;
}

/**
 * Elimina bloques de razonamiento (chain-of-thought) que algunos modelos
 * emiten antes de la respuesta real (ej. <think>...</think> de Qwen 3.x).
 * Deja solo el texto visible para el usuario.
 */
export function stripReasoning(text: string): string {
  let out = text;
  // <think>...</think> y <thinking>...</thinking> (cerrados)
  out = out.replace(/<think(?:ing)?[\s\S]*?<\/(?:think|thinking)>/gi, '');
  // bloque sin cerrar: <think ... hasta el final
  out = out.replace(/<think(?:ing)?[\s\S]*$/gi, '');
  // zero-width spaces (artefactos de algunos modelos)
  out = out.replace(/\u200b/g, '');
  // colapsa líneas en blanco excesivas
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}
