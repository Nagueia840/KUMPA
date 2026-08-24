import OpenAI from 'openai';
import type { EmbeddingSettings } from '../config/settings.js';

/** Cliente de embeddings OpenAI-compatible (text-embedding-3-small por defecto). */
export class EmbeddingClient {
  private readonly client: OpenAI;
  readonly settings: EmbeddingSettings;

  constructor(settings: EmbeddingSettings) {
    if (!settings.apiKey) {
      throw new Error('Falta EMBEDDING_API_KEY para la memoria semántica.');
    }
    this.settings = settings;
    this.client = new OpenAI({ baseURL: settings.baseURL, apiKey: settings.apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({
      model: this.settings.model,
      input: text,
    });
    return res.data[0]?.embedding ?? [];
  }
}

/** Convierte un array de números al literal vector de pgvector: [1,2,3]. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
