import type { Bot } from 'grammy';

export function registerStart(bot: Bot): void {
  bot.command('start', async (ctx) => {
    await ctx.reply(
      [
        '👋 ¡Buenas! Soy <b>Kumpa</b>, tu research partner de inversiones.',
        '',
        'Te acompaño con análisis de cripto (funding, open interest, on-chain), macro y equities. Te sugiero, pero <b>vos decidís y operás</b>.',
        '',
        'Para ver qué sé hacer, mandá /help.',
        '',
        '¿Arrancamos con un ticker? Probá /scan BTC.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });
}
