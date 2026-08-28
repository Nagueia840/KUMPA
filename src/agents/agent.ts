import OpenAI from 'openai';
import type { Deps } from '../deps.js';
import {
  KUMPA_SYSTEM_PROMPT,
  MULTITF_INSTRUCTIONS,
  ANALYTIC_INSTRUCTIONS,
  SHORT_ANALYSIS_INSTRUCTIONS,
} from '../config/personality.js';
import { stripReasoning } from '../llm/index.js';
import { executeTool, TOOLS, type ToolName } from './tools.js';
import { buildSynthesisBlock, collectRelationFacts } from './synthesis.js';
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
import { GUARD_REFUSAL_TEXT, guardedFinalize, GUARD_RETRY_PROMPT, buildRetryEditPrompt, type ViolationSummary } from './guarded-reply.js';
import { isLengthTruncation, truncateSafe, ensureCompleteEnding, TRUNCATION_NOTICE } from '../utils/sanitize.js';
import { detectEventIntent, extractEventInfo } from '../events/detect.js';
import { unverifiableEvent, verifyEvent, type EventVerification } from '../events/verify.js';
import { EVENT_INSTRUCTIONS, buildEventClaims, buildEventContext } from '../events/context.js';
import type { MultiTfContext } from '../utils/multitf.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('agent');

type MessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

export const AGENT_INSTRUCTIONS = `
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
- Si una herramienta de datos falla (error en el resultado): NO uses precios ni lecturas de tu memoria de entrenamiento ni de conversaciones anteriores como si fueran datos actuales. Decí que no pudiste actualizar los datos en esta ejecución y ofrecé reintentar si te lo piden ("No pude actualizar los datos en esta ejecución. Si querés, pedime que lo reintente.").
- NO prometas respuestas futuras automáticas ("esperame unos minutos", "te aviso", "lo vuelvo a intentar"): no existe un proceso programado que las envíe. Solo ofrecé que el usuario te lo pida de nuevo.
- Si un dato proviene de una lectura anterior (no actual), indicá SIEMPRE su timestamp y antigüedad, y aclará que NO es el dato actual.
- Respondé SIEMPRE en español (es-AR) LIMPIO: sin caracteres ni palabras en chino/japonés/coreano, sin inglés intercalado innecesario, sin tokens pegados raros ("tendenciaup", "parachirurgical"). Si el proveedor te devuelve texto mezclado, reescribilo en español.
- UNIDADES OBLIGATORIAS en toda cifra de mercado:
  • precios y niveles (SuperTrend, VWAP, soportes/resistencias, cierres, máximos/mínimos) → en la QUOTE del instrumento: 'USDT' para ETHUSDT/BTCUSDT (ej. "2.391 USDT", nunca "2391" pelado, y NUNCA "USD" a menos que el dato diga USD — USDT ≠ USD, no hay paridad asumida). Usá el campo quoteAsset del resultado de la herramienta.
  • funding y premium → en % ("-0,0007%", "funding anualizado -0,77%");
  • open interest → en la unidad que diga el dato (Bitget la expresa en el ACTIVO BASE, ej. "720.800 ETH"). NUNCA inventes la unidad ni digas "contratos"/"BTC equivalent" si el dato dice otra cosa.
  • volumen 24h → en quoteAsset (USDT para ETHUSDT/BTCUSDT): "volumen 24h 2,27B USDT", NUNCA "USD" salvo que el dato diga USD. El volumen cotizado es USDT, no dólares.
  • RSI / ADX / MFI / osciladores → sin unidad monetaria (son índices 0-100).
- USO DE METADATA ESTRUCTURADA (no interpretes por tu cuenta):
  • premiumState del dato ('premium'/'discount'/'flat'/'unknown') ya viene calculado del PREMIUM REAL (mark vs index), NUNCA del signo del funding. USALO tal cual. Si es 'unknown', NO afirmes premium ni discount: decí que no hay datos comparables. El funding NEGATIVO no implica discount: el estado se define por mark vs index, no por el funding.
  • NO uses contango/backwardation para estos contratos: son perpetuos sin vencimiento; el concepto correcto es premium/discount.
  • annualizedFundingPct es una EXTRAPOLACIÓN del funding actual (funding × 24/intervalo × 365): presentala como estimación ("funding anualizado estimado"), NO como rendimiento garantizado ni como basis, y en ESPAÑOL (nunca "annualized"). Si es null/unavailable, decí que el intervalo de funding no está disponible y no lo inventes.
  • superTrend_rol del dato ('soporte'/'resistencia') ya viene derivado: dirección up → el nivel es SOPORTE (banda inferior); down → RESISTENCIA (banda superior). No digas "semanal down en 2459" como si el nivel fuera un precio cualquiera: decí "SuperTrend semanal bajista, resistencia en 2.459 USDT".
  • vela_vs_cierre_previo ('above'/'below'/'mixed') ya viene calculado: SOLO decí "vela entera por encima del cierre anterior" si es 'above' (low > cierre previo). Si es 'below' o 'mixed', no afirmes que la vela está entera arriba.
- Si un dato te parece inconsistente (ej. precio actual menor al cierre anterior), no lo "arregles": citá los valores tal cual vienen.
- Respondé SIEMPRE en español (es-AR), tono argentino, cercano, práctico y analítico.
- Sé conciso: apuntá a 10-15 líneas máximo, salvo que el usuario pida un análisis extenso.
- No inventes datos: si necesitás un dato, usá la herramienta correspondiente.
- Nunca digas "comando": hablás como analista, no como menú.
`;

