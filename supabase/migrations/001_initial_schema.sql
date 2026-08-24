-- KUMPA — esquema inicial
-- Acceso de la app vía SERVICE_ROLE (bypass RLS). El anon key queda sin acceso
-- a estas tablas (seguro por defecto: app_settings puede guardar llm_api_key).

-- 1) Settings LLM (permite cambiar proveedor/modelo sin redeploy)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2) Conversaciones (historial de chat por usuario)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index if not exists conversations_chat_id_idx on public.conversations (chat_id, created_at);

-- 3) Entidades (tickers, narrativas) para el grafo de conocimiento simple
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,          -- ej 'BTC', 'ETH', 'AI-narrative'
  kind text not null,                  -- 'ticker' | 'narrative' | 'macro'
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 4) Insights (output del analista)
create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint,
  title text not null,
  summary text not null,
  judgment text,
  confidence text not null default 'media',
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
-- NOTA: la columna embedding vector(1536) se agrega en 002_pgvector.sql
-- (requiere habilitar la extensión pgvector en Supabase).

-- 5) Alertas persistentes
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  type text not null,
  symbol text not null,
  threshold double precision not null,
  active boolean not null default true,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists alerts_active_idx on public.alerts (active, chat_id);

-- 6) Planes de operación (para /plan y /review)
create table if not exists public.trade_plans (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  symbol text not null,
  direction text not null,
  entry_low double precision not null,
  entry_high double precision not null,
  stop_loss double precision not null,
  take_profits jsonb not null default '[]'::jsonb,
  position_size_pct double precision,
  reasoning text,
  event_risks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- 7) Learnings (loop de aprendizaje)
create table if not exists public.learnings (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  topic text not null,
  thesis text,
  outcome text,
  lesson text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists learnings_chat_id_idx on public.learnings (chat_id, created_at desc);

create index if not exists insights_created_at_idx on public.insights (created_at desc);

-- RLS habilitado en todas las tablas (acceso exclusivo por SERVICE_ROLE).
alter table public.app_settings enable row level security;
alter table public.conversations enable row level security;
alter table public.entities enable row level security;
alter table public.insights enable row level security;
alter table public.alerts enable row level security;
alter table public.trade_plans enable row level security;
alter table public.learnings enable row level security;
