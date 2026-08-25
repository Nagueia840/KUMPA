import { getJSON } from '../http.js';

export interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

export interface WeatherNow {
  temperature: number;
  windSpeed: number;
  weatherCode: number;
  relativeHumidity: number;
}

/** Descripción de códigos WMO (weather code). */
export function weatherCodeDescription(code: number): string {
  const map: Record<number, string> = {
    0: 'Despejado',
    1: 'Mayormente despejado',
    2: 'Parcialmente nublado',
    3: 'Nublado',
    45: 'Niebla',
    48: 'Niebla con escarcha',
    51: 'Llovizna ligera',
    53: 'Llovizna moderada',
    55: 'Llovizna intensa',
    61: 'Lluvia ligera',
    63: 'Lluvia moderada',
    65: 'Lluvia intensa',
    71: 'Nieve ligera',
    73: 'Nieve moderada',
    75: 'Nieve intensa',
    80: 'Chubascos ligeros',
    81: 'Chubascos moderados',
    82: 'Chubascos violentos',
    95: 'Tormenta',
    96: 'Tormenta con granizo',
    99: 'Tormenta con granizo fuerte',
  };
  return map[code] ?? `Código ${code}`;
}

/** Cliente de Open-Meteo (gratis, sin key): geocoding + clima actual. */
export class OpenMeteoClient {
  async geocode(name: string): Promise<GeocodingResult | null> {
    const data = await getJSON<{ results?: GeocodingResult[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`,
    );
    return data.results?.[0] ?? null;
  }

  async getCurrent(lat: number, lon: number): Promise<WeatherNow> {
    const data = await getJSON<{
      current: {
        temperature_2m: number;
        wind_speed_10m: number;
        weather_code: number;
        relative_humidity_2m: number;
      };
    }>(
      `${'https://api.open-meteo.com/v1/forecast'}?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,weather_code,relative_humidity_2m`,
    );
    return {
      temperature: data.current.temperature_2m,
      windSpeed: data.current.wind_speed_10m,
      weatherCode: data.current.weather_code,
      relativeHumidity: data.current.relative_humidity_2m,
    };
  }
}
