import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { analyzeReview } from '../../agents/analyst.js';
import { formatLearning } from '../../utils/format.js';
import type { Learning } from '../../types/index.js';

export function registerReview(bot: Bot, deps: Deps): void {
  bot.command('review', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const input = (ctx.match ?? '').trim();
    if (!input) {
      await ctx.reply('Usá: /review &lt;qué pasó&gt;. Ej: /review entré long ETH 3500 y saltó el SL en 3400');
      return;
    }
    if (!deps.llm) {
      await ctx.reply('⚠️ Necesitás LLM_API_KEY para /review.');
      return;
    }

    await ctx.reply('📚 Extrayendo la lección…');

    try {
      const draft = await analyzeReview(deps.llm, input);
      const learning: Learning = { ...draft, chatId, createdAt: Date.now() };
      await deps.memory.saveLearning(learning);
      await ctx.reply(formatLearning(learning), { parse_mode: 'HTML' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ No pude procesar el review: ${msg}`);
    }
  });
}
