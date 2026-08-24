import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from '../config/env.js';
import type { ChatMessage, ChatRole, Insight, Learning } from '../types/index.js';

/**
 * Memoria persistente en Supabase con fallback silencioso a "sin memoria"
 * cuando Supabase no está configurado (útil en desarrollo).
 */
export class MemoryStore {
  private readonly supabase: SupabaseClient | null;

  constructor() {
    const env = loadEnv();
    const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY;
    this.supabase = env.SUPABASE_URL && key ? createClient(env.SUPABASE_URL, key) : null;
  }

  get enabled(): boolean {
    return this.supabase !== null;
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
    const { error } = await this.supabase.from('insights').insert({
      chat_id: chatId,
      title: insight.title,
      summary: insight.summary,
      judgment: insight.judgment,
      confidence: insight.confidence,
      sources: insight.sources,
      data_points: insight.dataPoints,
    });
    if (error) console.warn('[memory] saveInsight:', error.message);
  }

  async saveLearning(learning: Learning): Promise<void> {
    if (!this.supabase) return;
    const { error } = await this.supabase.from('learnings').insert({
      chat_id: learning.chatId,
      topic: learning.topic,
      thesis: learning.thesis,
      outcome: learning.outcome,
      lesson: learning.lesson,
      tags: learning.tags,
    });
    if (error) console.warn('[memory] saveLearning:', error.message);
  }
}
