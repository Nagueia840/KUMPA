import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../config/env.js';
import { toVectorLiteral, type EmbeddingClient } from '../llm/embed.js';
import type {
  AlertRule,
  AlertType,
  ChatMessage,
  ChatRole,
  Insight,
  Learning,
  TradePlan,
} from '../types/index.js';

interface AlertRow {
  id: string;
  chat_id: number;
  type: AlertType;
  symbol: string;
  threshold: number;
  active: boolean;
  created_at: string;
  last_triggered_at: string | null;
}

export interface InsightHit {
  title: string;
  summary: string;
  judgment?: string;
  similarity?: number;
}

export interface LearningHit {
  topic: string;
  lesson: string;
  similarity?: number;
}

/**
 * Memoria persistente en Supabase con fallback silencioso a "sin memoria"
 * (o en-memoria para alertas) cuando Supabase no está configurado.
 * Si hay embedder, guarda embeddings y habilita búsqueda semántica.
 */
export class MemoryStore {
  private readonly supabase: SupabaseClient | null;
  private readonly embedder: EmbeddingClient | null;
  private readonly alerts: Map<string, AlertRule> = new Map();

  constructor(embedder: EmbeddingClient | null = null) {
    this.embedder = embedder;
    const env = loadEnv();
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY;
    this.supabase = env.SUPABASE_URL && key ? createClient(env.SUPABASE_URL, key) : null;
  }

  get enabled(): boolean {
    return this.supabase !== null;
  }

  get semanticEnabled(): boolean {
    return this.supabase !== null && this.embedder !== null;
  }

  private async embed(text: string): Promise<number[] | null> {
    if (!this.embedder) return null;
    try {
      const v = await this.embedder.embed(text);
      return v.length > 0 ? v : null;
    } catch (err) {
      console.warn('[memory] embedding falló:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async saveConversation(chatId: number, role: ChatRole, content: string): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase
      .from('conversations')
      .insert({ chat_id: chatId, role, content });
    if (error) console.warn('[memory] saveConversation:', error.message);
  }

  async getRecentConversations(chatId: number, limit = 20): Promise<ChatMessage[]> {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from('conversations')
      .select('role, content')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as { role: ChatRole; content: string }[])
      .reverse()
      .map((r) => ({ role: r.role, content: r.content }));
  }

  async saveInsight(chatId: number, insight: Insight): Promise<void> {
    if (!this.supabase) return;
    const embedding = await this.embed(insight.summary);
    const { error } = await this.supabase.from('insights').insert({
      chat_id: chatId,
      title: insight.title,
      summary: insight.summary,
      judgment: insight.judgment,
      confidence: insight.confidence,
      sources: insight.sources,
      data_points: insight.dataPoints,
      ...(embedding ? { embedding: toVectorLiteral(embedding) } : {}),
    });
    if (error) console.warn('[memory] saveInsight:', error.message);
  }

  async saveTradePlan(chatId: number, plan: TradePlan): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.from('trade_plans').insert({
      chat_id: chatId,
      symbol: plan.symbol,
      direction: plan.direction,
      entry_low: plan.entryZone[0],
      entry_high: plan.entryZone[1],
      stop_loss: plan.stopLoss,
      take_profits: plan.takeProfits,
      position_size_pct: plan.positionSizePct,
      reasoning: plan.reasoning,
      event_risks: plan.eventRisks,
    });
    if (error) console.warn('[memory] saveTradePlan:', error.message);
  }

  async saveLearning(learning: Learning): Promise<void> {
    if (!this.supabase) return;
    const embedding = await this.embed(learning.lesson);
    const { error } = await this.supabase.from('learnings').insert({
      chat_id: learning.chatId,
      topic: learning.topic,
      thesis: learning.thesis,
      outcome: learning.outcome,
      lesson: learning.lesson,
      tags: learning.tags,
      ...(embedding ? { embedding: toVectorLiteral(embedding) } : {}),
    });
    if (error) console.warn('[memory] saveLearning:', error.message);
  }

  async getLearnings(chatId: number, limit = 10): Promise<Learning[]> {
    if (!this.supabase) return [];
    const { data, error } = await this.supabase
      .from('learnings')
      .select('topic, thesis, outcome, lesson, tags, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as { topic: string; thesis: string; outcome: string; lesson: string; tags: string[]; created_at: string }[]).map(
      (r) => ({
        chatId,
        topic: r.topic,
        thesis: r.thesis,
        outcome: r.outcome,
        lesson: r.lesson,
        tags: r.tags,
        createdAt: Date.parse(r.created_at),
      }),
    );
  }

  /** Búsqueda semántica de insights (con fallback a keyword). */
  async searchInsights(chatId: number, query: string, limit = 5): Promise<InsightHit[]> {
    if (!this.supabase) return [];
    const embedding = await this.embed(query);
    if (embedding) {
      const { data, error } = await this.supabase.rpc('match_insights', {
        query_embedding: toVectorLiteral(embedding),
        match_count: limit,
        p_chat_id: chatId,
      });
      if (!error && data) {
        return (data as InsightHit[]).filter((d) => (d.similarity ?? 1) > 0.3);
      }
    }
    const { data, error } = await this.supabase
      .from('insights')
      .select('title, summary, judgment')
      .eq('chat_id', chatId)
      .ilike('summary', `%${query}%`)
      .limit(limit);
    if (error || !data) return [];
    return data as InsightHit[];
  }

