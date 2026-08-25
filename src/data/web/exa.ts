import { postJSON } from '../http.js';

export interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
}

/**
 * Cliente de Exa (exa.ai) — búsqueda web semántica para IA.
 * Implementado según el skill oficial "build-with-exa" de Exa.
 * Requiere EXA_API_KEY.
 */
export class ExaClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api.exa.ai',
  ) {}

  /**
   * Búsqueda semántica. Request recomendado por Exa: query + highlights
   * (extractos token-eficientes; no apilar text/highlights/summary).
   */
  async search(query: string, numResults = 5): Promise<ExaResult[]> {
    const data = await postJSON<{ results: ExaResult[] }>(
      `${this.baseURL}/search`,
      {
        query,
        type: 'auto',
        numResults,
        contents: { highlights: true },
      },
      { headers: { 'x-api-key': this.apiKey } },
    );
    return data.results ?? [];
  }

  /** Extracción limpia de contenido desde URLs conocidas (contents endpoint). */
  async getContents(urls: string[]): Promise<ExaResult[]> {
    const data = await postJSON<{ results: ExaResult[] }>(
      `${this.baseURL}/contents`,
      { urls, text: true },
      { headers: { 'x-api-key': this.apiKey } },
    );
    return data.results ?? [];
  }
}
