-- Executar uma vez no SQL Editor do projeto Supabase usado pelo Ominidata.
-- Aditivo e idempotente: mantém IDs, nomes, fatores, permissões e RLS existentes.
begin;
alter table public.base_fatores
  add column if not exists grupo_fator text;
comment on column public.base_fatores.grupo_fator is
  'Identificador do vínculo de fator entre tabelas do mesmo banco, data e modalidade; nomes, taxas e prazos permanecem independentes.';
notify pgrst, 'reload schema';
commit;
