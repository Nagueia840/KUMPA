import { getJSON } from '../http.js';

export interface FredObservation {
  date: string;
  value: string; // '.' = dato faltante
}

/**
 * Cliente de FRED (Federal Reserve Economic Data) — macro.
 * Series útiles: DGS10 (bono 10y), DFF (fed funds), CPIAUCSL (CPI),
 * UNRATE (desempleo), VIXCLS (VIX). Requiere FRED_API_KEY (gratis).
 */
export class FredClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseURL = 'https://api.stlouisfed.org/fred',
  ) {}

  async getSeries(seriesId: string, limit = 10): Promise<FredObservation[]> {
    const data = await getJSON<{ observations: FredObservation[] }>(
      `${this.baseURL}/series/observations?series_id=${seriesId}&api_key=${this.apiKey}&file_type=json&sort_order=desc&limit=${limit}`,
    );
    return data.observations;
  }
}
