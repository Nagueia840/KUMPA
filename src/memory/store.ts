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
}
