/**
 * Parser del payload real de Supabase Database Webhooks.
 * Formato típico de un webhook "On INSERT" en update_inbox:
 * {
 *   "type": "INSERT",
 *   "table": "update_inbox",
 *   "schema": "public",
 *   "record": { "update_id": 123, "payload": {...}, "status": "pending", ... },
 *   "old_record": null
 * }
 * No se asume que el payload sea el JSON de Telegram: se localiza record.update_id.
 */

export interface DbWebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: { update_id?: unknown; [key: string]: unknown };
  old_record?: unknown;
}

/** Extrae update_id de un payload de Database Webhook; null si no aplica. */
export function parseDbWebhookUpdateId(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as DbWebhookPayload;
  if (b.type !== 'INSERT' || b.table !== 'update_inbox') return null;
  const id = Number(b.record?.update_id);
  return Number.isFinite(id) ? id : null;
}
