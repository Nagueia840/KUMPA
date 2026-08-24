import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';

export function registerRecordar(bot: Bot, deps: Deps): void {
  bot.command('recordar', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const query = (ctx.match ?? '').trim();
    if (!query) {
      await ctx.reply('Usá: /recordar &lt;qué buscás&gt;. Ej: /recordar funding negativo');
      return;
    }

    await ctx.reply('🔎 Buscando en la memoria…');

    try {
      const [insights, learnings] = await Promise.all([
        deps.memory.searchInsights(chatId, query),
        deps.memory.searchLearnings(chatId, query),
      ]);

      if (insights.length === 0 && learnings.length === 0) {
        await ctx.reply('No encontré nada en la memoria sobre eso (todavía).');
        return;
      }

      const lines: string[] = [];
      if (learnings.length > 0) {
        lines.push('📚 <b>Lecciones relacionadas</b>');
        for (const l of learnings) lines.push(`  • ${l.topic}: ${l.lesson}`);
        lines.push('');
      }
      if (insights.length > 0) {
        lines.push('🧠 <b>Insights relacionados</b>');
        for (const i of insights) lines.push(`  • ${i.title}: ${i.summary}`);
      }

      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ No pude buscar en la memoria: ${msg}`);
    }
  });
}
