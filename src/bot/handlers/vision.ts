import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { loadEnv } from '../../config/env.js';
import { stripReasoning } from '../../llm/index.js';

/**
 * Visión: recibe fotos de Telegram y las interpreta con un modelo multimodal
 * (requiere VISION_API_KEY de OpenRouter/Gemini/OpenAI). Groq no tiene visión.
 */
export function registerVision(bot: Bot, deps: Deps): void {
  bot.on('message:photo', async (ctx) => {
    if (!deps.vision) {
      await ctx.reply(
        'Todavía no tengo visión configurada (falta VISION_API_KEY). Pero puedo buscar en internet: probá "buscá ..." o "qué clima hace en ...".',
      );
      return;
    }

    const photos = ctx.message.photo;
    const photo = photos?.[photos.length - 1]; // la de mayor resolución
    const caption = ctx.message.caption?.trim() ?? '';
    if (!photo) return;

    await ctx.replyWithChatAction('typing');
    await ctx.reply('🔍 Mirando la imagen…');

    try {
      const file = await ctx.api.getFile(photo.file_id);
      if (!file.file_path) throw new Error('No se pudo obtener el archivo');
      const url = `https://api.telegram.org/file/bot${loadEnv().TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      const prompt = caption
        ? `El usuario dice: "${caption}". Identificá y describí lo que hay en la imagen (objeto, pieza, componente, aparato) y respondé a su pedido.`
        : 'Identificá y describí lo que hay en la imagen (objeto, pieza, componente, aparato). Si podés, mencioná características técnicas o para qué sirve.';

      const reply = stripReasoning(await deps.vision.describe(url, prompt));
      await ctx.reply(reply);
    } catch (err) {
      await ctx.reply(`⚠️ No pude procesar la imagen: ${err instanceof Error ? err.message : err}`);
    }
  });
}