const MAX_STEPS = 5;
const MAX_TOOL_ROUNDS = 3; // suficientes para consultas multi-activo (BTC+ETH+SOL)
/** Output máximo por llamada al LLM. FASE F.1: 2500 → 4000 para análisis profundo
 *  (el diagnóstico mostró truncamiento con 2500). Se instrumenta finish_reason
 *  para detectar 'length' y recortar la respuesta sin frases rotas. */
const MAX_OUTPUT_TOKENS = 4000;

/**
 * F.3.1.1 — WHITELIST DE FACTS para el retry de edición restringida: SOLO los
 * campos de mercado que una respuesta de análisis cita legítimamente (precio,
 * funding, OI, niveles, RSI). Se excluyen decenas de indicadores secundarios
 * para mantener el retry compacto; el guard final sigue validando TODO número.
 */
const RETRY_FACT_FIELDS = new Set([
  'precio', 'funding_pct', 'funding_anualizado_pct', 'open_interest', 'open_interest_prev',
  'cierre', 'vwap_sesion', 'vwap_semanal', 'superTrend_nivel',
  'pivot_s1', 'pivot_s2', 'pivot_r1', 'pivot_r2', 'rsi',
]);

/** Construye la whitelist compacta de números verificados (para el retry). */
function buildFactsWhitelist(claims: ClaimSet): string {
  const lines: string[] = [];
  for (const c of claims.claims) {
    if (!RETRY_FACT_FIELDS.has(c.field)) continue;
    lines.push(`${c.symbol}${c.timeframe ? `[${c.timeframe}]` : ''} ${c.field}=${c.value}`);
  }
  return lines.join('\n') || '(sin facts verificados)';
}

