-- Etapa 1, já executada pelo proprietário no SQL Editor.
-- Mantida no projeto para histórico e instalação em ambientes de teste.
begin;
do $$
begin
  if (select count(*) from auth.users where lower(email) = 'dominicplf@gmail.com') <> 1 then
    raise exception 'Não foi possível identificar a conta Master. Nenhuma alteração foi aplicada.';
  end if;
end;
$$;
create table if not exists public.perfis_usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  perfil text not null default 'consulta' check (perfil in ('master', 'admin', 'consulta')),
  criado_em timestamptz not null default now()
);
alter table public.perfis_usuarios enable row level security;
revoke all on public.perfis_usuarios from public, anon, authenticated;
grant select on public.perfis_usuarios to authenticated;
grant all on public.perfis_usuarios to service_role;
drop policy if exists usuario_le_proprio_perfil on public.perfis_usuarios;
create policy usuario_le_proprio_perfil on public.perfis_usuarios
  for select to authenticated using (id = (select auth.uid()));
insert into public.perfis_usuarios(id, perfil)
  select id, case when lower(email) = 'dominicplf@gmail.com' then 'master' else 'consulta' end
  from auth.users on conflict (id) do nothing;
update public.perfis_usuarios set perfil = 'master'
  where id = (select id from auth.users where lower(email) = 'dominicplf@gmail.com');
alter table public.base_fatores enable row level security;
commit;
