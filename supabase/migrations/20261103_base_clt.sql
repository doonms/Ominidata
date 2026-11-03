-- Execute o arquivo inteiro no SQL Editor. Não publica nem apaga bancos ao instalar.
-- Requer os perfis Master/Admin/Consulta já configurados no site.
begin;
do $$ begin
  if to_regprocedure('public.perfil_atual()') is null then
    raise exception 'Configure os perfis de acesso do Ominidata antes de instalar a Base CLT.';
  end if;
end $$;

create table if not exists public.base_clt (
  banco_id text primary key check (btrim(banco_id) <> ''),
  nome text not null check (btrim(nome) <> ''),
  suspenso boolean not null default false,
  dados jsonb not null check (jsonb_typeof(dados) = 'object')
);
create table if not exists public.base_clt_backups (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  criado_por uuid not null,
  dados jsonb not null
);
alter table public.base_clt enable row level security;
alter table public.base_clt_backups enable row level security;
revoke all on public.base_clt, public.base_clt_backups from public, anon, authenticated;
revoke all on sequence public.base_clt_backups_id_seq from public, anon, authenticated;
grant select on public.base_clt to authenticated;
drop policy if exists clt_leitura on public.base_clt;
create policy clt_leitura on public.base_clt for select to authenticated
  using ((select public.perfil_atual()) in ('master', 'admin', 'consulta'));
-- A escrita passa somente pela função abaixo; Consulta nunca pode publicar.

