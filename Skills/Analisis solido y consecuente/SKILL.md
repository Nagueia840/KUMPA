---
name: analisis-solido-consecuente
description: "Habilidad de análisis técnico sólido y consecuente para agentes de IA: datos reales sin alucinaciones, marco analítico repetible, interpretación de indicadores (VWAP, medias, RSI, MACD, Bollinger, ADX, Ichimoku, etc.), niveles de soporte/resistencia y comunicación profesional. Úsala cuando el agente deba analizar activos financieros/cripto de forma consistente entre respuestas."
metadata:
  author: Kumpa
  version: "1.0.0"
---

# Análisis sólido y consecuente

Habilidad que enseña a un agente a producir **análisis técnico confiable, repetible y honesto**: los mismos datos siempre producen los mismos números y la misma tesis, sin alucinaciones ni contradicciones.

## Principios no negociables

1. **Datos reales, nunca memoria.** El precio, funding, OI e indicadores se obtienen de fuentes en vivo (exchanges/APIs). NUNCA se responden desde el conocimiento de entrenamiento (puede estar viejo). Si no tenés el dato, decilo o conseguilo — no lo inventes.
2. **Los números son sagrados.** No los redondees "creativamente", no los escales, no los "ajustes" para que calcen con tu narrativa. Lo que dice la fuente, se dice.
3. **Consistencia entre respuestas.** Mismo activo + mismo tiempo = mismos valores y misma tesis. No cambiás de opinión sin nuevos datos.
4. **Riesgo primero.** Antes de la oportunidad, marcás el downside y los niveles donde el escenario se invalida.
5. **No mezclar activos.** Cada número pertenece al símbolo que lo contiene. (Error clásico: usar las Bollinger de BTC para hablar de ETH.)
6. **Sé honesto con lo que no sabés.** Si un dato falta, decilo en vez de estimarlo.

## Marco analítico (el método, en orden)

Para analizar un activo, seguí esta secuencia — produce análisis sólido y repetible:

1. **Posición**: precio actual vs medias clave (SMA20/50/200, VWAP). ¿Arriba o abajo? ¿Sobrecomprado o sobrevendido estructuralmente?
2. **Momentum**: RSI, MACD (línea vs señal, histograma), estocástico. ¿Acelerando, desacelerando, agotándose?
3. **Fuerza de tendencia**: ADX (>25 = tendencia fuerte) + DI+/DI- (dirección). ¿Hay tendencia real o es lateral?
4. **Volatilidad**: ATR (tamaño del movimiento) + Bollinger (rango). ¿Comprimida o expandida? ¿Precio pegado a un límite?
5. **Soportes/resistencias**: pivotes (P/R1/S1), SMA200 (soporte estructural), Fibonacci, fractales. ¿Dónde están los niveles que importan?
6. **Veredicto + gatillos**: conclusión clara + los niveles EXACTOS que, si se rompen, invalidan la tesis.

## Catálogo de indicadores y su interpretación

### Medias móviles
| Indicador | Qué mide | Cómo leerlo |
|-----------|----------|-------------|
| SMA/EMA 20 | Tendencia corto plazo | Precio > media = alcista de corto |
| SMA 50 | Tendencia media | Cruce precio/media = cambio de sesgo |
| SMA 100/200 | Tendencia estructural | SMA200 = el "soporte de largo plazo" más vigilado |
| EMA (exponencial) | Más sensible que SMA | Reacciona antes, útil para entradas |
| WMA / HMA | Menos lag | Para detectar giros tempranos |
| VWAP | Precio promedio ponderado por volumen | Precio > VWAP = compradores dominan; VWAP = punto de referencia de liquidez |
| VWMA | Media ponderada por volumen | Combina precio+volumen |

### Osciladores
| Indicador | Qué mide | Cómo leerlo |
|-----------|----------|-------------|
| RSI | Fuerza del movimiento | >70 sobrecompra, <30 sobreventa; >85 = sobrecompra extrema (riesgo de corrección) |
| MACD | Momentum + cruces | Línea > señal = alcista; histograma crece = momentum acelera; decrece = se agota |
| Stochastic %K/%D | Posición en el rango | >80 sobrecompra, <20 sobreventa |
| CCI | Desviación del precio típico | >100 fuerte, < -100 débil |
| Williams %R | Posición del cierre | >-20 sobrecompra, <-80 sobreventa |
| ROC/Momentum | Velocidad del cambio | Positivo/negativo, aceleración |
| Awesome Oscillator | Impulso de medias | Positivo = alcista |

