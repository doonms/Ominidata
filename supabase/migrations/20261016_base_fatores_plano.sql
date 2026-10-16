-- Executar uma vez no SQL Editor do projeto Supabase usado pelo Ominidata.
-- Aditivo e idempotente: não remove fatores e não altera permissões/RLS.
begin;
alter table public.base_fatores
  add column if not exists plano text not null default '';
comment on column public.base_fatores.plano is
  'Nome da tabela comercial; distingue tabelas do mesmo banco, data, tipo e prazo.';
notify pgrst, 'reload schema';
commit;
