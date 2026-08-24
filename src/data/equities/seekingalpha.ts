import { getJSON } from '../http.js';

export interface SaNewsItem {
  id: string;
  attributes?: {
    title?: string;
    publishOn?: string;
    gettyImageUrl?: string;
  };
}

export interface SaNewsResponse {
  data?: SaNewsItem[];
  included?: unknown[];
}

/**
 * Cliente de Seeking Alpha (equities: noticias/análisis). Gratis, sin key.
 * NOTA: la API pública puede requerir cookies/User-Agent y cambiar; verificar
 * en vivo. El shape exacto de `attributes` se ajusta contra la respuesta real.
 */
export class SeekingAlphaClient {
  constructor(private readonly baseURL = 'https://seekingalpha.com') {}

  async getNews(symbol: string, size = 10): Promise<SaNewsItem[]> {
    const url = `${this.baseURL}/api/v3/news?filter[symbol]=${encodeURIComponent(symbol)}&filter[until]=0&filter[since]=0&filter[size]=${size}`;
    const data = await getJSON<SaNewsResponse>(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Kumpa/0.1' },
    });
    return data.data ?? [];
  }
}
