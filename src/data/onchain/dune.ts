import { getJSON } from '../http.js';

export interface DuneResults {
  result?: {
    rows: Record<string, unknown>[];
    metadata?: unknown;
  };
  execution_id?: string;
}

/**
 * Cliente de Dune Analytics (SQL on-chain). Requiere DUNE_API_KEY.
 * Usa una query ya guardada por ID en Dune y devuelve sus últimos resultados.
 */
export class DuneClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api.dune.com/api/v1',
  ) {}

  async getQueryResults(queryId: number, params?: Record<string, string>): Promise<DuneResults> {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    return getJSON<DuneResults>(`${this.baseURL}/query/${queryId}/results${qs}`, {
      headers: { 'x-dune-api-key': this.apiKey },
    });
  }
}