/** Cuenta los claims de la whitelist (para observabilidad del retry). */
function countFactsWhitelist(claims: ClaimSet): number {
  return claims.claims.filter((c) => RETRY_FACT_FIELDS.has(c.field)).length;
}

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
      ? `\nDATOS REALES YA OBTENIDOS (no vuelvas a llamar herramientas de mercado para los activos con datos válidos; para los inválidos, valido:false, podés intentar get_market_snapshot, pero nunca inventes números):\n${JSON.stringify(preFetched, null, 2)}${validityBlock ? `\n\nVALIDACIÓN DE DATOS:\n${validityBlock}` : ''}\n\nAVISO DE FUENTES (F.2-F + F.3): el JSON crudo es para VERIFICAR/AMPLIAR detalles. NO lo interpretes como narrativa: usa la semántica ya calculada en la LECTURA ESTRUCTURADA (ej. no digas "SuperTrend down" si la síntesis dice bajista/resistencia; no digas "precio bajo 2459" si el precio vivo está por encima). Las RELACIONES de la línea "Relaciones (hechos calculados — no contradecir)" son AUTORITATIVAS: si el hecho dice BELOW (precio debajo del VWAP), NUNCA afirmes "arriba del VWAP", "superó el VWAP" ni "recuperó el VWAP".`
      : '';

  // FASE F — SÍNTESIS ANALÍTICA: lectura estructurada por familias y timeframes,
  // derivada determinísticamente de los indicadores YA calculados. Se inyecta
  // como guía de razonamiento (no reemplaza los números crudos: el guard sigue
  // validando contra los claims).
  const synthesisBlock = hasValidTfData ? buildSynthesisBlock(preFetched) : '';

  const messages: MessageParam[] = [
    {
      role: 'system',
      content:
        KUMPA_SYSTEM_PROMPT +
        '\n\n' +
        AGENT_INSTRUCTIONS +
        (hasValidTfData ? '\n' + MULTITF_INSTRUCTIONS : '') +
        (hasValidTfData ? '\n' + ANALYTIC_INSTRUCTIONS : SHORT_ANALYSIS_INSTRUCTIONS) +
        (synthesisBlock ? '\n\n' + synthesisBlock : '') +
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
            max_tokens: MAX_OUTPUT_TOKENS,
          })
        : await deps.llm.completionsCreate({
            model: deps.llm.settings.model,
            messages,
            tools: TOOLS as Tool[],
            tool_choice: 'none',
            temperature: 0.3,
            max_tokens: MAX_OUTPUT_TOKENS,
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
    // FASE F.1 — INSTRUMENTACIÓN DE TRUNCAMIENTO: finish_reason del proveedor
    // (sin loggear prompts ni contenido sensible; solo la causa de fin).
    const finishReason = (res.choices[0] as { finish_reason?: unknown } | undefined)?.finish_reason;
    if (finishReason !== undefined) {
      console.log(`[agent-stage] chat=${chatId} step=${step} finish_reason=${String(finishReason)}`);
    }

    // Ejecutar herramientas (solo en el primer paso)
    if (allowTools && msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content, tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls) {
        const args = safeParseArgs(tc.function.arguments);
        let result: unknown;
        try {
          result = await executeTool(deps, chatId, tc.function.name as ToolName, args);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log.error(`tool ${tc.function.name} falló:`, errMsg);
          // Indisponibilidad de datos → el LLM debe responder "sin datos actuales",
          // NUNCA inventar ni usar lecturas anteriores como actuales.
          result = { error: `Sin datos de mercado disponibles en esta ejecución (${errMsg})` };
        }
        // GUARD (FASE C): los números devueltos por herramientas también son datos
        // obtenidos (reales) y pasan a formar parte de los claims permitidos.
        const fallbackSymbol = typeof args.symbol === 'string' ? args.symbol : '';
        toolClaims.push(...collectToolResultClaims(result, fallbackSymbol));
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }

    // Respuesta final — GUARD (FASE C + F.2 + F.3): valida los números citados
    // contra los claims permitidos, los contratos semánticos y las RELACIONES
    // numéricas calculadas (NumericFacts); 1 regeneración sin tools; si insiste,
    // negativa segura.
    const text = stripReasoning(msg.content ?? '').trim();
    if (text) {
      const guardClaims = withEventClaims(withToolClaims(claimSet, toolClaims), eventClaims);
      // F.3 — hechos relacionales estructurados (label+valor+relación) que la
      // narración NO puede contradecir ("arriba del VWAP" con hecho BELOW).
      const relationFacts = collectRelationFacts(preFetched);
      const tGuard = Date.now();
      console.log(`[agent-stage] chat=${chatId} stage=guard_start relations=${relationFacts.length}`);
      const guarded = await guardedFinalize(text, guardClaims, async (violations?: ViolationSummary[]) => {
        // F.3.1.1 — retry = EDICIÓN RESTRINGIDA de R1 (no regeneración abierta):
        // payload compacto y autosuficiente en UN mensaje: consulta + R1 +
        // violaciones exactas + whitelist de facts + relations + reglas críticas.
        // NO reenvía system prompt, historial, tool schemas ni dumps de datos
        // (el incidente v13 demostró que el retry anterior llegaba a ~16.7k tokens).
        const retryContent =
          violations && violations.length > 0
            ? buildRetryEditPrompt({
                query: userText,
                r1: text,
                violations,
                factsWhitelist: buildFactsWhitelist(guardClaims),
                relations: relationFacts,
              })
            : GUARD_RETRY_PROMPT;
        // Observabilidad del presupuesto (aproximación 4 chars/token, documentada).
        console.log(`[guard_retry_context] ${JSON.stringify({
          approx_chars: retryContent.length,
          approx_tokens: Math.round(retryContent.length / 4),
          r1_chars: text.length,
          facts_count: countFactsWhitelist(guardClaims),
          relation_facts_count: relationFacts.length,
          violations_count: violations?.length ?? 0,
        })}`);
        const res2 = await deps.llm!.completionsCreate({
          model: deps.llm!.settings.model,
          messages: [{ role: 'user', content: retryContent }],
          temperature: 0.3,
          max_tokens: MAX_OUTPUT_TOKENS,
        }, {
          // Observabilidad: qué proveedor/modelo atendió el retry (sin secretos).
          onProvider: (info) => console.log(`[guard_retry_provider] ${JSON.stringify(info)}`),
        });
        const fin2 = (res2.choices[0] as { finish_reason?: unknown } | undefined)?.finish_reason;
        if (fin2 !== undefined) console.log(`[agent-stage] chat=${chatId} guard_retry finish_reason=${String(fin2)}`);
        return stripReasoning(res2.choices[0]?.message?.content ?? '').trim();
      }, undefined, relationFacts);
      console.log(`[agent-stage] chat=${chatId} stage=guard_done status=${guarded.status} ms=${Date.now() - tGuard}`);
      if (guarded.status === 'ok') {
        // F.1/F.3 — CIERRE DE TEXTO: la respuesta final que llega a Telegram
        // JAMÁS termina en oración rota ("antes de.", "y el timing").
        // 1) finish_reason length → truncateSafe (corta en oración completa + aviso).
        // 2) finish_reason 'stop'/otro con final colgante o a mitad de oración →
        //    ensureCompleteEnding (detección conservadora de final incompleto).
        // 3) Telegram nunca parte palabras (chunkText). Instrumentación mínima:
        //    PROVIDER_TRUNCATION | OTHER | TELEGRAM_SPLIT_TRUNCATION.
        if (isLengthTruncation(finishReason)) {
          console.log(`[agent-stage] chat=${chatId} trunc_source=PROVIDER_TRUNCATION finish_reason=${String(finishReason)} (max_tokens=${MAX_OUTPUT_TOKENS})`);
          const safe = truncateSafe(guarded.text);
          return safe.endsWith(TRUNCATION_NOTICE) ? safe : safe + TRUNCATION_NOTICE;
        }
        const closed = ensureCompleteEnding(guarded.text);
        if (closed !== guarded.text) {
          console.log(`[agent-stage] chat=${chatId} trunc_source=OTHER final_incompleto_detectado (finish_reason=${String(finishReason ?? 'n/d')})`);
        }
        return closed;
      }
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
