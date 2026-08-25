import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { handleMessage } from '../../agents/agent.js';
import { replyLong } from '../../utils/telegram.js';

/**
 * Conversación libre: todo mensaje sin comando pasa por el agente (function calling).
 * El agente decide solo si necesita datos, alertas o responder directo.
 */
export function registerChat(bot: Bot, deps: Deps): void {
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith('/')) return;

    const chatId = ctx.chat.id;
    await ctx.replyWithChatAction('typing');

    try {
      const reply = await handleMessage(deps, chatId, text);
      if (reply) {
        await deps.memory.saveConversation(chatId, 'user', text);
        await deps.memory.saveConversation(chatId, 'assistant', reply);
        await replyLong(ctx, reply);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ Algo salió mal: ${msg}`);
    }
  });
}
