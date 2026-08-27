-- 004_update_inbox.sql
-- Infraestructura operacional de la arquitectura asíncrona:
--   Telegram → Vercel /api/webhook → update_inbox → Database Webhook
--   → Edge Function kumpa-worker → bot.handleUpdate → processed_updates
--
-- SOLO estado de procesamiento de updates de Telegram (cola + idempotencia).
-- NO almacena snapshots de mercado, indicadores, OHLCV ni respuestas financieras.

create table if not exists public.update_inbox (
  update_id bigint primary key,          -- update_id de Telegram = clave de idempotencia
  payload jsonb not null,                -- update completo de Telegram
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'failed')),
  attempts integer not null default 0,   -- cada claim incrementa; máx 3
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processing_started_at timestamptz,     -- claim atómico / detección de colgados
  finished_at timestamptz,
  last_error text                        -- sanitizado (sin tokens/keys)
);

-- Claim atómico: pendientes más viejos primero.
create index if not exists update_inbox_pending_idx
  on public.update_inbox (created_at) where status = 'pending';

-- Safety-net: processing colgado (processing_started_at viejo).
create index if not exists update_inbox_stuck_idx
  on public.update_inbox (processing_started_at) where status = 'processing';

-- Idempotencia de respuesta: un update ya procesado no vuelve a responder.
create table if not exists public.processed_updates (
  update_id bigint primary key,
  processed_at timestamptz not null default now(),
  chat_id bigint,                        -- metadata mínima de operación
  kind text                              -- 'text' | 'voice' | 'photo' | ...
);
