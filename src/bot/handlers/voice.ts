import type { Bot, Context } from 'grammy';
import type { Deps } from '../../deps.js';
import { loadEnv } from '../../config/env.js';
import { handleMessage } from '../../agents/agent.js';
import { replyLong } from '../../utils/telegram.js';
import { normalizeTranscript } from '../../utils/transcript.js';

/**
 * Voz: transcribe mensajes de audio/notas de voz con Whisper (Groq)
 * y responde como agente (escribiendo), como GetClaw.
 */
export function registerVoice(bot: Bot, deps: Deps): void {
  const handler = async (ctx: Context): Promise<void> => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    if (!deps.llm) {
      await ctx.reply('Todavía no tengo el LLM configurado.');
      return;
    }

    await ctx.replyWithChatAction('typing');
    await ctx.reply('🎤 Escuchando…');

    try {
      const msg = ctx.message as { voice?: { file_id: string }; audio?: { file_id: string } } | undefined;
      const fileId = msg?.voice?.file_id ?? msg?.audio?.file_id;
      if (!fileId) return;

      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error('Sin archivo');
      const url = `https://api.telegram.org/file/bot${loadEnv().TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      // Descargar + transcribir con reintento (red transitoria: "fetch failed")
      let text = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const audioRes = await fetch(url);
          if (!audioRes.ok) throw new Error('HTTP ' + audioRes.status);
          const blob = new Blob([await audioRes.arrayBuffer()], { type: 'audio/ogg' });
          const fileObj = new File([blob], 'voice.ogg', { type: 'audio/ogg' });
          text = normalizeTranscript(await deps.llm.transcribeAudio(fileObj, loadEnv().WHISPER_MODEL));
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      if (!text.trim()) {
        await ctx.reply('No entendí nada del audio 😅. ¿Podés repetirlo o escribirme?');
        return;
      }

      const reply = await handleMessage(deps, chatId, text.trim());
      if (reply) {
        await deps.memory.saveConversation(chatId, 'user', text.trim());
        await deps.memory.saveConversation(chatId, 'assistant', reply);
        await replyLong(ctx, reply);
      }
    } catch (err) {
      await ctx.reply(`⚠️ No pude procesar el audio: ${err instanceof Error ? err.message : err}`);
    }
  };

  bot.on('message:voice', handler);
  bot.on('message:audio', handler);
}
