-- ETAPA 3: execute após a migração de permissões dos perfis.
-- Instala funções de gestão. Não cria usuários nem altera perfis existentes.
begin;

do $$
begin
  if to_regprocedure('public.perfil_atual()') is null then
    raise exception 'Execute primeiro a etapa 2: permissões dos perfis.';
  end if;
end;
$$;

-- Somente Master pode listar as contas. Não expõe senha, hash ou tokens.
create or replace function public.listar_usuarios(
  p_busca text default '',
  p_limite integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  perfil text,
  criado_em timestamptz,
  ultimo_acesso timestamptz,
  total bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if public.perfil_atual() is distinct from 'master' then
    raise exception using errcode = '42501', message = 'Somente o Master pode listar usuários.';
  end if;
  if p_limite is null or p_limite < 1 or p_limite > 100
     or p_offset is null or p_offset < 0
     or p_busca is null or char_length(p_busca) > 254 then
    raise exception using errcode = '22023', message = 'Parâmetros de pesquisa inválidos.';
  end if;
  return query
    select u.id, u.email::text, p.perfil, u.created_at, u.last_sign_in_at, count(*) over ()
    from auth.users as u
    left join public.perfis_usuarios as p on p.id = u.id
    where strpos(lower(coalesce(u.email, '')), lower(btrim(p_busca))) > 0
    order by u.created_at desc nulls last, u.id
    limit p_limite offset p_offset;
end;
$$;

-- Também finaliza o perfil de uma conta recém-criada ou ainda sem perfil.
-- Não recebe autor, e-mail do Master ou permissões informadas pelo navegador.
create or replace function public.definir_perfil_usuario(
  p_usuario_id uuid,
  p_perfil text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_anterior text;
  v_alterados integer;
begin
  if public.perfil_atual() is distinct from 'master' then
    raise exception using errcode = '42501', message = 'Somente o Master pode definir perfis.';
  end if;
  if p_perfil is null or p_perfil not in ('admin', 'consulta') or p_usuario_id is null then
    raise exception using errcode = '22023', message = 'Escolha Administrador ou Consulta.';
  end if;
  if p_usuario_id = auth.uid() then
    raise exception using errcode = '42501', message = 'Sua conta Master não pode ser alterada por esta tela.';
  end if;
  -- Serializa provisionamentos e protege contra exclusão concorrente da conta.
  perform 1 from auth.users as u where u.id = p_usuario_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Usuário não encontrado.';
  end if;
  select p.perfil into v_anterior from public.perfis_usuarios as p
    where p.id = p_usuario_id for update;
  if v_anterior = 'master' then
    raise exception using errcode = '42501', message = 'Contas Master não podem ser alteradas por esta tela.';
  end if;
  insert into public.perfis_usuarios as p (id, perfil)
    values (p_usuario_id, p_perfil)
    on conflict (id) do update set perfil = excluded.perfil
    where p.perfil <> 'master';
  get diagnostics v_alterados = row_count;
  if v_alterados <> 1 then
    raise exception using errcode = '42501', message = 'Não foi possível alterar este perfil.';
  end if;
  return jsonb_build_object('id', p_usuario_id, 'perfil', p_perfil);
end;
$$;

revoke all on function public.listar_usuarios(text, integer, integer) from public, anon;
revoke all on function public.definir_perfil_usuario(uuid, text) from public, anon;
grant execute on function public.listar_usuarios(text, integer, integer) to authenticated;
grant execute on function public.definir_perfil_usuario(uuid, text) to authenticated;

notify pgrst, 'reload schema';
commit;

select 'Etapa 3 instalada. Agora publique a Edge Function criar-usuario.' as resultado;
