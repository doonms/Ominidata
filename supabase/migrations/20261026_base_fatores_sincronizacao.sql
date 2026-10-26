-- Execute uma vez no SQL Editor do projeto Supabase do site.
-- Instalar este SQL NÃO publica nem exclui fatores. Exige os perfis Master/Admin já instalados.
begin;

alter table public.base_fatores
  add column if not exists plano text not null default '',
  add column if not exists grupo_fator text,
  add column if not exists publico_assinatura text default 'todos',
  add column if not exists publico_invalidez text default 'todos';

create table if not exists public.base_fatores_backups (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  criado_por uuid not null,
  dados jsonb not null
);
alter table public.base_fatores_backups enable row level security;
revoke all on public.base_fatores_backups from public, anon, authenticated;
revoke all on sequence public.base_fatores_backups_id_seq from public, anon, authenticated;

create or replace function public.substituir_base_fatores(
  p_registros jsonb, p_base_anterior jsonb, p_confirmar_vazia boolean default false
)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $func$
declare
  v_item jsonb;
  v_atual jsonb;
  v_esperada jsonb;
  v_final jsonb;
  v_publicada jsonb;
  v_backup_id bigint;
  v_id public.base_fatores.id%type;
  v_ids jsonb := '[]'::jsonb;
  v_removidos integer;
  v_tem_data boolean;
