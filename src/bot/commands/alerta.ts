import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { parseAlert } from '../../agents/alerts.js';
import type { AlertRule } from '../../types/index.js';

export function registerAlerta(bot: Bot, deps: Deps): void {
  bot.command('alerta', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const input = (ctx.match ?? '').trim();
    const parsed = parseAlert(input);

    if (!parsed) {
      await ctx.reply(
        [
          'Usá:',
          '• /alerta funding BTC &gt; 0.05   (funding en %, 0.05 = 0.05%)',
          '• /alerta funding BTC &lt; 0.01',
          '• /alerta precio BTC &gt; 80000   (USD)',
          '• /alerta precio BTC &lt; 75000',
        ].join('\n'),
        { parse_mode: 'HTML' },
      );
      return;
    }

    const rule: AlertRule = {
      chatId,
      type: parsed.type,
      symbol: parsed.symbol,
      threshold: parsed.threshold,
      active: true,
      createdAt: Date.now(),
    };

    await deps.memory.saveAlert(rule);

    const desc = parsed.type.startsWith('funding')
      ? `${parsed.type.replace('_', ' ')} ${parsed.symbol} ${(parsed.threshold * 100).toFixed(4)}%`
      : `${parsed.type.replace('_', ' ')} ${parsed.symbol} $${parsed.threshold.toLocaleString('en-US')}`;

    await ctx.reply(`✅ Alerta seteada: <b>${desc}</b>. Te aviso cuando se cumpla.`, {
      parse_mode: 'HTML',
    });
  });
}
