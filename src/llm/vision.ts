import OpenAI from 'openai';
import type { VisionSettings } from '../config/settings.js';

/**
 * Cliente de visión (imágenes) vía API OpenAI-compatible.
 * Requiere un provider multimodal: OpenRouter, Google Gemini o OpenAI.
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
    const res = await this.client.chat.completions.create({
      model: this.settings.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 600,
    });
    return res.choices[0]?.message?.content?.trim() ?? 'No pude interpretar la imagen.';
  }
}