begin
  if auth.uid() is null or not coalesce(public.pode_editar_bases(), false) then
    raise exception using errcode = '42501', message = 'Somente Master e Admin podem publicar fatores.';
  end if;
  if jsonb_typeof(p_registros) is distinct from 'array'
     or jsonb_typeof(p_base_anterior) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Envie a base e a versão anterior como listas JSON.';
  end if;
  if jsonb_array_length(p_registros) = 0 and p_confirmar_vazia is not true then
    raise exception using errcode = '22023', message = 'Esvaziar a base exige confirmação explícita.';
  end if;

  for v_item in select value from jsonb_array_elements(p_registros) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Registro de fator inválido.';
    end if;
    if exists (select 1 from jsonb_object_keys(v_item) as k(chave)
      where k.chave not in ('banco','convenio','tipo','prazo','fator','taxa','plano','grupo_fator','publico_assinatura','publico_invalidez'))
      or jsonb_typeof(v_item->'banco') is distinct from 'string'
      or coalesce(btrim(v_item->>'banco'), '') = ''
      or v_item->>'banco' in ('__proto__','prototype','constructor')
      or v_item->>'convenio' is distinct from 'INSS'
      or coalesce(v_item->>'tipo', '') not in ('margem','cartao')
      or jsonb_typeof(v_item->'plano') is distinct from 'string'
      or jsonb_typeof(v_item->'prazo') is distinct from 'number'
      or jsonb_typeof(v_item->'fator') is distinct from 'number'
      or coalesce(v_item->>'publico_assinatura','') not in ('todos','sim','nao')
      or coalesce(v_item->>'publico_invalidez','') not in ('todos','sim','nao') then
      raise exception using errcode = '22023', message = 'Banco, modalidade, tabela, público, prazo ou fator inválido.';
    end if;
    if (v_item->>'prazo')::numeric <= 0 or (v_item->>'prazo')::numeric > 2147483647
      or trunc((v_item->>'prazo')::numeric) <> (v_item->>'prazo')::numeric
      or (v_item->>'fator')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'Prazo e fator devem ser positivos; o prazo deve ser inteiro.';
    end if;
    if v_item->'taxa' is not null and v_item->'taxa' <> 'null'::jsonb then
      if jsonb_typeof(v_item->'taxa') <> 'number' then
        raise exception using errcode = '22023', message = 'Taxa inválida.';
      end if;
      if (v_item->>'taxa')::numeric < 0 then
        raise exception using errcode = '22023', message = 'A taxa não pode ser negativa.';
      end if;
    end if;
    if v_item->'grupo_fator' is not null and v_item->'grupo_fator' <> 'null'::jsonb then
      if jsonb_typeof(v_item->'grupo_fator') <> 'string'
        or length(btrim(v_item->>'grupo_fator')) not between 1 and 128 then
        raise exception using errcode = '22023', message = 'Vínculo de fatores inválido.';
      end if;
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(p_registros) r
    group by r.value->>'banco', r.value->>'tipo', (r.value->>'prazo')::numeric, btrim(r.value->>'plano')
    having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(p_registros) r
    group by r.value->>'banco', r.value->>'tipo', btrim(r.value->>'plano')
    having count(distinct r.value->>'publico_assinatura') > 1
      or count(distinct r.value->>'publico_invalidez') > 1
  ) or exists (
    select 1 from jsonb_array_elements(p_registros) r where r.value->>'grupo_fator' is not null
    group by r.value->>'banco', r.value->>'tipo', r.value->>'grupo_fator'
    having count(distinct (r.value->>'prazo')::numeric) > 1
      or count(distinct (r.value->>'fator')::numeric) > 1
  ) then
    raise exception using errcode = '22023', message = 'Há fatores duplicados, públicos divergentes ou vínculos inconsistentes.';
  end if;

  lock table public.base_fatores in share row exclusive mode;
  select coalesce(jsonb_agg(to_jsonb(b) order by b.id::text), '[]'::jsonb) into v_atual
    from public.base_fatores b where upper(coalesce(b.convenio, 'INSS')) = 'INSS';
  select coalesce(jsonb_agg(r.value order by r.value->>'id'), '[]'::jsonb) into v_esperada
    from jsonb_array_elements(p_base_anterior) r;
  if v_atual is distinct from v_esperada then
    raise exception using errcode = '40001', message = 'A base mudou desde a consulta. Sincronize e revise antes de publicar.';
  end if;
  insert into public.base_fatores_backups(criado_por, dados)
    values (auth.uid(), v_atual) returning id into v_backup_id;
  select exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'base_fatores' and column_name = 'data') into v_tem_data;

  for v_item in select value from jsonb_array_elements(p_registros) loop
    -- Mantém o ID do registro correspondente. Não insere IDs fornecidos pelo cliente.
    select b.id into v_id from public.base_fatores b
      where upper(coalesce(b.convenio, 'INSS')) = 'INSS'
        and b.banco = v_item->>'banco' and b.tipo = v_item->>'tipo'
        and b.prazo = (v_item->>'prazo')::integer
        and btrim(coalesce(b.plano, '')) = btrim(v_item->>'plano')
      order by coalesce(to_jsonb(b)->>'data', '9999-12-31') desc, b.id desc limit 1;
    if found then
      update public.base_fatores set fator = (v_item->>'fator')::numeric,
        taxa = (v_item->>'taxa')::numeric, grupo_fator = v_item->>'grupo_fator',
        publico_assinatura = v_item->>'publico_assinatura', publico_invalidez = v_item->>'publico_invalidez'
        where id = v_id;
    elsif v_tem_data then
      -- Projetos antigos podem manter "data" NOT NULL. Ela não divide mais as tabelas.
      execute 'insert into public.base_fatores(banco,convenio,tipo,prazo,fator,taxa,plano,grupo_fator,publico_assinatura,publico_invalidez,data)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,''1970-01-01'') returning id'
        into v_id using v_item->>'banco', 'INSS', v_item->>'tipo', (v_item->>'prazo')::integer,
          (v_item->>'fator')::numeric, (v_item->>'taxa')::numeric, btrim(v_item->>'plano'),
          v_item->>'grupo_fator', v_item->>'publico_assinatura', v_item->>'publico_invalidez';
    else
      insert into public.base_fatores(banco,convenio,tipo,prazo,fator,taxa,plano,grupo_fator,publico_assinatura,publico_invalidez)
        values(v_item->>'banco','INSS',v_item->>'tipo',(v_item->>'prazo')::integer,
          (v_item->>'fator')::numeric,(v_item->>'taxa')::numeric,btrim(v_item->>'plano'),
          v_item->>'grupo_fator',v_item->>'publico_assinatura',v_item->>'publico_invalidez') returning id into v_id;
    end if;
    v_ids := v_ids || jsonb_build_array(v_id::text);
  end loop;
  delete from public.base_fatores b where upper(coalesce(b.convenio, 'INSS')) = 'INSS'
    and not (v_ids ? b.id::text);
  get diagnostics v_removidos = row_count;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.id::text), '[]'::jsonb) into v_final
    from public.base_fatores b where upper(coalesce(b.convenio, 'INSS')) = 'INSS';
  select coalesce(jsonb_agg(jsonb_build_object('banco', b.banco, 'convenio', 'INSS', 'tipo', b.tipo,
    'prazo', b.prazo, 'fator', b.fator, 'taxa', b.taxa, 'plano', btrim(coalesce(b.plano,'')),
    'grupo_fator', b.grupo_fator, 'publico_assinatura', b.publico_assinatura, 'publico_invalidez', b.publico_invalidez)
    order by b.banco,b.tipo,b.prazo,btrim(coalesce(b.plano,''))), '[]'::jsonb) into v_publicada
    from public.base_fatores b where upper(coalesce(b.convenio, 'INSS')) = 'INSS';
  select coalesce(jsonb_agg(r.value order by r.value->>'banco',r.value->>'tipo',
    (r.value->>'prazo')::integer,r.value->>'plano'), '[]'::jsonb) into v_esperada
    from jsonb_array_elements(p_registros) r;
  if v_publicada is distinct from v_esperada then
    raise exception using errcode = '22023', message = 'A conferência final falhou. Toda a publicação foi desfeita.';
  end if;
  return jsonb_build_object('registros',v_final,'removidos',v_removidos,'backup_id',v_backup_id);
end;
$func$;

revoke all on function public.substituir_base_fatores(jsonb,jsonb,boolean) from public, anon;
grant execute on function public.substituir_base_fatores(jsonb,jsonb,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
