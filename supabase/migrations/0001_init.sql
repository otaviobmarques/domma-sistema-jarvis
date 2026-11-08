-- Projeto Jarvis — esquema inicial (seção 12 do documento de arquitetura)
-- Multiusuário/multi-tenant desde o início. Todo acesso é feito pelo backend
-- (service role). RLS fica LIGADO sem políticas públicas: nada é acessível
-- pela chave anônima.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- unaccent() não é IMMUTABLE; wrapper para usar em coluna gerada / índice
create or replace function unaccent_imm(t text) returns text
  language sql immutable parallel safe strict
  set search_path = public, extensions
as $$ select extensions.unaccent('unaccent'::regdictionary, t) $$;

-- ---------------------------------------------------------------- tenants
create table tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  plano text not null default 'interno',
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- users
create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  auth_user_id uuid unique,                       -- usuário do Supabase Auth (painel)
  email text,
  nome text not null,
  perfil text not null check (perfil in ('dono','gestor','operador','loja')),
  whatsapp text unique,                           -- só dígitos, com DDI (ex.: 5531999999999)
  pin_hash text,
  voz_embedding extensions.vector(256),                      -- Fase 2 (reconhecimento de voz)
  autonomia int not null default 2 check (autonomia between 1 and 4),
  autonomia_total_ate timestamptz,                -- nível 4 desliga sozinho
  horario_silencio_inicio time default '22:00',
  horario_silencio_fim time default '07:00',
  preferencias jsonb not null default '{}'::jsonb,
  limite_mensal_usd numeric(10,2) default 200,
  ativo boolean not null default true,
  pausado boolean not null default false,         -- botão de pânico
  criado_em timestamptz not null default now()
);
create index on users (tenant_id);

-- ---------------------------------------------------------------- companies
create table companies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  integracoes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  unique (tenant_id, nome)
);

create table user_companies (
  user_id uuid references users(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  primary key (user_id, company_id)
);

-- ---------------------------------------------------------------- devices
create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  tipo text not null check (tipo in ('pc','android')),
  nome text not null,
  chave_publica text,
  ultimo_contato timestamptz,
  status text not null default 'offline',
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- conversas
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  canal text not null check (canal in ('voz','whatsapp','app','painel','rotina')),
  iniciada_em timestamptz not null default now(),
  ultima_msg_em timestamptz not null default now(),
  resumo text,
  encerrada boolean not null default false
);
create index on conversations (user_id, canal, ultima_msg_em desc);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  autor text not null check (autor in ('user','assistant','system')),
  conteudo text not null,
  anexos jsonb not null default '[]'::jsonb,
  tokens int default 0,
  custo numeric(12,6) default 0,
  criado_em timestamptz not null default now()
);
create index on messages (conversation_id, criado_em);

-- ---------------------------------------------------------------- tarefas
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  canal text,
  pedido text not null,
  plano_json jsonb,
  modelo text,
  status text not null default 'executando'
    check (status in ('executando','aguardando_aprovacao','concluida','erro','cancelada')),
  executor text,
  resposta text,
  inicio timestamptz not null default now(),
  fim timestamptz,
  tokens_entrada int default 0,
  tokens_saida int default 0,
  custo numeric(12,6) default 0,                  -- USD
  feedback smallint                               -- 1 = 👍, -1 = 👎
);
create index on tasks (user_id, inicio desc);
create index on tasks (status);

create table task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  ferramenta text not null,
  entrada jsonb,
  saida text,
  duracao_ms int,
  erro text,
  criado_em timestamptz not null default now()
);
create index on task_steps (task_id, criado_em);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  task_step_id uuid references task_steps(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  nivel text not null check (nivel in ('confirmar','pin','pin_voz')),
  ferramenta text not null,
  entrada jsonb not null,
  resumo text not null,
  status text not null default 'pendente'
    check (status in ('pendente','aprovada','recusada','expirada','executada','erro')),
  resultado text,
  criado_em timestamptz not null default now(),
  respondido_em timestamptz,
  expira_em timestamptz not null default now() + interval '30 minutes'
);
create index on approvals (user_id, status);

-- ---------------------------------------------------------------- memória
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  escopo text not null default 'pessoal' check (escopo in ('pessoal','empresa','equipe')),
  company_id uuid references companies(id) on delete set null,
  equipe text,
  camada text not null default 'longo_prazo' check (camada in ('longo_prazo','episodio','perfil')),
  tipo text not null default 'fato'
    check (tipo in ('perfil','pessoa','empresa','projeto','preferencia','episodio','fato')),
  conteudo text not null,
  embedding extensions.vector(1024),                         -- preenchido quando houver provedor de embeddings
  fts tsvector generated always as (to_tsvector('portuguese', unaccent_imm(conteudo))) stored,
  origem jsonb not null default '{}'::jsonb,      -- {canal, quem, quando, task_id}
  confianca real not null default 0.8,
  valido_ate timestamptz,
  substituida_por uuid references memories(id) on delete set null,
  sensivel boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index on memories using gin (fts);
create index on memories using gin (conteudo extensions.gin_trgm_ops);
create index on memories (user_id, escopo, criado_em desc);
create index on memories (tenant_id, company_id);

create table knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  titulo text not null,
  fonte text,
  conteudo text,
  trechos_embedding jsonb,
  fts tsvector generated always as (to_tsvector('portuguese', unaccent_imm(coalesce(titulo,'') || ' ' || coalesce(conteudo,'')))) stored,
  atualizado_em timestamptz not null default now()
);
create index on knowledge_docs using gin (fts);