  /** Búsqueda semántica de lecciones (con fallback a keyword). */
  async searchLearnings(chatId: number, query: string, limit = 5): Promise<LearningHit[]> {
    if (!this.supabase) return [];
    const embedding = await this.embed(query);
    if (embedding) {
      const { data, error } = await this.supabase.rpc('match_learnings', {
        query_embedding: toVectorLiteral(embedding),
        match_count: limit,
        p_chat_id: chatId,
      });
      if (!error && data) {
        return (data as LearningHit[]).filter((d) => (d.similarity ?? 1) > 0.3);
      }
    }
    const { data, error } = await this.supabase
      .from('learnings')
      .select('topic, lesson')
      .eq('chat_id', chatId)
      .ilike('lesson', `%${query}%`)
      .limit(limit);
    if (error || !data) return [];
    return data as LearningHit[];
  }

  // ── Alertas ──────────────────────────────────────────────

  async saveAlert(rule: AlertRule): Promise<void> {
    if (this.supabase) {
      const { error } = await this.supabase.from('alerts').insert({
        chat_id: rule.chatId,
        type: rule.type,
        symbol: rule.symbol,
        threshold: rule.threshold,
        active: true,
      });
      if (error) console.warn('[memory] saveAlert:', error.message);
      return;
    }
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.alerts.set(id, { ...rule, id });
  }

  async getActiveAlerts(chatId?: number): Promise<AlertRule[]> {
    if (this.supabase) {
      const base = this.supabase.from('alerts').select('*').eq('active', true);
      const filtered = chatId !== undefined ? base.eq('chat_id', chatId) : base;
      const { data, error } = await filtered;
      if (error || !data) return [];
      return (data as AlertRow[]).map((r) => ({
        id: r.id,
        chatId: r.chat_id,
        type: r.type,
        symbol: r.symbol,
        threshold: r.threshold,
        active: r.active,
        createdAt: Date.parse(r.created_at),
        lastTriggeredAt: r.last_triggered_at ? Date.parse(r.last_triggered_at) : undefined,
      }));
    }
    return [...this.alerts.values()].filter(
      (a) => a.active && (chatId === undefined || a.chatId === chatId),
    );
  }

  async markAlertTriggered(id?: string): Promise<void> {
    if (!id) return;
    if (this.supabase) {
      const { error } = await this.supabase
        .from('alerts')
        .update({ last_triggered_at: new Date().toISOString() })
        .eq('id', id);
      if (error) console.warn('[memory] markAlertTriggered:', error.message);
      return;
    }
    const a = this.alerts.get(id);
    if (a) a.lastTriggeredAt = Date.now();
  }

  // ── Cola de updates (webhook → Edge worker) ──────────────
  // Tablas update_inbox / processed_updates (migración 004). Solo estado de
  // procesamiento de updates de Telegram — NO snapshots de mercado.
  // Estados: pending → processing → (processed | failed). Attempts máx 3.

  /**
   * Encola un update de Telegram como pendiente.
   * INSERT puro: el PK (update_id) es el árbitro — si ya existe la fila, Postgres
   * devuelve error 23505 → 'duplicate' (sin re-insertar). 'inserted' = fila nueva.
   * (No usa upsert+ignoreDuplicates porque no permitiría distinguir los casos.)
   */
  async savePendingUpdate(
    updateId: number,
    payload: unknown,
  ): Promise<'inserted' | 'duplicate' | 'failed'> {
    if (!this.supabase) return 'failed';
    const { error } = await this.supabase.from('update_inbox').insert({
      update_id: updateId,
      payload,
      status: 'pending',
      attempts: 0,
    });
    if (!error) return 'inserted';
    // 23505 = duplicate key value violates unique constraint (update_id ya existe).
    if (error.code === '23505') return 'duplicate';
    console.warn('[memory] savePendingUpdate:', error.message);
    return 'failed';
  }

