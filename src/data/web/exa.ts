import { postJSON } from '../http.js';

export interface ExaResult {
  title?: string;
  url?: string;
  text?: string;
  publishedDate?: string;
}

/**
 * Cliente de Exa (exa.ai) — búsqueda web semántica para IA.
 * Requiere EXA_API_KEY (https://exa.ai).
 */
export class ExaClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api.exa.ai',
  ) {}

  async search(query: string, numResults = 5): Promise<ExaResult[]> {
    const data = await postJSON<{ results: ExaResult[] }>(
      `${this.baseURL}/search`,
      {
        query,
        numResults,
        contents: { text: true },
      },
      { headers: { 'x-api-key': this.apiKey } },
    );
    return data.results ?? [];
  }
}
