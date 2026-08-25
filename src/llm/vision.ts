import OpenAI from 'openai';
import type { VisionSettings } from '../config/settings.js';

/**
 * Cliente de visión (imágenes) vía API OpenAI-compatible (OpenRouter/Gemini/OpenAI).
 * Prueba el modelo principal y, si falla (rate limit, 404, etc.), usa el fallback.
 */
export class VisionClient {
  private readonly client: OpenAI;
  readonly settings: VisionSettings;

  constructor(settings: VisionSettings) {
    if (!settings.apiKey) {
      throw new Error('Falta VISION_API_KEY para leer imágenes.');
    }
    this.settings = settings;
    this.client = new OpenAI({
      baseURL: settings.baseURL,
      apiKey: settings.apiKey,
      // OpenRouter recomienda estos headers para ranking/uso
      defaultHeaders: settings.baseURL.includes('openrouter')
        ? { 'HTTP-Referer': 'https://kumpa.local', 'X-Title': 'Kumpa' }
        : undefined,
    });
  }

  async describe(imageUrl: string, prompt: string): Promise<string> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ];

    try {
      return await this.call(this.settings.model, messages);
    } catch (err) {
      // Fallback automático al segundo modelo gratuito
      if (this.settings.fallbackModel) {
        console.warn(
          `[vision] modelo ${this.settings.model} falló, usando ${this.settings.fallbackModel}:`,
          err instanceof Error ? err.message : err,
        );
        return await this.call(this.settings.fallbackModel, messages);
      }
      throw err;
    }
  }

  private async call(
    model: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  ): Promise<string> {
    const res = await this.client.chat.completions.create({ model, messages, max_tokens: 600 });
    return res.choices[0]?.message?.content?.trim() ?? 'No pude interpretar la imagen.';
  }
}
