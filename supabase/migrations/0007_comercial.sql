-- Fase 4: Tavinho como produto. Cada cliente é um tenant isolado, com teste grátis,
-- cobrança por usuário ativo (Asaas) e bloqueio por inadimplência.
-- O tenant "plataforma" (Domma) é dono das chaves de IA, voz e do app do Google.

alter table tenants add column if not exists plataforma boolean not null default false;
alter table tenants add column if not exists status text not null default 'ativo';
alter table tenants drop constraint if exists tenants_status_check;
alter table tenants add constraint tenants_status_check check (status in ('teste','ativo','inadimplente','bloqueado','cancelado'));
alter table tenants add column if not exists teste_ate timestamptz;
alter table tenants add column if not exists preco_usuario numeric(10,2);         -- null = preço padrão da plataforma
alter table tenants add column if not exists documento text;                      -- CPF ou CNPJ (só dígitos)
alter table tenants add column if not exists email_cobranca text;
alter table tenants add column if not exists telefone text;
alter table tenants add column if not exists asaas_cliente_id text;
alter table tenants add column if not exists asaas_assinatura_id text;
alter table tenants add column if not exists usuarios_cobrados int not null default 0;
alter table tenants add column if not exists valor_mensal numeric(10,2);
alter table tenants add column if not exists atraso_desde timestamptz;
alter table tenants add column if not exists bloqueado_em timestamptz;

-- a Domma (primeiro tenant) é a plataforma
update tenants set plataforma = true, status = 'ativo'
where id = (select id from tenants order by criado_em limit 1) and not exists (select 1 from tenants where plataforma);
create unique index if not exists tenants_uma_plataforma on tenants (plataforma) where plataforma;

create table if not exists plataforma_config (
  id boolean primary key default true check (id),
  preco_usuario numeric(10,2) not null default 99.00,
  dias_teste int not null default 14,
  limite_ia_usuario_usd numeric(10,2) not null default 15.00,  -- franquia de IA por usuário/mês
  tolerancia_dias int not null default 5,                      -- dias de atraso antes de bloquear
  atualizado_em timestamptz not null default now()
);
insert into plataforma_config default values on conflict do nothing;

create table if not exists cobrancas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  asaas_id text unique not null,
  valor numeric(10,2) not null,
  status text not null,
  forma text,
  vencimento date,
  pago_em timestamptz,
  link text,
  descricao text,
  atualizado_em timestamptz not null default now()
);
create index if not exists cobrancas_tenant on cobrancas (tenant_id, vencimento desc);

-- idempotência dos webhooks (Asaas, WhatsApp)
create table if not exists webhook_eventos (
  id text primary key,
  origem text not null,
  recebido_em timestamptz not null default now()
);

alter table plataforma_config enable row level security;
alter table cobrancas enable row level security;
alter table webhook_eventos enable row level security;
do $$
declare t text;
begin
  if exists (select 1 from pg_roles where rolname = 'jarvis_backend') then
    foreach t in array array['plataforma_config','cobrancas','webhook_eventos'] loop
      execute format('drop policy if exists backend_all on %I', t);
      execute format('create policy backend_all on %I for all to jarvis_backend using (true) with check (true)', t);
      execute format('grant all on %I to jarvis_backend', t);
    end loop;
  end if;
end $$;


-- Cadastro pelo próprio cliente: a senha é dele, não precisa trocar no 1º acesso (p_trocar = false).
drop function if exists public.painel_definir_acesso(uuid, uuid, text, text);
create or replace function public.painel_definir_acesso(p_user uuid, p_tenant uuid, p_email text, p_senha text, p_trocar boolean default true)
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
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('trocar_senha', p_trocar), updated_at = now()
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
    jsonb_build_object('nome', v_nome, 'trocar_senha', p_trocar), now(), now(), '', '', '', '')
  returning id into v_auth;
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_auth, v_auth::text, jsonb_build_object('sub', v_auth::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  update public.users set auth_user_id = v_auth where id = p_user;
  return 'criado';
end $$;
revoke all on function public.painel_definir_acesso(uuid, uuid, text, text, boolean) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'jarvis_backend') then
    grant execute on function public.painel_definir_acesso(uuid, uuid, text, text, boolean) to jarvis_backend;
  end if;
end $$;
