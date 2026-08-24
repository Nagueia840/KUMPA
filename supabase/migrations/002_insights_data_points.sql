-- Añade columna para los data points estructurados del insight.
alter table public.insights add column if not exists data_points jsonb not null default '[]'::jsonb;
