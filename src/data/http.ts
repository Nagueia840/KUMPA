export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** GET JSON con manejo de errores HTTP y opción de headers/init personalizados. */
export async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new HttpError(res.status, `HTTP ${res.status} para ${url}`);
  }
  return (await res.json()) as T;
}

/** POST JSON con manejo de errores HTTP y headers personalizables. */
export async function postJSON<T>(url: string, body: unknown, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(url, {
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
