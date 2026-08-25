# Deploy de Kumpa (Vercel + Supabase)

Guía para pasar de "corre en tu máquina" a "corre 24/7 en la nube".

---

## 1. Supabase (memoria persistente + semántica)

### 1.1 Crear el proyecto
1. Entrá a [supabase.com](https://supabase.com) → **New project**.
2. Elegí región (cercana a Argentina o la que prefieras) y una contraseña de DB.
3. Esperá a que se cree (~1-2 min).

### 1.2 Habilitar pgvector (memoria semántica)
1. En el dashboard: **Database → Extensions**.
2. Buscá `vector` → **Enable**.

### 1.3 Correr las migraciones
1. **SQL Editor** (Database → SQL Editor → New query).
2. Pegá y ejecutá **en orden** el contenido de:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_insights_data_points.sql`
   - `supabase/migrations/003_pgvector.sql`

### 1.4 Sacar las credenciales
1. **Project Settings → API**.
2. Copiá:
   - `URL` (Project URL)
   - `anon` key
   - `service_role` key

---

## 2. Vercel (hosting del bot)

### 2.1 Subir el código a GitHub
```bash
cd Kumpa
git remote add origin https://github.com/TU_USUARIO/kumpa.git
git push -u origin main
```

### 2.2 Conectar Vercel
1. Entrá a [vercel.com](https://vercel.com) → **New Project**.
2. Importá el repo `kumpa`.
3. Framework preset: **Other**.
4. En **Environment Variables**, cargá las mismas de `.env` (ver abajo).

### 2.3 Variables de entorno en Vercel

| Variable | Requerida |
|----------|-----------|
| `TELEGRAM_BOT_TOKEN` | ✅ |
| `LLM_PROVIDER` = `groq` | ✅ |
| `LLM_API_KEY` | ✅ |
| `BITGET_API_KEY` / `BITGET_SECRET_KEY` / `BITGET_PASSPHRASE` | ✅ (fuente primaria) |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | ✅ (memoria) |
| `EMBEDDING_API_KEY` | opcional (semántica) |
| `CMC_API_KEY` | opcional (fallback CoinGecko) |

### 2.4 Deploy + webhook de Telegram
1. Clic **Deploy**.
2. Copiá la URL de tu app (ej `https://kumpa-xxx.vercel.app`).
3. Activá el webhook de Telegram (una sola vez):
   ```
   https://api.telegram.org/bot<TU_TOKEN>/setWebhook?url=https://TU_APP.vercel.app/api/webhook
   ```

---

## 3. Scheduler (alertas + briefing) en la nube

El loop en proceso (`setInterval`) NO corre en serverless (Vercel duerme las funciones).
Para alertas y briefing automático usá **Vercel Cron**:

1. En Vercel: **Settings → Cron Jobs** → **Create**.
2. Path: `/api/cron` · Schedule: `*/5 * * * *` (cada 5 min).

(Este endpoint `/api/cron` se puede agregar para disparar el chequeo de alertas;
quedó preparado el módulo `src/scheduler` para reutilizarse.)

---

## 4. Verificar

1. Mandale un mensaje al bot en Telegram.
2. Si no responde, revisá **Vercel → Functions → logs**.
3. Verificá que `SUPABASE_URL` esté bien (la memoria persiste entre reinicios).
