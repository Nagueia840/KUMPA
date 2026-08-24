# Kumpa 🤖📈

**Kumpa** es un research partner de inversiones que se comunica por **Telegram**.
Especialista en **cripto** (futuros perpetuos, funding rates, basis trading, cobertura
delta-neutral, arbitraje CEX/DEX) y con visión **macro/equities**.

> **Rol**: Kumpa analiza, sugiere, alerta y aprende, pero **nunca ejecuta órdenes**
> ni da consejo financiero vinculante. El usuario decide y opera.

---

## ✨ Características

- 💬 **Telegram-first** (framework `grammY`).
- 🧠 **Memoria persistente** en Supabase: relacional + **semántica (pgvector + embeddings)**.
- 🔍 **6 fuentes gratuitas + Bitget API**: Binance, Bybit, CoinGecko, DefiLlama, Yahoo Finance + Bitget (funding/OI/candles/orderbook).
- 🤖 **LLM intercambiable** (Groq, DeepSeek, OpenRouter, custom) vía `app_settings` en Supabase o `.env`.
- 🇦🇷 **Personalidad argentina**, profesional, cercana, práctica y analítica.
- ⏰ **Autonomía**: alertas persistentes + loop de revisión (scheduler).

---

## 🏗️ Arquitectura

```
src/
├── bot/            # Telegram: comandos y middlewares
│   └── commands/   # /start /help /scan /mañana /plan /thesis /review /alerta /recordar
├── config/         # env (Zod), constants, personality, settings (Supabase)
├── llm/            # cliente LLM + embeddings (OpenAI-compatible)
├── data/           # conectores: bitget, market, onchain, equities, snapshot, briefing
├── agents/         # analista (LLM→JSON), alertas (parse/check)
├── memory/         # MemoryStore (Supabase + pgvector + fallback)
├── scheduler/      # loop de alertas (en proceso; BullMQ en prod opcional)
├── api/            # webhook entry (Vercel)
└── singleton.ts    # bot lazy para serverless
supabase/migrations/ # 001 esquema · 002 data_points · 003 pgvector
```

---

## 🚀 Setup local

### 1. Prerrequisitos
- **Node >= 20.12**
- Cuenta de **Supabase** (memoria) — opcional para arrancar en modo datos.
- Un bot de Telegram (hablá con [@BotFather](https://t.me/BotFather)).

### 2. Instalar

```bash
npm install
cp .env.example .env
```

### 3. Configurar `.env`

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Token de BotFather |
| `LLM_API_KEY` | análisis | Groq/DeepSeek/OpenRouter (según `LLM_PROVIDER`) |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | memoria | Proyecto Supabase |
| `EMBEDDING_API_KEY` | semántica | OpenAI (o compatible) para embeddings |
| `BITGET_API_KEY/SECRET/PASSPHRASE` | opcional | Datos de Bitget (solo lectura) |
| `ALLOWED_USER_IDS` | opcional | CSV de user_id autorizados (vacío = todos) |

### 4. Migraciones Supabase

Ejecutá en orden en el SQL editor (o `supabase db push`):
1. `001_initial_schema.sql`
2. `002_insights_data_points.sql`
3. `003_pgvector.sql` (habilitá la extensión `vector` antes)

### 5. Correr

```bash
npm run dev      # polling (desarrollo)
npm run typecheck
npm test         # vitest
```

---

## 🤖 Comandos

| Comando | Qué hace |
|---------|----------|
| `/start` | Saludo e intro |
| `/help` | Lista de comandos |
| `/scan <T>` | Análisis profundo (funding, OI, basis, spread cross-exchange) |
| `/mañana` | Briefing matutino (watchlist + stablecoins + global) |
| `/plan <T> <setup>` | Plan de operación (entrada/SL/TP/tamaño/risk-reward) |
| `/thesis <idea>` | Red team: desafía tu tesis con datos contrarios |
| `/review <qué pasó>` | Post-mortem → guarda la lección |
| `/alerta <condición>` | Alerta persistente (`funding BTC > 0.05`, `precio BTC > 80000`) |
| `/recordar <tema>` | Busca en la memoria semántica insights/lecciones |

---

## 📡 Fuentes de datos

| Fuente | Datos | Key |
|--------|-------|-----|
| Bitget | funding, OI, candles, orderbook (mix) | opcional |
| Binance Futures | funding, OI, premium index | no |
| Bybit | funding, OI, ticker | no |
| CoinGecko | market cap, dominance, precios | no |
| DefiLlama | TVL, stablecoins | no |
| Yahoo Finance | equities/índices (AAPL, ^GSPC) | no |

---

## 🧠 Memoria

- **Relacional**: conversaciones, insights, trade plans, learnings, alertas.
- **Semántica**: pgvector + embeddings (`text-embedding-3-small` por defecto).
  - `/scan` y `/review` guardan embeddings automáticamente.
  - `/recordar` busca por similitud coseno (con fallback a keyword si no hay embeddings).

---

## ☁️ Deploy (Vercel + Supabase)

1. Pusheá el repo a GitHub y conectá Vercel.
2. Configurá las env vars en Vercel (mismas que `.env`).
3. `api/webhook.ts` es el entry point (runtime Node).
4. Seteá el webhook:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<tu-app>.vercel.app/api/webhook
   ```
5. **Scheduler en producción**: el loop en proceso no corre en serverless. Usá
   [Vercel Cron](https://vercel.com/docs/cron) o Supabase `pg_cron` para disparar
   `/mañana` y el chequeo de alertas cada N minutos.

---

## 🧪 Testing

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest (parseJSON, firma Bitget, alertas, snapshot, embeddings)
```

---

## ⚠️ Disclaimer

Kumpa no es asesor financiero. Todo análisis es informativo. El trading de derivados
y cripto conlleva alto riesgo. Consultá a un profesional matriculado para temas
legales/fiscales (CNV, BCRA, AFIP).