### Volatilidad
| Indicador | Qué mide | Cómo leerlo |
|-----------|----------|-------------|
| ATR | Tamaño del movimiento | Alto = volátil; sirve para dimensionar stops (1-2 ATR) |
| Bollinger | Media ± 2 desvíos | Precio pegado a banda superior = sobrecompra; bandas anchas = volátil; apretadas = compresión → ruptura |
| Keltner / Donchian | Canales de volatilidad | Similar a Bollinger, por ATR o máximos/mínimos |
| Volatilidad histórica | Desvío anualizado | Baja = tranquilo; alta = riesgoso |

### Tendencia
| Indicador | Qué mide | Cómo leerlo |
|-----------|----------|-------------|
| ADX | Fuerza de la tendencia | >25 = tendencia real; <20 = lateral |
| DI+/DI- | Dirección de la tendencia | DI+ > DI- = alcista; DI- > DI+ = bajista |
| Ichimoku | Tenkan/Kijun/Senkou | Precio sobre la nube = alcista; cruces Tenkan/Kijun = señales |
| Parabolic SAR | Puntos de reversión | SAR bajo precio = alcista; sobre precio = bajista |
| SuperTrend | Tendencia + nivel de stop | "up/down" + nivel de invalidez |

### Volumen
| Indicador | Qué mide | Cómo leerlo |
|-----------|----------|-------------|
| OBV | Acumulación/distribución | Sube con volumen en subidas = acumulación |
| MFI | RSI del flujo de dinero | >80 sobrecompra, <20 sobreventa |
| Chaikin MF / A/D | Presión compra/venta | Positivo = compradores |

### Soportes / resistencias
| Indicador | Qué mide | Cómo leerlo |
|-----------|----------|-------------|
| Pivot Points (P/R1/S1) | Niveles diarios clave | Precio en R1 = resistencia; en S1 = soporte |
| Fibonacci | Retrocesos del rango | 0.382/0.5/0.618 = zonas de pullback |
| Fractales | Máximos/mínimos locales | Agrupan zonas de soporte/resistencia |

## Reglas de consistencia

- **Mismos datos → mismos números**: si dos respuestas usan la misma fuente al mismo tiempo, los valores deben coincidir.
- **Niveles repetibles**: mencioná los niveles EXACTOS (S1 77,134, SMA200 69,110) y usá los mismos en todas las respuestas del mismo periodo.
- **No contradecirte**: la tesis cambia SOLO si cambian los datos, no por redacción.
- **Un solo marco**: precio → momentum → fuerza → volatilidad → soportes → veredicto. Siempre el mismo orden mental.

## Anti-patrones (errores que rompen la confianza)

- ❌ Responder precios/indicadores "de memoria" (datos viejos del entrenamiento).
- ❌ Inventar o "escalar" decimales (ej. funding 0.0047% → decir "0.47%").
- ❌ Mezclar indicadores de un activo con otro (Bollinger de BTC para ETH).
- ❌ Usar estructuras rígidas tipo informe (HECHOS:/JUICIOS:/ACCIÓN:) en conversación — hablá natural.
- ❌ Prometer retornos o dar consejo financiero vinculante.
- ❌ Forzar modismos ("che" en cada frase) — el profesionalismo va primero.

## Comunicación (el estilo)

- Conversación natural, números integrados en la frase (no tablas).
- Riesgo primero, veredicto claro, gatillos de invalidación explícitos.
- Si mencionan un término que parece un indicador pero está mal transcrito (RCI→RSI, BigWop→VWAP), tratálo como el indicador real.
- Tono: profesional, directo, respetuoso, práctico. Sin humo.

## Cómo se aplica en un agente con herramientas

1. **Pre-fetch determinista**: detectar los tickers del mensaje y obtener datos reales de TODOS antes de responder (nunca depender de que el LLM decida consultar).
2. Inyectar los datos etiquetados por símbolo en el contexto.
3. Usar el LLM para SINTETIZAR (no para recordar datos): el LLM lee los números reales y arma el análisis con el marco de arriba.
4. Para indicadores: calcularlos desde velas OHLCV del exchange (nunca "preguntarle" a TradingView o inventarlos).

## Verificación de la habilidad

Un agente que domina esta skill:
- Da los mismos números al mismo activo en el mismo momento (consistencia).
- Nunca dice "no dispongo del RSI" cuando el dato está disponible.
- Marca el riesgo antes que la oportunidad, con niveles exactos.
- Cambia su tesis solo si cambian los datos.
