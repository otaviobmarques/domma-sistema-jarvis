-- Acesso da equipe ao painel. O papel do backend (jarvis_backend) não mexe no esquema auth;
-- só estas funções, que fazem exatamente o necessário, rodam com permissão de dono.
-- Ficam fechadas para anon/authenticated (não aparecem na API pública do Supabase).

create or replace function public.painel_login(p_auth uuid)
returns text
language sql stable security definer
set search_path = auth, pg_temp
as $$ select email::text from auth.users where id = p_auth $$;

create or replace function public.painel_definir_acesso(p_user uuid, p_tenant uuid, p_email text, p_senha text)
returns text
language plpgsql security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
  v_auth uuid;
  v_nome text;
  v_email text := lower(trim(p_email));
begin
  select auth_user_id, nome into v_auth, v_nome from public.users where id = p_user and tenant_id = p_tenant;
  if not found then return 'nao_encontrado'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id is distinct from v_auth) then return 'login_em_uso'; end if;
  if length(p_senha) < 8 then return 'senha_fraca'; end if;

  if v_auth is not null then
    update auth.users set email = v_email, encrypted_password = extensions.crypt(p_senha, extensions.gen_salt('bf')),
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"trocar_senha": true}'::jsonb, updated_at = now()
    where id = v_auth;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
    where user_id = v_auth and provider = 'email';
    delete from auth.sessions where user_id = v_auth; -- sai de onde estiver logado
    return 'redefinido';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_senha, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
    jsonb_build_object('nome', v_nome, 'trocar_senha', true), now(), now(), '', '', '', '')
  returning id into v_auth;
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_auth, v_auth::text, jsonb_build_object('sub', v_auth::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  update public.users set auth_user_id = v_auth where id = p_user;
  return 'criado';
end $$;

create or replace function public.painel_remover_acesso(p_user uuid, p_tenant uuid)
returns boolean
language plpgsql security definer
set search_path = public, auth, pg_temp
as $$
declare v_auth uuid;
begin
  select auth_user_id into v_auth from public.users where id = p_user and tenant_id = p_tenant;
  if v_auth is null then return false; end if;
  update public.users set auth_user_id = null where id = p_user;
  delete from auth.users where id = v_auth; -- identidades e sessões saem em cascata
  return true;
end $$;

revoke all on function public.painel_login(uuid) from public, anon, authenticated;
revoke all on function public.painel_definir_acesso(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.painel_remover_acesso(uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'jarvis_backend') then
    grant execute on function public.painel_login(uuid) to jarvis_backend;
    grant execute on function public.painel_definir_acesso(uuid, uuid, text, text) to jarvis_backend;
    grant execute on function public.painel_remover_acesso(uuid, uuid) to jarvis_backend;
  end if;
end $$;
