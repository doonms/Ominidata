-- Executar no SQL Editor do projeto Supabase usado pelo Ominidata.
-- Aditiva e idempotente: não altera IDs, fatores, nomes, permissões ou RLS.
begin;

alter table public.base_fatores
  add column if not exists publico_assinatura text default 'todos',
  add column if not exists publico_invalidez text default 'todos';

alter table public.base_fatores
  alter column publico_assinatura set default 'todos',
  alter column publico_invalidez set default 'todos';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.base_fatores'::regclass
      and conname = 'base_fatores_publico_assinatura_check'
  ) then
    alter table public.base_fatores
      add constraint base_fatores_publico_assinatura_check
      check (publico_assinatura is null or publico_assinatura in ('todos', 'sim', 'nao'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.base_fatores'::regclass
      and conname = 'base_fatores_publico_invalidez_check'
  ) then
    alter table public.base_fatores
      add constraint base_fatores_publico_invalidez_check
      check (publico_invalidez is null or publico_invalidez in ('todos', 'sim', 'nao'));
  end if;
end;
$$;

comment on column public.base_fatores.publico_assinatura is
  'Público da tabela: todos (normal), sim (assina) ou nao (não assina). Igual em todos os prazos da mesma tabela.';
comment on column public.base_fatores.publico_invalidez is
  'Público da tabela: todos (normal), sim (com invalidez) ou nao (sem invalidez). Igual em todos os prazos da mesma tabela.';

notify pgrst, 'reload schema';
commit;
