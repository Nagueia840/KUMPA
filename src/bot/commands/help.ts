import type { Bot } from 'grammy';

const HELP_TEXT = [
  '📋 <b>Comandos de Kumpa</b>',
  '',
  '/mañana — briefing matutino: funding, OI, on-chain, macro y earnings.',
  '/scan &lt;TICKER&gt; — análisis profundo de un activo.',
  '/alerta &lt;condición&gt; — setear una alerta persistente.',
  '/plan &lt;setup&gt; — te devuelvo entrada, SL, TP y tamaño sugerido.',
  '/review &lt;ticker/fecha&gt; — post-mortem de una operación.',
  '/thesis &lt;idea&gt; — te la desafío con datos contrarios (red team).',
  '',
  '⚠️ Kumpa no ejecuta órdenes ni da consejo financiero vinculante.',
].join('\n');

export function registerHelp(bot: Bot): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
  });
}
