import { MAX_ATTEMPTS, type PendingUpdate, type UpdateQueueStore } from '../../src/webhook/queue.js';

/**
 * Store en memoria que replica la semántica real de update_inbox/processed_updates
 * (migración 004), incluida la recuperación de jobs colgados. Compartido por los
 * tests de cola y del worker.
 */
export function fakeQueueStore(): UpdateQueueStore & {
  rows: Map<number, { payload: string; status: string; attempts: number; created: number; startedAt: number | null }>;
  processed: Set<number>;
  finishLog: Array<{ id: number; ok: boolean; opts?: { error?: string; permanent?: boolean } }>;
} {
  const rows = new Map<number, { payload: string; status: string; attempts: number; created: number; startedAt: number | null }>();
  const processed = new Set<number>();
  const finishLog: Array<{ id: number; ok: boolean; opts?: { error?: string; permanent?: boolean } }> = [];
  let seq = 0;

  return {
    rows,
    processed,
    finishLog,
    savePendingUpdate: async (id, payload) => {
      // Misma semántica que MemoryStore: el PK decide (duplicate si ya existe).
      if (rows.has(id)) return 'duplicate' as const;
      rows.set(id, { payload: JSON.stringify(payload), status: 'pending', attempts: 0, created: seq++, startedAt: null });
      return 'inserted' as const;
    },
    claimPendingUpdate: async (updateId) => {
      const pend = updateId !== undefined
        ? rows.has(updateId) ? ([updateId, rows.get(updateId)!] as const) : undefined
        : [...rows.entries()].filter(([, r]) => r.status === 'pending').sort((a, b) => a[1].created - b[1].created)[0];
      if (!pend || pend[1].status !== 'pending') return null; // guard de estado (claim atómico)
      pend[1].status = 'processing';
      pend[1].attempts++;
      pend[1].startedAt = Date.now();
      return { updateId: pend[0], payload: pend[1].payload, attempts: pend[1].attempts };
    },
    finishPendingUpdate: async (id, ok, opts) => {
      finishLog.push({ id, ok, opts });
      const r = rows.get(id);
      if (!r) return;
      if (ok) {
        processed.add(id);
        rows.delete(id);
      } else if (opts?.permanent || r.attempts >= MAX_ATTEMPTS) {
        r.status = 'failed';
      } else {
        r.status = 'pending';
        r.startedAt = null;
      }
    },
    isUpdateProcessed: async (id) => processed.has(id),
    recoverStuckProcessing: async (maxAgeMs = 60_000, maxAttempts = MAX_ATTEMPTS) => {
      const cutoff = Date.now() - maxAgeMs;
      const stuck = [...rows.entries()].filter(
        ([, r]) => r.status === 'processing' && r.startedAt !== null && r.startedAt < cutoff,
      );
      let fixed = 0;
      for (const [, r] of stuck) {
        r.status = r.attempts >= maxAttempts ? 'failed' : 'pending';
        r.startedAt = null;
        fixed++;
      }
      return fixed;
    },
  };
}

export type { PendingUpdate };
