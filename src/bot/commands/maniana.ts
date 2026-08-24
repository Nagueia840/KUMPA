import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { buildMorningBriefing } from '../../data/briefing.js';
import { analyzeBriefing } from '../../agents/analyst.js';
import { formatBriefingData } from '../../utils/format.js';

export function registerManiana(bot: Bot, deps: Deps): void {
  bot.command('mañana', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    await ctx.reply('🌅 Armando el briefing matutino…');

    try {
      const briefing = await buildMorningBriefing(deps, deps.defiLlama);
      await deps.memory.saveConversation(chatId, 'user', '/mañana');

      if (deps.llm) {
        const text = await analyzeBriefing(deps.llm, briefing);
        await deps.memory.saveConversation(chatId, 'assistant', text);
        await ctx.reply(text, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(formatBriefingData(briefing), { parse_mode: 'HTML' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ No pude armar el briefing: ${msg}`);
    }
  });
}
