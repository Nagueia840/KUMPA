export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Timeout por request HTTP externo. Los clientes raw fetch (Exa, DefiLlama,
 * CoinGecko, weather, Bitget directo en tools...) no abortaban jamás: un host
 * que acepta conexión pero nunca responde dejaba el await pendiente hasta el
 * reciclaje de la plataforma (worker edge ~150s / vercel 10s) sin error
 * controlado. Con 8s el hang se convierte en HttpError/AbortError → el flujo
 * lo clasifica como transitorio y reintenta o falla.
 */
export const HTTP_TIMEOUT_MS = 8000;

/** Wrapper de fetch con AbortController: aborta a los `ms` (default 8s). */
export async function fetchWithTimeout(
  url: string | URL | Request,
  init?: RequestInit,
  ms: number = HTTP_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`timeout ${url instanceof URL ? url.href : String(url)} (${ms}ms)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** GET JSON con manejo de errores HTTP y opción de headers/init personalizados. */
export async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithTimeout(url, init);
  if (!res.ok) {
    throw new HttpError(res.status, `HTTP ${res.status} para ${url}`);
  }
  return (await res.json()) as T;
}

/** POST JSON con manejo de errores HTTP y headers personalizables. */
export async function postJSON<T>(url: string, body: unknown, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetchWithTimeout(url, {
    ...init,
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new HttpError(res.status, `HTTP ${res.status} para ${url}`);
  }
  return (await res.json()) as T;
}

export function buildQueryString(
  query?: Record<string, string | number | boolean | undefined>,
): string {
  if (!query) return '';
  return Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}
