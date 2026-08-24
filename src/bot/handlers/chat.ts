import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { buildAggregatedScan } from '../../data/snapshot.js';
import { analyzeScan } from '../../agents/analyst.js';
import { formatInsight, formatScan } from '../../utils/format.js';
import { detectTicker } from '../../utils/tickers.js';
import { KUMPA_SYSTEM_PROMPT } from '../../config/personality.js';

/**
 * Manejador de conversación libre: responde a cualquier mensaje de texto.
 *  - Si menciona un ticker → hace un scan + análisis automático.
 *  - Si no → responde conversacionalmente (con memoria de contexto).
 */
export function registerChat(bot: Bot, deps: Deps): void {
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith('/')) return;

    const chatId = ctx.chat.id;
    await ctx.replyWithChatAction('typing');

    // 1) Si menciona un ticker → scan automático
    const ticker = detectTicker(text);
    if (ticker) {
      await ctx.reply(`🔍 Analizando ${ticker}…`);
      try {
        const scan = await buildAggregatedScan(ticker, deps);
        await deps.memory.saveConversation(chatId, 'user', text);
        if (deps.llm) {
          const insight = await analyzeScan(deps.llm, scan);
          await deps.memory.saveConversation(chatId, 'assistant', insight.summary);
          await deps.memory.saveInsight(chatId, insight);
          await ctx.reply([formatScan(scan), '', formatInsight(insight)].join('\n'), {
            parse_mode: 'HTML',
          });
        } else {
          await ctx.reply(formatScan(scan), { parse_mode: 'HTML' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await ctx.reply(`⚠️ No pude analizar ${ticker}: ${msg}`);
      }
      return;
    }

    // 2) Conversación libre
    if (!deps.llm) {
      await ctx.reply('Perdón, todavía no tengo LLM configurado. Probá /scan BTC o /help.');
      return;
    }

    try {
      const history = await deps.memory.getRecentConversations(chatId, 10);
      const reply = await deps.llm.chat(
        [...history, { role: 'user', content: text }],
        { system: KUMPA_SYSTEM_PROMPT, temperature: 0.5, maxTokens: 800 },
      );
      await deps.memory.saveConversation(chatId, 'user', text);
      await deps.memory.saveConversation(chatId, 'assistant', reply);
      await ctx.reply(reply, { parse_mode: 'HTML' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ No pude responder: ${msg}`);
    }
  });
}
