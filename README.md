# Kumpa 🤖📈

**Kumpa** es un agente IA de investigación de inversiones que se comunica por **Telegram**.
Especialista en **cripto** (futuros perpetuos, funding rates, basis trading, cobertura
delta-neutral, arbitraje CEX/DEX) y con visión **macro/equities**.

> **Rol**: Research partner. Kumpa analiza, sugiere y aprende, pero **nunca ejecuta órdenes**
> ni da consejo financiero vinculante. El usuario decide y opera.

---

## 🎯 Características

- 💬 **Telegram-first** (framework `grammY`).
- 🧠 **Memoria persistente** en Supabase (vector + relacional).
- 🔍 **Fuentes gratuitas + Bitget API** (datos de mercado, no trading):
  funding, open interest, flujos on-chain, earnings, macro.
- 🤖 **LLM intercambiable** (Groq, DeepSeek, OpenRouter, custom) vía
  `app_settings` en Supabase o `.env` — sin tocar código.
- 🇦🇷 **Personalidad argentina**, profesional, cercana, práctica y analítica.

---

## 🚀 Quick start

```bash
npm install
cp .env.example .env   # completá TELEGRAM_BOT_TOKEN (y LLM_API_KEY + SUPABASE_*)
npm run dev
```

Requiere **Node >= 20.12**.

---

## 📁 Estructura

```
src/
├── bot/            # Telegram: comandos y middlewares
├── config/         # env (Zod), constants, personality, settings (Supabase)
├── llm/            # cliente OpenAI-compatible (Groq/DeepSeek/free)
├── types/          # tipos de dominio compartidos
├── utils/          # logger
└── index.ts        # entry point (polling en desarrollo)
supabase/
└── migrations/     # esquema SQL (settings, conversaciones, insights, alertas, learnings)
```

---

## 🔑 Variables de entorno

Ver [.env.example](./.env.example). Las claves de LLM pueden ir en `.env` **o**
en la tabla `app_settings` de Supabase (permite cambiarlas sin redeploy).

---

## ⚠️ Disclaimer

Kumpa no es asesor financiero. Todo análisis es informativo. El trading de
derivados y cripto conlleva alto riesgo. Consultá a un profesional matriculado
para temas legales/fiscales (CNV, BCRA, AFIP).