  /**
   * Claim ATÓMICO de un update (pending → processing).
   * - Sin updateId: reclama el pendiente más viejo (worker por lote/cron).
   * - Con updateId: reclama ESE update (worker de Edge, 1 update = 1 invocación).
   * El guard `.eq('status','pending')` en el UPDATE hace que dos workers
   * concurrentes no puedan reclamar la misma fila (el segundo afecta 0 filas
   * y devuelve null). Cada claim incrementa attempts y marca processing_started_at.
   */
  async claimPendingUpdate(
    updateId?: number,
  ): Promise<{ updateId: number; payload: string; attempts: number } | null> {
    if (!this.supabase) return null;
    let query = this.supabase
      .from('update_inbox')
      .select('update_id, payload, attempts')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);
    if (updateId !== undefined) {
      query = this.supabase
        .from('update_inbox')
        .select('update_id, payload, attempts')
        .eq('update_id', updateId)
        .eq('status', 'pending')
        .limit(1);
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;
    const row = data[0] as { update_id: number; payload: unknown; attempts: number };
    const attempts = (row.attempts ?? 0) + 1;
    const now = new Date().toISOString();
    const { data: claimed, error: updErr } = await this.supabase
      .from('update_inbox')
      .update({
        status: 'processing',
        attempts,
        processing_started_at: now,
        updated_at: now,
      })
      .eq('update_id', row.update_id)
      .eq('status', 'pending')
      .select('update_id');
    if (updErr || !claimed || claimed.length === 0) return null;
    return {
      updateId: row.update_id,
      payload: typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload),
      attempts,
    };
  }

  /**
   * Cierra un update:
   * - ok → inserta en processed_updates (idempotencia) y borra de update_inbox.
   * - fallo transitorio → re-pending (processing_started_at=null) salvo attempts>=3 → failed.
   * - fallo permanente (payload corrupto / config) → failed inmediato.
   * last_error se guarda SANITIZADO (sin tokens/keys, truncado).
   */
  async finishPendingUpdate(
    updateId: number,
    ok: boolean,
    opts: { error?: string; permanent?: boolean } = {},
  ): Promise<void> {
    if (!this.supabase) return;
    const now = new Date().toISOString();
    const sanitized = sanitizeError(opts.error ?? '');
    if (ok) {
      const { error } = await this.supabase
        .from('processed_updates')
        .upsert({ update_id: updateId, processed_at: now }, { onConflict: 'update_id' });
      if (error) console.warn('[memory] markProcessed:', error.message);
      const { error: delErr } = await this.supabase.from('update_inbox').delete().eq('update_id', updateId);
      if (delErr) console.warn('[memory] delPending:', delErr.message);
      return;
    }
    if (opts.permanent) {
      const { error } = await this.supabase
        .from('update_inbox')
        .update({ status: 'failed', last_error: sanitized, finished_at: now, updated_at: now })
        .eq('update_id', updateId);
      if (error) console.warn('[memory] markFailed:', error.message);
      return;
    }
    const { data, error } = await this.supabase
      .from('update_inbox')
      .select('attempts')
      .eq('update_id', updateId)
      .single();
    if (error || !data) return;
    const attempts = Number(data.attempts ?? 1);
    if (attempts >= 3) {
      const { error: err } = await this.supabase
        .from('update_inbox')
        .update({ status: 'failed', last_error: sanitized, finished_at: now, updated_at: now })
        .eq('update_id', updateId);
      if (err) console.warn('[memory] markFailed:', err.message);
      return;
    }
    const { error: updErr } = await this.supabase
      .from('update_inbox')
      .update({ status: 'pending', last_error: sanitized, processing_started_at: null, updated_at: now })
      .eq('update_id', updateId);
    if (updErr) console.warn('[memory] rePending:', updErr.message);
  }

  /** ¿El update_id ya fue procesado? (idempotencia de respuestas). */
  async isUpdateProcessed(updateId: number): Promise<boolean> {
    if (!this.supabase) return false;
    const { data, error } = await this.supabase
      .from('processed_updates')
      .select('update_id')
      .eq('update_id', updateId)
      .limit(1);
    return !error && !!data && data.length > 0;
  }

  /**
   * SAFETY-NET: jobs en 'processing' colgados (processing_started_at viejo) →
   * re-pending si attempts < maxAttempts, si no → failed. NO ejecuta análisis.
   * Devuelve cuántos corrigió.
   */
  async recoverStuckProcessing(
    maxAgeMs = 10 * 60_000,
    maxAttempts = 3,
  ): Promise<number> {
    if (!this.supabase) return 0;
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const { data, error } = await this.supabase
      .from('update_inbox')
      .select('update_id, attempts')
      .eq('status', 'processing')
      .lt('processing_started_at', cutoff)
      .limit(50);
    if (error || !data) return 0;
    let fixed = 0;
    const now = new Date().toISOString();
    for (const row of data as Array<{ update_id: number; attempts: number }>) {
      const attempts = Number(row.attempts ?? 1);
      const next = attempts >= maxAttempts ? 'failed' : 'pending';
      const { error: updErr } = await this.supabase
        .from('update_inbox')
        .update({
          status: next,
          processing_started_at: null,
          finished_at: next === 'failed' ? now : null,
          updated_at: now,
          last_error: next === 'failed' ? 'stuck (timeout lógico)' : null,
        })
        .eq('update_id', row.update_id)
        .eq('status', 'processing');
      if (!updErr) fixed++;
    }
    return fixed;
  }
}

/** Sanitiza un mensaje de error: elimina patrones de secretos y trunca. */
function sanitizeError(msg: string): string {
  const SECRET_RE =
    /(sk-or-v1-[A-Za-z0-9_-]+|gsk_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{20,}|bg_[A-Za-z0-9]+|sb_secret_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+|AKIA[0-9A-Z]{16})/g;
  return msg.replace(SECRET_RE, '[redacted]').slice(0, 300);
}
