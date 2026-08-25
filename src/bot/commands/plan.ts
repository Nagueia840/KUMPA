import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { buildAggregatedScan } from '../../data/snapshot.js';
import { analyzePlan } from '../../agents/analyst.js';
import { formatPlan, formatScan } from '../../utils/format.js';
import { replyLong } from '../../utils/telegram.js';

export function registerPlan(bot: Bot, deps: Deps): void {
  bot.command('plan', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const raw = (ctx.match ?? '').trim();
    if (!raw) {
      await ctx.reply('Usá: /plan &lt;TICKER&gt; &lt;setup&gt;. Ej: /plan ETH long $3500 con SL $3400');
      return;
    }
    if (!deps.llm) {
      await ctx.reply('⚠️ Necesitás LLM_API_KEY para /plan.');
      return;
    }

    const [symbolPart, ...setupParts] = raw.split(/\s+/);
    const symbol = (symbolPart ?? '').toUpperCase();
    const setup = setupParts.join(' ') || 'setup sin detalles';

    await ctx.reply(`📋 Armando plan para ${symbol}…`);

    try {
      const scan = await buildAggregatedScan(symbol, deps);
      const plan = await analyzePlan(deps.llm, scan, setup);
      await deps.memory.saveTradePlan(chatId, plan);
      await replyLong(ctx, [formatScan(scan), '', formatPlan(plan)].join('\n'), { parse_mode: 'HTML' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ No pude armar el plan: ${msg}`);
    }
  });
}
