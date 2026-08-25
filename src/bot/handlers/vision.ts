import type { Bot } from 'grammy';
import type { Deps } from '../../deps.js';
import { loadEnv } from '../../config/env.js';
import { stripReasoning } from '../../llm/index.js';

/**
 * Visión: recibe fotos de Telegram y las interpreta con un modelo multimodal
 * (OpenRouter free). Prueba de la foto más grande a la más chica por si
 * el proveedor rechaza imágenes grandes, y fuerza mime JPEG.
 */
export function registerVision(bot: Bot, deps: Deps): void {
  bot.on('message:photo', async (ctx) => {
    if (!deps.vision) {
      await ctx.reply(
        'Todavía no tengo visión configurada (falta VISION_API_KEY). Pero puedo buscar en internet: probá "buscá ..." o "qué clima hace en ...".',
      );
      return;
    }

    const photos = ctx.message.photo ?? [];
    const caption = ctx.message.caption?.trim() ?? '';
    if (photos.length === 0) return;

    await ctx.replyWithChatAction('typing');
    await ctx.reply('🔍 Mirando la imagen…');

    const prompt = caption
      ? `El usuario dice: "${caption}". Identificá y describí lo que hay en la imagen (objeto, pieza, componente, aparato) y respondé a su pedido.`
      : 'Identificá y describí lo que hay en la imagen (objeto, pieza, componente, aparato). Si podés, mencioná características técnicas o para qué sirve.';

    // De la más grande a la más chica (hasta 3 tamaños)
    const sorted = [...photos].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0));
    let lastError: unknown;

    for (const photo of sorted.slice(0, 3)) {
      try {
        const file = await ctx.api.getFile(photo.file_id);
        if (!file.file_path) continue;
        const url = `https://api.telegram.org/file/bot${loadEnv().TELEGRAM_BOT_TOKEN}/${file.file_path}`;

        const imgRes = await fetch(url);
        if (!imgRes.ok) continue;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        // Forzar mime JPEG (las fotos de Telegram son JPEG)
        const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`;

        const reply = stripReasoning(await deps.vision.describe(dataUri, prompt));
        await ctx.reply(reply);
        return;
      } catch (err) {
        lastError = err;
      }
    }

    await ctx.reply(
      `⚠️ No pude procesar la imagen (${lastError instanceof Error ? lastError.message : lastError}). Probá mandar una foto más chica o con menos resolución.`,
    );
  });
}
