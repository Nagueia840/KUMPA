-- 005_kumpa_worker_webhook.sql
-- Conecta public.update_inbox (INSERT) → Edge Function kumpa-worker.
--
-- ARQUITECTURA (corregida tras error 42601):
--   CREATE TRIGGER ... EXECUTE FUNCTION <fn>(args) SOLO acepta argumentos
--   como LITERALES de string (doc oficial PostgreSQL create_trigger.sgml:
--   "The arguments are literal string constants"). Una llamada como
--   jsonb_build_object(...) NO es un literal → syntax error 42601.
--   Por eso se usa una FUNCIÓN PL/pgSQL INTERMEDIA que construye el payload
--   y el header Authorization en RUNTIME (patrón oficial Supabase:
--   pg_net.mdx "Execute pg_net in a trigger" + vault.mdx + schedule-functions).
--
-- SECRET (NO va en este archivo):
--   Se lee en RUNTIME desde Postgres Vault (vault.decrypted_secrets,
--   nombre 'kumpa_worker_secret') — ya cargado en producción, NO se toca.
--   La función es SECURITY DEFINER (owner=postgres) para que el rol que hace
--   el INSERT (service_role/anon) pueda leer Vault sin exponerlo.
--   Si el secret no existe, el header queda 'Bearer ' → 401 (fail-safe).
--
-- PAYLOAD enviado (compatible con Database Webhooks):
--   { "type":"INSERT", "table":"update_inbox", "schema":"public",
--     "record": <NEW completo>, "old_record": null }
--   parseDbWebhookUpdateId() valida type=INSERT y table=update_inbox
--   (match exacto, ya validado contra runtime: TEST D → 200 ignored).
--
-- AUTH: verify_jwt=false en config.toml + autenticación propia del handler
--   (Authorization: Bearer KUMPA_WORKER_SECRET, fail-closed 401).
--
-- RETRIES: pg_net NO ofrece retries configurables (doc oficial pg_net).
--   El reintento lo implementa la cola: update_inbox.attempts <= 3.
--
-- TIMEOUT: 10000 ms en net.http_post (el análisis puede exceder 2000 ms).
--
-- IDEMPOTENTE: create or replace function + drop trigger if exists.
-- ROLLBACK: drop trigger kumpa_worker_on_insert on public.update_inbox;
--           drop function public.kumpa_worker_on_insert_fn();
--           (el secret de Vault NO se borra: es producción).

-- Vault (extensión oficial; idempotente). Schema real: vault.
create extension if not exists supabase_vault with schema extensions;

-- Función intermedia (SECURITY DEFINER para leer Vault como postgres).
create or replace function public.kumpa_worker_on_insert_fn()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  worker_secret text;
begin
  -- Leer el secret desde Vault en runtime (nunca hardcodeado).
  select decrypted_secret into worker_secret
  from vault.decrypted_secrets
  where name = 'kumpa_worker_secret'
  limit 1;

  -- POST asíncrono a la Edge Function (payload compatible con webhooks).
  perform net.http_post(
    url := 'https://bdnmselqfungturichhs.supabase.co/functions/v1/kumpa-worker',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'update_inbox',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(worker_secret, '')
    ),
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;

-- Trigger AFTER INSERT en update_inbox.
drop trigger if exists kumpa_worker_on_insert on public.update_inbox;

create trigger kumpa_worker_on_insert
after insert on public.update_inbox
for each row
execute function public.kumpa_worker_on_insert_fn();