create table daily_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  data date not null,
  resumo text not null,
  decisoes jsonb not null default '[]'::jsonb,
  pendencias jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  unique (user_id, data)
);

-- ---------------------------------------------------------------- cofre / filas / skills
create table vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  servico text not null,
  login text,
  segredo_criptografado text not null,
  "2fa_tipo" text,
  ultimo_uso timestamptz
);

create table task_queue (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  recurso text not null check (recurso in ('tela_pc','android','pc')),
  prioridade text not null default 'normal' check (prioridade in ('urgente','normal','quando_der')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pendente'
    check (status in ('pendente','entregue','executando','concluida','erro','cancelada')),
  resultado jsonb,
  criado_em timestamptz not null default now()
);

create table skills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  nome text not null,
  descricao text,
  passos_json jsonb not null default '[]'::jsonb,
  versao int not null default 1,
  usos int not null default 0,
  taxa_sucesso real not null default 1,
  status text not null default 'ativa' check (status in ('ativa','precisa_revisao','teste')),
  criado_em timestamptz not null default now(),
  unique (tenant_id, nome, versao)
);

create table routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  nome text not null,
  cron text,                                      -- ex.: '0 8 * * *' (America/Sao_Paulo)
  gatilho jsonb,                                  -- ex.: {"tipo":"email","de":"detran"} (Fase 3)
  instrucao text not null,                        -- o que o Jarvis deve fazer
  skill_id uuid references skills(id) on delete set null,
  canal_saida text not null default 'whatsapp',
  critica boolean not null default false,         -- passa pelo horário de silêncio
  ativa boolean not null default true,
  ultima_execucao timestamptz,
  criado_em timestamptz not null default now()
);

create table integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  tipo text not null,                             -- google, meta_ads, google_ads, crm, domma_chat, master_laudo
  tokens_criptografados text,
  config jsonb not null default '{}'::jsonb,
  escopos text[] not null default '{}',
  status text not null default 'ativa',
  atualizado_em timestamptz not null default now()
);
create unique index on integrations (tenant_id, tipo, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table audit_log (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete set null,
  acao text not null,
  alvo text,
  antes jsonb,
  depois jsonb,
  dispositivo text,
  data timestamptz not null default now()
);
create index on audit_log (user_id, data desc);

-- sessão do WhatsApp (Baileys) persistida no banco, sobrevive a redeploys
create table wa_auth (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- tentativas de números não cadastrados (registradas e ignoradas)
create table blocked_attempts (
  id bigint generated always as identity primary key,
  canal text not null,
  remetente text not null,
  conteudo text,
  data timestamptz not null default now()
);

-- ---------------------------------------------------------------- busca de memória
-- Combina texto completo (significado aproximado em PT), trigram (palavra parecida)
-- e recência. Respeita escopo: pessoal do próprio usuário + empresa/equipe liberadas.
create or replace function search_memories(p_user uuid, p_query text, p_limit int default 8)
returns table (id uuid, conteudo text, tipo text, escopo text, confianca real, criado_em timestamptz, score real)
language sql stable
set search_path = public, extensions
as $$
  with u as (select tenant_id from users where users.id = p_user),
  q as (select websearch_to_tsquery('portuguese', unaccent_imm(p_query)) as tsq)
  select m.id, m.conteudo, m.tipo, m.escopo, m.confianca, m.criado_em,
    ( coalesce(ts_rank(m.fts, q.tsq), 0) * 2
    + similarity(m.conteudo, p_query)
    + 0.3 / (1 + extract(epoch from now() - m.criado_em) / 86400 / 30)
    )::real * m.confianca as score
  from memories m, q, u
  where m.tenant_id = u.tenant_id
    and m.substituida_por is null
    and (m.valido_ate is null or m.valido_ate > now())
    and (
      (m.escopo = 'pessoal' and m.user_id = p_user)
      or (m.escopo = 'empresa' and (m.company_id is null or m.company_id in (select company_id from user_companies where user_id = p_user)))
      or (m.escopo = 'equipe')
    )
    and (m.fts @@ q.tsq or similarity(m.conteudo, p_query) > 0.1 or p_query = '')
  order by score desc
  limit p_limit
$$;

create or replace function custo_periodo(p_tenant uuid, p_desde timestamptz)
returns table (user_id uuid, nome text, dia date, tarefas bigint, custo numeric)
language sql stable
set search_path = public
as $$
  select t.user_id, u.nome, (t.inicio at time zone 'America/Sao_Paulo')::date as dia, count(*), sum(t.custo)
  from tasks t join users u on u.id = t.user_id
  where u.tenant_id = p_tenant and t.inicio >= p_desde
  group by 1, 2, 3 order by 3 desc, 5 desc
$$;

-- ---------------------------------------------------------------- RLS
-- Liga RLS em tudo, sem políticas: só o service role (backend) acessa.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

revoke execute on function search_memories(uuid, text, int) from anon, authenticated, public;
revoke execute on function custo_periodo(uuid, timestamptz) from anon, authenticated, public;

-- tenant inicial (uso interno). O primeiro login no painel vira o Dono.
insert into tenants (nome, plano) values ('Domma Tecnologia', 'interno');
insert into companies (tenant_id, nome)
select id, n from tenants, unnest(array['Domma','Master Laudo','RedBox','Auto Visão']) as n;
