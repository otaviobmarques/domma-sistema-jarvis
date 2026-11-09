-- Fase 4: skills que aprendem.
-- Uma skill é um procedimento genérico que funcionou ("como fazer X"), aprendido de uma tarefa
-- de várias etapas. Quando chega um pedido parecido, ela entra no contexto do assistente.

alter table skills add column if not exists user_id uuid references users(id) on delete cascade;
alter table skills add column if not exists gatilhos text[] not null default '{}';
alter table skills add column if not exists ferramentas text[] not null default '{}';
alter table skills add column if not exists busca text not null default '';
alter table skills add column if not exists origem_task_id uuid references tasks(id) on delete set null;
alter table skills add column if not exists ultimo_uso timestamptz;
alter table skills add column if not exists atualizado_em timestamptz not null default now();

create index if not exists skills_busca_trgm on skills using gin (busca extensions.gin_trgm_ops);
create index if not exists skills_user on skills (user_id);

-- Quais skills foram oferecidas em cada tarefa (para medir uso e sucesso)
alter table tasks add column if not exists skills_ofertadas uuid[] not null default '{}';

-- skills agora são por usuário: o nome só precisa ser único dentro de cada usuário
alter table skills drop constraint if exists skills_tenant_id_nome_versao_key;
create unique index if not exists skills_user_nome_versao on skills (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), tenant_id, nome, versao);
