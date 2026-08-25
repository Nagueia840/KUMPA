import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { buildAggregatedScan } from '../../data/snapshot.js';
import { analyzeScan } from '../../agents/analyst.js';
import { formatInsight, formatScan } from '../../utils/format.js';
import { replyLong } from '../../utils/telegram.js';

export function registerScan(bot: Bot, deps: Deps): void {
  bot.command('scan', async (ctx) => {
    const symbol = (ctx.match ?? '').trim().toUpperCase() || 'BTC';
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    await ctx.reply(`🔍 Analizando ${symbol} en vivo (Binance + Bybit + CoinGecko)…`);

    try {
      const scan = await buildAggregatedScan(symbol, deps);
      await deps.memory.saveConversation(chatId, 'user', `/scan ${symbol}`);

      if (deps.llm) {
        const insight = await analyzeScan(deps.llm, scan);
        await deps.memory.saveConversation(chatId, 'assistant', insight.summary);
        await deps.memory.saveInsight(chatId, insight);
        await replyLong(ctx, [formatScan(scan), '', formatInsight(insight)].join('\n'), {
          parse_mode: 'HTML',
        });
      } else {
        await ctx.reply(
          [
            formatScan(scan),
            '',
            '⚠️ No hay LLM configurado: agregá LLM_API_KEY (.env o app_settings) para el análisis interpretativo.',
          ].join('\n'),
          { parse_mode: 'HTML' },
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.reply(`⚠️ No pude analizar ${symbol}: ${msg}`);
    }
  });
}
