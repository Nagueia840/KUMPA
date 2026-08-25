---
name: busqueda-para-agentes
description: "Skill de búsqueda web para agentes de IA usando la API de Exa (exa.ai): búsqueda semántica, extracción de contenido y mejores prácticas oficiales. Úsala cuando el agente necesite información de internet (noticias, specs técnicas, identificación de objetos, clima, etc.)."
metadata:
  author: Kumpa (basado en el skill oficial exa-labs/agent-skills build-with-exa)
  version: "1.0.0"
  docs: "https://exa.ai/docs"
---

# Búsqueda para agentes (Exa)

Skill que documenta cómo darle a un agente de IA la capacidad de **buscar en internet** usando la API de **Exa** (exa.ai), siguiendo las mejores prácticas oficiales.

## ¿Cuándo usarla?

- El usuario pide información que **no es de mercado/cripto**: noticias, especificaciones técnicas de un aparato o componente, identificación de objetos, clima, datos generales.
- El agente necesita contexto de internet para responder bien.
- En Kumpa esto se dispara solo: el agente detecta la intención y usa la herramienta `web_search`.

## Herramientas del agente (Kumpa)

| Herramienta | Descripción |
|-------------|-------------|
| `web_search(query)` | Busca en internet con Exa → devuelve títulos, URLs y extractos (highlights). |
| `get_weather(place)` | Clima actual de una ciudad (Open-Meteo, sin key). |

## Endpoints de Exa

- `POST https://api.exa.ai/search` — búsqueda semántica (la principal).
- `POST https://api.exa.ai/contents` — extracción de contenido limpio desde URLs conocidas.
- Auth: header `x-api-key` **o** `Authorization: Bearer <key>`.

## Request recomendado (oficial de Exa)

```json
{
  "query": "latest developments in LLMs",
  "type": "auto",
  "contents": { "highlights": true }
}
```

## Mejores prácticas (del skill oficial "build-with-exa")

- ✅ Usar `highlights: true` (extractos token-eficientes). No usar `text` ni `summary` salvo necesidad.
- ✅ No apilar `text` + `highlights` + `summary` — elegir UNO.
- ✅ No sobre-especificar params (`category`, `includeDomains`, `maxAgeHours`, `numResults`) salvo que el usuario lo pida explícitamente.
- ✅ `numResults` por defecto 10; en Kumpa usamos 5 para ahorrar tokens.
- ✅ Para "noticias recientes", expresar el rango en la query o con `startPublishedDate`/`endPublishedDate` (no usar `maxAgeHours`, que es de freshness de crawl).
- ⚠️ En `/search`, `text`/`highlights`/`summary` van DENTRO de `contents`. En `/contents`, van a nivel raíz.
- ⚠️ No inventar categorías (`github`, `documentation`, `qa`, `pdf`). Solo `people` y `company` son especiales.

## Integración en Kumpa

- Cliente: `src/data/web/exa.ts`
- Tool del agente: `web_search` en `src/agents/tools.ts`
- Key: `EXA_API_KEY` en `.env` (gratis en https://exa.ai)
- Referencia oficial descargada: `docs/exa-skill.md` + `docs/exa-search.md`

## Cómo verificar

1. Probar en el bot: *"buscá las especificaciones técnicas de la RTX 5070"*.
2. Debe responder con datos reales extraídos de la web (títulos + contenido relevante).
3. Si responde "búsqueda web no configurada", falta `EXA_API_KEY` en `.env`.

## Flujo interno del agente

1. El usuario pide buscar algo → el LLM decide llamar `web_search`.
2. `executeTool` ejecuta `exa.search(query)` → resultados con highlights.
3. El LLM recibe los resultados y sintetiza la respuesta en lenguaje natural (tono Kumpa).
