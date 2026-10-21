-- ETAPA 2: execute o arquivo inteiro após 20261021_perfis_inicial.sql.
-- Não publica, exclui nem altera os registros das bases.
-- Substitui as políticas das três bases e atualiza a autorização da RPC.
begin;

do $$
begin
  if to_regclass('public.perfis_usuarios') is null then
    raise exception 'Execute primeiro a etapa de criação dos perfis.';
  end if;
  if not exists (select 1 from public.perfis_usuarios where perfil = 'master') then
    raise exception 'Nenhum Master cadastrado. Confira a etapa anterior.';
  end if;
end;
$$;

-- Lê somente o perfil do chamador. Não recebe ID nem papel do navegador.
create or replace function public.perfil_atual()
returns text language sql stable security definer set search_path = ''
as $$
  select p.perfil from public.perfis_usuarios as p where p.id = (select auth.uid())
$$;

create or replace function public.pode_editar_bases()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select coalesce(public.perfil_atual() in ('master', 'admin'), false)
$$;

revoke all on function public.perfil_atual() from public, anon;
revoke all on function public.pode_editar_bases() from public, anon;
grant execute on function public.perfil_atual() to authenticated, service_role;
grant execute on function public.pode_editar_bases() to authenticated, service_role;

-- Nenhum usuário do site pode escrever diretamente na tabela de perfis.
alter table public.perfis_usuarios enable row level security;
revoke all on public.perfis_usuarios from public, anon, authenticated;
grant select on public.perfis_usuarios to authenticated;
grant all on public.perfis_usuarios to service_role;

-- Políticas permissivas são combinadas com OR. Removemos as antigas somente
-- das três bases auditadas para não deixar uma permissão antiga contorná-las.
do $$
declare
  v_tabela text;
  v_politica record;
begin
  foreach v_tabela in array array['base_fatores', 'base_inss', 'base_outros_convenios']
  loop
    execute format('alter table public.%I enable row level security', v_tabela);
    for v_politica in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = v_tabela
    loop
      execute format('drop policy %I on public.%I', v_politica.policyname, v_tabela);
    end loop;
    execute format('revoke all on public.%I from public, anon, authenticated', v_tabela);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_tabela);
    execute format(
      'create policy perfis_leitura on public.%I for select to authenticated
       using ((select public.perfil_atual()) in (''master'', ''admin'', ''consulta''))',
      v_tabela
    );
    execute format(
      'create policy perfis_edicao on public.%I for all to authenticated
       using ((select public.pode_editar_bases()))
       with check ((select public.pode_editar_bases()))',
      v_tabela
    );
  end loop;
end;
$$;

