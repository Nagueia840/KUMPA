import OpenAI from 'openai';
import type { Deps } from '../deps.js';
import { KUMPA_SYSTEM_PROMPT, MULTITF_INSTRUCTIONS } from '../config/personality.js';
import { stripReasoning } from '../llm/index.js';
import { executeTool, TOOLS, type ToolName } from './tools.js';
import { extractAllTickers } from '../utils/tickers.js';
import { resolveTimeframes } from '../utils/intent.js';
import { fetchMultiTfData } from './fetch-multitf.js';
import {
  buildAllowedClaims,
  buildValidityBlock,
  collectToolResultClaims,
  withEventClaims,
  withToolClaims,
  type ClaimSet,
  type MarketClaim,
} from './claims.js';
import { GUARD_REFUSAL_TEXT, guardedFinalize, GUARD_RETRY_PROMPT } from './guarded-reply.js';
import { detectEventIntent, extractEventInfo } from '../events/detect.js';
import { unverifiableEvent, verifyEvent, type EventVerification } from '../events/verify.js';
import { EVENT_INSTRUCTIONS, buildEventClaims, buildEventContext } from '../events/context.js';
import type { MultiTfContext } from '../utils/multitf.js';
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
- REGLA DE ORO: para PRECIO, funding, open interest, basis o cualquier dato de mercado de un activo, es OBLIGATORIO usar get_market_snapshot (o get_price). NUNCA respondas datos de mercado desde tu memoria de entrenamiento: pueden estar viejos y es humo.
- Si el usuario pide datos o análisis de un activo, usá get_market_snapshot y después respondé en lenguaje natural, integrando los números en la conversación. Sin estructuras ni etiquetas formales (nada de "HECHOS:", "JUICIOS:", "ACCIÓN:").
- Si pide una alerta (ej "avisame si BTC supera 80000"), usá set_price_alert y confirmale en criollo.
- Si pregunta por TVL, stablecoins o el mercado en general, usá get_onchain_data.
- Si solo pide un precio rápido, usá get_price.
- Si pide VWAP, medias móviles, RSI o análisis técnico de un activo, usá get_technical_indicators (calculados desde velas de Bitget).
- Si el usuario menciona VARIOS activos en un mismo mensaje (ej "BTC y ETH" o preguntas separadas), usá la herramienta correspondiente para CADA uno antes de responder. Nunca respondas de memoria un activo que no consultaste.
- Los datos pre-cargados están etiquetados por SÍMBOLO (BTC/ETH/SOL). NO mezcles los números de un activo con otro: cada campo pertenece al símbolo que lo contiene.
- Usá los valores pre-cargados TAL CUAL: no inventes, no modifiques ni "escules" los números. Si un dato no está, decilo en vez de estimarlo.
- Si el usuario menciona un término que no reconocés pero suena a un indicador (VWAP, RSI, MACD, ADX...), probablemente es una transcripción de voz imperfecta: tratálo como el indicador real y usá los datos pre-cargados.
- Si pide buscar algo en internet (especificaciones técnicas de un aparato o componente, identificación de objetos, noticias, cualquier cosa), usá web_search.
- Si pide el clima de una ciudad, usá get_weather.
- Si no hace falta ninguna herramienta (saludo, charla), respondé directo.
- Usá las herramientas UNA sola vez y después respondé. No repitas la misma herramienta.
- Respondé SIEMPRE en español (es-AR), tono argentino, cercano, práctico y analítico.
- Sé conciso: apuntá a 10-15 líneas máximo, salvo que el usuario pida un análisis extenso.
- No inventes datos: si necesitás un dato, usá la herramienta correspondiente.
- Nunca digas "comando": hablás como analista, no como menú.
`;

const MAX_STEPS = 5;
const MAX_TOOL_ROUNDS = 3; // suficientes para consultas multi-activo (BTC+ETH+SOL)

/** Timeout de verificación de eventos (Exa). Bitget ya tiene el suyo en fetch-multitf.
 *  Exa suele responder <1s; 4s es tope razonable dentro del presupuesto de 10s de Hobby. */
const EVENT_TIMEOUT_MS = 4000;

/** Procesa un mensaje conversacional con function calling. */
export async function handleMessage(deps: Deps, chatId: number, userText: string): Promise<string> {
  const t0 = Date.now();
  if (!deps.llm) {
    return 'Perdón, todavía no tengo el LLM configurado.';
  }

  // Memoria de contexto: últimas conversaciones (si hay Supabase, persiste)
  const history = await deps.memory.getRecentConversations(chatId, 6);
  console.log(`[agent-stage] chat=${chatId} stage=history_done ms=${Date.now() - t0}`);

  // PRE-FETCH MULTITEMPORAL (Fase B): datos reales por timeframe para TODOS los
  // tickers mencionados. Se saltea en pedidos de alerta (lo resuelve set_*_alert).
  const isAlertRequest = /avis|alerta|cuando (supere|baje|toque|rompa)|cuando.*(sub|baj)/i.test(userText);
  const tickers = isAlertRequest ? [] : extractAllTickers(userText);

  // TF explícitos del usuario o política por intención. El usuario manda:
  // si pide 15m y 15m falla, NO se sustituye por otro marco (regla Fase B).
  const timeframes = tickers.length > 0 ? resolveTimeframes(userText) : [];

  // EVENTO (FASE D): detección determinista; si hay evento, la verificación Exa
  // corre EN PARALELO con el fetch de mercado (nunca en serie).
  const eventIntent = detectEventIntent(userText);
  const eventInfo = eventIntent ? extractEventInfo(userText) : null;
  const eventPromise: Promise<EventVerification | null> = eventInfo
    ? deps.exa
      ? verifyEvent(deps.exa, eventInfo, { timeoutMs: EVENT_TIMEOUT_MS })
      : Promise.resolve(unverifiableEvent(eventInfo, 'sin EXA_API_KEY'))
    : Promise.resolve(null);

  const tFetch = Date.now();
  const [preFetched, eventVerification] = await Promise.all([
    tickers.length > 0 && timeframes.length > 0
      ? fetchMultiTfData(deps, tickers, timeframes)
      : Promise.resolve<MultiTfContext>({}),
    eventPromise,
  ]);
  console.log(`[agent-stage] chat=${chatId} stage=market_fetch_done ms=${Date.now() - tFetch}`);

  // Las reglas multitemporal solo se activan si hay al menos un TF con datos válidos.
  const hasValidTfData = Object.values(preFetched).some(
    (s) => s?.valido === true && s?.timeframes && Object.keys(s.timeframes).length > 0,
  );

  // GUARD (FASE C + D): registro de números permitidos + bloque de validez pre-LLM.
  // Los TF/símbolos sin datos quedan explícitos: el modelo nunca los trata como disponibles.
  const claimSet: ClaimSet = buildAllowedClaims(preFetched);
  const eventClaims = eventVerification ? buildEventClaims(eventVerification) : [];
  const validityBlock = Object.keys(preFetched).length > 0 ? buildValidityBlock(preFetched) : '';
  const toolClaims: MarketClaim[] = [];

  const eventSection = eventVerification
    ? `\n\n${buildEventContext(eventVerification)}\n${EVENT_INSTRUCTIONS}`
    : '';

  const contextBlock =
    Object.keys(preFetched).length > 0
      ? `\nDATOS REALES YA OBTENIDOS (no vuelvas a llamar herramientas de mercado para los activos con datos válidos; para los inválidos, valido:false, podés intentar get_market_snapshot, pero nunca inventes números):\n${JSON.stringify(preFetched, null, 2)}${validityBlock ? `\n\nVALIDACIÓN DE DATOS:\n${validityBlock}` : ''}`
      : '';

  const messages: MessageParam[] = [
    {
      role: 'system',
      content:
        KUMPA_SYSTEM_PROMPT +
        '\n\n' +
        AGENT_INSTRUCTIONS +
        (hasValidTfData ? '\n' + MULTITF_INSTRUCTIONS : '') +
        contextBlock +
        eventSection,
    },
    ...history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user', content: userText },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    // Herramientas disponibles en las primeras rondas; después se fuerza texto.
    const allowTools = step < MAX_TOOL_ROUNDS;

    let res;
    const tLlm = Date.now();
    console.log(`[agent-stage] chat=${chatId} stage=llm_start step=${step} tools=${allowTools}`);
    try {
      res = allowTools
        ? await deps.llm.completionsCreate({
            model: deps.llm.settings.model,
            messages,
            tools: TOOLS as Tool[],
            // 'auto': el modelo usa herramientas para lo que no está pre-feteado
            tool_choice: 'auto',
            temperature: 0.3,
            max_tokens: 2500,
          })
        : await deps.llm.completionsCreate({
            model: deps.llm.settings.model,
            messages,
            tools: TOOLS as Tool[],
            tool_choice: 'none',
            temperature: 0.3,
            max_tokens: 2500,
          });
    } catch (err) {
      console.warn(`[agent-stage] chat=${chatId} stage=llm_error step=${step} ms=${Date.now() - tLlm}: ${err instanceof Error ? err.message : String(err)}`);
      // Defensa (bug detectado en auditoría final): si el modelo emite argumentos
      // de tool inválidos (400 de validación de la API, ej web_search sin query)
      // o insiste en llamar tools con tool_choice 'none', se le pide corregir y
      // se reintenta (acotado por MAX_STEPS) en vez de crashear el mensaje.
      const errMsg = err instanceof Error ? err.message : String(err);
      if (/tool/i.test(errMsg) && step < MAX_STEPS - 1) {
        messages.push({
          role: 'user',
          content: allowTools
            ? 'Llamaste una herramienta con argumentos inválidos. Llamala de nuevo con los parámetros correctos, o respondé con texto si no hace falta.'
            : 'Respondé ahora con texto únicamente, sin llamar herramientas.',
        });
        continue;
      }
      throw err;
    }
    console.log(`[agent-stage] chat=${chatId} stage=llm_done step=${step} ms=${Date.now() - tLlm}`);

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
        // GUARD (FASE C): los números devueltos por herramientas también son datos
        // obtenidos (reales) y pasan a formar parte de los claims permitidos.
        const fallbackSymbol = typeof args.symbol === 'string' ? args.symbol : '';
        toolClaims.push(...collectToolResultClaims(result, fallbackSymbol));
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }

    // Respuesta final — GUARD (FASE C): valida los números citados contra los
    // claims permitidos; 1 regeneración sin tools; si insiste, negativa segura.
    const text = stripReasoning(msg.content ?? '').trim();
    if (text) {
      const guardClaims = withEventClaims(withToolClaims(claimSet, toolClaims), eventClaims);
      const tGuard = Date.now();
      console.log(`[agent-stage] chat=${chatId} stage=guard_start`);
      const guarded = await guardedFinalize(text, guardClaims, async () => {
        const res2 = await deps.llm!.completionsCreate({
          model: deps.llm!.settings.model,
          messages: [...messages, { role: 'user', content: GUARD_RETRY_PROMPT }],
          tools: TOOLS as Tool[],
          tool_choice: 'none',
          temperature: 0.3,
          max_tokens: 2500,
        });
        return stripReasoning(res2.choices[0]?.message?.content ?? '').trim();
      });
      console.log(`[agent-stage] chat=${chatId} stage=guard_done status=${guarded.status} ms=${Date.now() - tGuard}`);
      if (guarded.status === 'ok') return guarded.text;
      console.warn(`[guard] respuesta bloqueada: ${guarded.reason}`);
      return GUARD_REFUSAL_TEXT;
    }

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