create or replace function public.substituir_base_clt(
  p_registros jsonb, p_base_anterior jsonb, p_confirmar_vazia boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $func$
declare
  item jsonb; d jsonb; faixa jsonb; campo text; n numeric;
  atual jsonb; esperada jsonb; nova jsonb; final jsonb;
  backup bigint; removidos integer;
begin
  if auth.uid() is null or coalesce(public.perfil_atual() in ('master','admin'), false) is not true then
    raise exception using errcode='42501', message='Somente Master ou Admin podem publicar a Base CLT.';
  end if;
  if jsonb_typeof(p_registros) is distinct from 'array' or jsonb_typeof(p_base_anterior) is distinct from 'array' then
    raise exception using errcode='22023', message='A base e a versão anterior devem ser listas JSON.';
  end if;
  if jsonb_array_length(p_registros)=0 and p_confirmar_vazia is not true then
    raise exception using errcode='22023', message='Apagar toda a Base CLT exige confirmação explícita.';
  end if;
  for item in select value from jsonb_array_elements(p_registros) loop
    d := item->'dados';
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'banco_id') is distinct from 'string'
      or coalesce(btrim(item->>'banco_id'),'')='' or jsonb_typeof(item->'nome') is distinct from 'string'
      or coalesce(btrim(item->>'nome'),'')='' or jsonb_typeof(item->'suspenso') is distinct from 'boolean'
      or jsonb_typeof(d) is distinct from 'object'
      or d->>'banco_id' is distinct from item->>'banco_id' or d->>'nome' is distinct from item->>'nome'
      or d->'suspenso' is distinct from item->'suspenso' then
      raise exception using errcode='22023', message='Banco CLT sem identificação ou com dados inconsistentes.';
    end if;
    foreach campo in array array['tempoEmpresaMeses','tempoCnpjMeses','minimoFuncionarios','idadeMinima','idadeMaxima'] loop
      if d->campo is not null and d->campo <> 'null'::jsonb then
        if jsonb_typeof(d->campo) is distinct from 'number' then
          raise exception using errcode='22023', message='Requisito numérico CLT inválido.';
        end if;
        n := (d->>campo)::numeric;
        if n < 0 or n <> trunc(n) or n > 9007199254740991 or (campo like 'idade%' and n > 120) then
          raise exception using errcode='22023', message='Requisito CLT fora do intervalo permitido.';
        end if;
      end if;
    end loop;
    if jsonb_typeof(d->'faixasIdade') is distinct from 'array' then
      raise exception using errcode='22023', message='Faixas de idade CLT inválidas.';
    end if;
    for faixa in select value from jsonb_array_elements(d->'faixasIdade') loop
      if jsonb_typeof(faixa) is distinct from 'object' then
        raise exception using errcode='22023', message='Faixa de idade inválida.';
      end if;
      foreach campo in array array['idadeMinima','idadeMaxima'] loop
        if faixa->campo is not null and faixa->campo <> 'null'::jsonb then
          if jsonb_typeof(faixa->campo) is distinct from 'number' then
            raise exception using errcode='22023', message='Idade CLT inválida.';
          end if;
          n := (faixa->>campo)::numeric;
          if n < 0 or n > 120 or n <> trunc(n) then
            raise exception using errcode='22023', message='Idade CLT fora do intervalo permitido.';
          end if;
        end if;
      end loop;
      if (faixa->>'idadeMinima')::numeric > (faixa->>'idadeMaxima')::numeric then
        raise exception using errcode='22023', message='Idade mínima maior que a máxima.';
      end if;
    end loop;
    if jsonb_typeof(d->'documentos') is distinct from 'array' then
      raise exception using errcode='22023', message='Documentos CLT inválidos.';
    end if;
    if exists(select 1 from jsonb_array_elements(d->'documentos') doc
      where jsonb_typeof(doc) <> 'string' or doc #>> '{}' not in ('RG','CPF','CTPS','OUTROS'))
      or jsonb_typeof(d->'outrosDocumentos') is distinct from 'string'
      or ((d->'documentos') ? 'OUTROS' and btrim(d->>'outrosDocumentos')='')
      or jsonb_typeof(d->'seguro') is distinct from 'string' or d->>'seguro' not in ('','nao','opcional','obrigatorio')
      or jsonb_typeof(d->'seguroDescricao') is distinct from 'string'
      or (d->>'seguro' in ('opcional','obrigatorio') and btrim(d->>'seguroDescricao')='')
      or jsonb_typeof(d->'observacoes') is distinct from 'string' then
      raise exception using errcode='22023', message='Confira documentos, seguro e observações do banco CLT.';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_registros) r group by r->>'banco_id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_registros) r
      group by lower(regexp_replace(btrim(r->>'nome'),'\s+',' ','g')) having count(*)>1) then
    raise exception using errcode='22023', message='Há bancos CLT repetidos.';
  end if;
  lock table public.base_clt in share row exclusive mode;
  select coalesce(jsonb_agg(to_jsonb(b) order by banco_id),'[]'::jsonb) into atual from public.base_clt b;
  select coalesce(jsonb_agg(value order by value->>'banco_id'),'[]'::jsonb) into esperada from jsonb_array_elements(p_base_anterior);
  if atual is distinct from esperada then
    raise exception using errcode='40001', message='A Base CLT mudou desde a consulta. Sincronize e revise antes de enviar.';
  end if;
  select coalesce(jsonb_agg(value order by value->>'banco_id'),'[]'::jsonb) into nova from jsonb_array_elements(p_registros);
  insert into public.base_clt_backups(criado_por,dados) values(auth.uid(),atual) returning id into backup;
  insert into public.base_clt(banco_id,nome,suspenso,dados)
    select r->>'banco_id', r->>'nome', (r->>'suspenso')::boolean, r->'dados' from jsonb_array_elements(p_registros) r
    on conflict(banco_id) do update set nome=excluded.nome,suspenso=excluded.suspenso,dados=excluded.dados;
  delete from public.base_clt b where not exists(select 1 from jsonb_array_elements(p_registros) r where r->>'banco_id'=b.banco_id);
  get diagnostics removidos = row_count;
  select coalesce(jsonb_agg(to_jsonb(b) order by banco_id),'[]'::jsonb) into final from public.base_clt b;
  if final is distinct from nova then
    raise exception using errcode='22023', message='A conferência falhou. Toda a publicação foi desfeita.';
  end if;
  return jsonb_build_object('registros',final,'removidos',removidos,'backup_id',backup);
end;
$func$;
revoke all on function public.substituir_base_clt(jsonb,jsonb,boolean) from public, anon;
grant execute on function public.substituir_base_clt(jsonb,jsonb,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
