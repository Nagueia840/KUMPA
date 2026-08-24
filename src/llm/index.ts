import OpenAI from 'openai';
import type { ChatMessage } from '../types/index.js';
import type { LLMSettings } from '../config/settings.js';

/** Tipo de mensaje del SDK de OpenAI (compatible con Groq/DeepSeek/OpenRouter). */
type OpenAIMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ChatOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string; // override del modelo (ej: fast/smart)
}

/** Cliente LLM OpenAI-compatible (Groq, DeepSeek, OpenRouter, custom). */
export class LLMClient {
  readonly client: OpenAI;
  readonly settings: LLMSettings;

  constructor(settings: LLMSettings) {
    if (!settings.apiKey) {
      throw new Error(
        'Falta LLM_API_KEY. Agregala en .env o en la tabla app_settings de Supabase (llm_api_key).',
      );
    }
    this.settings = settings;
    this.client = new OpenAI({ baseURL: settings.baseURL, apiKey: settings.apiKey });
  }

  /** Convierte mensajes de dominio a la forma tipada del SDK (sin assertions). */
  private toOpenAI(messages: ChatMessage[], system?: string): OpenAIMessageParam[] {
    const out: OpenAIMessageParam[] = [];
    if (system) out.push({ role: 'system', content: system });
    for (const m of messages) {
      switch (m.role) {
        case 'system':
          out.push({ role: 'system', content: m.content });
          break;
        case 'user':
          out.push({ role: 'user', content: m.content });
          break;
        case 'assistant':
          out.push({ role: 'assistant', content: m.content });
          break;
      }
    }
    return out;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: opts.model ?? this.settings.model,
      messages: this.toOpenAI(messages, opts.system),
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
      const res = await this.client.chat.completions.create({
        model: opts.model ?? this.settings.model,
        messages: this.toOpenAI(messages, system),
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
  // <think>...</think> y <thinking>...</thinking>
  out = out.replace(/<think(?:ing)?[\s\S]*?<\/(?:think|thinking)>/gi, '');
  // zero-width spaces (artefactos de algunos modelos)
  out = out.replace(/\u200b/g, '');
  // colapsa líneas en blanco excesivas
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}
