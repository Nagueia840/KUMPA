import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { analyzeThesis } from '../../agents/analyst.js';
import { formatThesis } from '../../utils/format.js';

export function registerThesis(bot: Bot, deps: Deps): void {
  bot.command('thesis', async (ctx) => {
    const thesis = (ctx.match ?? '').trim();
    if (!thesis) {
      await ctx.reply('Usá: /thesis &lt;tu idea&gt;. Ej: /thesis SOL va a $200 por el ETF');
      return;
    }
    if (!deps.llm) {
      await ctx.reply('⚠️ Necesitás LLM_API_KEY para /thesis.');
      return;
    }

    await ctx.reply('🎯 Desafiando tu tesis (red team)…');

    try {
      const analysis = await analyzeThesis(deps.llm, thesis);
      await ctx.reply(formatThesis(analysis), { parse_mode: 'HTML' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ No pude analizar la tesis: ${msg}`);
    }
  });
}
