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
    const updateId = ctx.update.update_id;
    const t0 = Date.now();
    console.log(`[worker-stage] update=${updateId} stage=typing`);
    await ctx.replyWithChatAction('typing');

    try {
      console.log(`[worker-stage] update=${updateId} stage=agent_start`);
      const reply = await handleMessage(deps, chatId, text);
      console.log(`[worker-stage] update=${updateId} stage=agent_done ms=${Date.now() - t0}`);
      if (reply) {
        await deps.memory.saveConversation(chatId, 'user', text);
        await deps.memory.saveConversation(chatId, 'assistant', reply);
        console.log(`[worker-stage] update=${updateId} stage=save_done ms=${Date.now() - t0}`);
        await replyLong(ctx, reply);
        console.log(`[worker-stage] update=${updateId} stage=reply_done ms=${Date.now() - t0}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[worker-stage] update=${updateId} stage=agent_error: ${msg}`);
      await ctx.reply(`⚠️ Algo salió mal: ${msg}`);
    }
  });
}