-- Continua exigindo confirmação, backup e conferência de concorrência.
-- Apenas a autorização muda: Master e administrador podem publicar.
create or replace function public.substituir_base_outros_convenios(
  p_registros jsonb,
  p_base_anterior jsonb,
  p_confirmar_vazia boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $func$
declare
  v_item jsonb;
  v_atual jsonb;
  v_esperada jsonb;
  v_nova jsonb;
  v_final jsonb;
  v_backup_id bigint;
  v_removidos integer;
begin
  -- A autorização usa o perfil no banco, não e-mail nem metadata do cliente.
  if public.pode_editar_bases() is not true then
    raise exception using errcode = '42501',
      message = 'Somente Master ou administrador podem substituir a Base Outros Convênios.';
  end if;

  if jsonb_typeof(p_registros) is distinct from 'array'
     or jsonb_typeof(p_base_anterior) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'A base e a versão anterior precisam ser listas JSON.';
  end if;
  if jsonb_array_length(p_registros) = 0 and p_confirmar_vazia is not true then
    raise exception using errcode = '22023', message = 'Esvaziar toda a base exige confirmação explícita.';
  end if;

  for v_item in select value from jsonb_array_elements(p_registros)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Registro de banco inválido.';
    end if;
    if jsonb_typeof(v_item->'banco_id') is distinct from 'string'
       or coalesce(btrim(v_item->>'banco_id'), '') = ''
       or jsonb_typeof(v_item->'nome') is distinct from 'string'
       or coalesce(btrim(v_item->>'nome'), '') = ''
       or jsonb_typeof(v_item->'suspenso') is distinct from 'boolean'
       or jsonb_typeof(v_item->'dados') is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Banco sem identificação, nome, suspensão ou dados válidos.';
    end if;
    if jsonb_typeof(v_item->'dados'->'convenios') is distinct from 'array'
       or v_item->'dados'->>'banco_id' is distinct from v_item->>'banco_id'
       or v_item->'dados'->>'nome' is distinct from v_item->>'nome'
       or v_item->'dados'->'suspenso' is distinct from v_item->'suspenso' then
      raise exception using errcode = '22023', message = 'Os dados do banco não correspondem à identificação enviada.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_item->'dados'->'convenios') as c
      where jsonb_typeof(c.value) is distinct from 'object'
    ) then
      raise exception using errcode = '22023', message = 'Convênio inválido no banco enviado.';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_registros) as r
    group by r.value->>'banco_id' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(p_registros) as r
    group by lower(regexp_replace(btrim(r.value->>'nome'), '\s+', ' ', 'g'))
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Há bancos com nomes ou identificações repetidas.';
  end if;

  -- Serializa publicações e impede escrita concorrente entre a conferência e o commit.
  lock table public.base_outros_convenios in share row exclusive mode;
  select coalesce(jsonb_agg(jsonb_build_object(
    'banco_id', b.banco_id, 'nome', b.nome, 'suspenso', b.suspenso, 'dados', b.dados
  ) order by b.banco_id), '[]'::jsonb)
    into v_atual from public.base_outros_convenios as b;
  select coalesce(jsonb_agg(r.value order by r.value->>'banco_id'), '[]'::jsonb)
    into v_esperada from jsonb_array_elements(p_base_anterior) as r;
  if v_atual is distinct from v_esperada then
    raise exception using errcode = '40001',
      message = 'A base mudou desde a consulta. Atualize e revise antes de substituir.';
  end if;
  select coalesce(jsonb_agg(r.value order by r.value->>'banco_id'), '[]'::jsonb)
    into v_nova from jsonb_array_elements(p_registros) as r;

  insert into public.base_outros_convenios_backups(criado_por, dados)
    values (auth.uid(), v_atual) returning id into v_backup_id;

  insert into public.base_outros_convenios(banco_id, nome, suspenso, dados)
    select r.value->>'banco_id', r.value->>'nome',
      (r.value->>'suspenso')::boolean, r.value->'dados'
    from jsonb_array_elements(p_registros) as r
    on conflict (banco_id) do update
      set nome = excluded.nome, suspenso = excluded.suspenso, dados = excluded.dados;

  delete from public.base_outros_convenios as b
    where not exists (
      select 1 from jsonb_array_elements(p_registros) as r
      where r.value->>'banco_id' = b.banco_id
    );
  get diagnostics v_removidos = row_count;

  select coalesce(jsonb_agg(jsonb_build_object(
    'banco_id', b.banco_id, 'nome', b.nome, 'suspenso', b.suspenso, 'dados', b.dados
  ) order by b.banco_id), '[]'::jsonb)
    into v_final from public.base_outros_convenios as b;
  if v_final is distinct from v_nova then
    raise exception using errcode = '22023', message = 'A conferência final falhou. Toda a substituição foi desfeita.';
  end if;
  return jsonb_build_object('registros', v_final, 'removidos', v_removidos, 'backup_id', v_backup_id);
end;
$func$;

revoke all on function public.substituir_base_outros_convenios(jsonb, jsonb, boolean) from public, anon;
grant execute on function public.substituir_base_outros_convenios(jsonb, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Conferência: os três registros precisam mostrar true.
select tablename as tabela, rowsecurity as protecao_rls_ativa
from pg_tables
where schemaname = 'public'
  and tablename in ('base_fatores', 'base_inss', 'base_outros_convenios')
order by tablename;

