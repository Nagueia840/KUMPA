-- KUMPA — memoria semántica (pgvector)
-- Requiere habilitar la extensión "vector" en Supabase (Dashboard → Database → Extensions).
-- Si `create extension` falla por permisos, habilitala desde el panel y corré el resto.

create extension if not exists vector;

-- Columnas de embedding (1536 = text-embedding-3-small)
alter table public.insights add column if not exists embedding vector(1536);
alter table public.learnings add column if not exists embedding vector(1536);

-- Índices HNSW para búsqueda por similitud coseno
create index if not exists insights_embedding_idx on public.insights using hnsw (embedding vector_cosine_ops);
create index if not exists learnings_embedding_idx on public.learnings using hnsw (embedding vector_cosine_ops);

-- Búsqueda semántica de insights
create or replace function match_insights(
  query_embedding vector(1536),
  match_count int,
  p_chat_id bigint
) returns table (title text, summary text, judgment text, confidence text, sources jsonb, similarity float)
language sql stable as $$
  select title, summary, judgment, confidence, sources,
         1 - (embedding <=> query_embedding) as similarity
  from public.insights
  where (p_chat_id is null or chat_id = p_chat_id)
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Búsqueda semántica de lecciones aprendidas
create or replace function match_learnings(
  query_embedding vector(1536),
  match_count int,
  p_chat_id bigint
) returns table (topic text, thesis text, outcome text, lesson text, tags text[], similarity float)
language sql stable as $$
  select topic, thesis, outcome, lesson, tags,
         1 - (embedding <=> query_embedding) as similarity
  from public.learnings
  where (p_chat_id is null or chat_id = p_chat_id)
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
