import OpenAI from 'openai';
import type { Deps } from '../deps.js';
import { KUMPA_SYSTEM_PROMPT } from '../config/personality.js';
import { stripReasoning } from '../llm/index.js';
import { executeTool, TOOLS, type ToolName } from './tools.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent');

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const AGENT_INSTRUCTIONS = `
Sos un agente conversacional con acceso a herramientas. Podés:
- Consultar datos de mercado de un activo (precio, funding, open interest, basis).
- Crear alertas de precio o de funding.
- Consultar datos on-chain/DeFi (TVL, stablecoins) y el panorama global.

REGLAS:
- Si el usuario pide datos o análisis de un activo, usá get_market_snapshot y después respondé en lenguaje natural con lo más relevante (separá hechos de interpretación).
- Si pide una alerta (ej "avisame si BTC supera 80000"), usá set_price_alert y confirmale en criollo.
- Si pregunta por TVL, stablecoins o el mercado en general, usá get_onchain_data.
- Si solo pide un precio rápido, usá get_price.
- Si no hace falta ninguna herramienta (saludo, charla), respondé directo.
- Usá las herramientas UNA sola vez y después respondé. No repitas la misma herramienta.
- Respondé SIEMPRE en español (es-AR), tono argentino, cercano, práctico y analítico.
- No inventes datos: si necesitás un dato, usá la herramienta correspondiente.
- Nunca digas "comando": hablás como analista, no como menú.
`;

const MAX_STEPS = 5;

/** Procesa un mensaje conversacional con function calling. */
export async function handleMessage(deps: Deps, chatId: number, userText: string): Promise<string> {
  if (!deps.llm) {
    return 'Perdón, todavía no tengo el LLM configurado.';
  }

  // Memoria de contexto: últimas conversaciones (si hay Supabase, persiste)
  const history = await deps.memory.getRecentConversations(chatId, 8);

  const messages: MessageParam[] = [
    { role: 'system', content: KUMPA_SYSTEM_PROMPT + '\n\n' + AGENT_INSTRUCTIONS },
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user', content: userText },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    // Las herramientas se ofrecen solo en el primer paso; después se fuerza texto.
    const allowTools = step === 0;

    const res = allowTools
      ? await deps.llm.client.chat.completions.create({
          model: deps.llm.settings.model,
          messages,
          tools: TOOLS as Tool[],
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 2500,
        })
      : await deps.llm.client.chat.completions.create({
          model: deps.llm.settings.model,
          messages,
          temperature: 0.3,
          max_tokens: 2500,
        });

    const msg = res.choices[0]?.message;
    if (!msg) return 'No pude procesar tu mensaje.';

    // Ejecutar herramientas (solo en el primer paso)
    if (allowTools && msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls) {
        const args = safeParseArgs(tc.function.arguments);
        let result: unknown;
        try {
          result = await executeTool(deps, chatId, tc.function.name as ToolName, args);
        } catch (err) {
          log.error(`tool ${tc.function.name} falló:`, err instanceof Error ? err.message : err);
          result = { error: 'Falló la herramienta' };
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }

    // Respuesta final
    const text = stripReasoning(msg.content ?? '').trim();
    if (text) return text;

    // El modelo devolvió vacío: le pedimos que responda (una vez más, sin herramientas)
    if (step < MAX_STEPS - 1) {
      messages.push({
        role: 'user',
        content: 'Respondé ahora en lenguaje natural con tu análisis, sin llamar herramientas.',
      });
      continue;
    }
    return 'Ahí tenés los datos. ¿Querés que profundice en algo?';
  }

  return 'Me enredé procesando esto. Probá de nuevo más simple.';
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
