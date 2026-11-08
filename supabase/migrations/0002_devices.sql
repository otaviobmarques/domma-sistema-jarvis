-- Fase 2: pareamento e autenticação de dispositivos (app de PC / Android)
alter table devices add column if not exists token_hash text;
alter table devices add column if not exists info jsonb not null default '{}'::jsonb;
alter table devices add column if not exists ativo boolean not null default true;
create unique index if not exists devices_token_hash_idx on devices (token_hash) where token_hash is not null;

create table if not exists device_pairings (
  codigo text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expira_em timestamptz not null default now() + interval '10 minutes',
  usado_em timestamptz
);
alter table device_pairings enable row level security;
create policy backend_all on device_pairings for all to jarvis_backend using (true) with check (true);
grant all on device_pairings to jarvis_backend;

alter table task_queue add column if not exists acao text;
alter table task_queue add column if not exists concluido_em timestamptz;
