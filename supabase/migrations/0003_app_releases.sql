-- Versões publicadas do app de PC (o botão "Atualizar" do app consulta /device/versao)
create table if not exists app_releases (
  id bigint generated always as identity primary key,
  plataforma text not null default 'windows',
  versao text not null,
  url text not null,
  notas text,
  publicado_em timestamptz not null default now(),
  unique (plataforma, versao)
);
alter table app_releases enable row level security;
create policy backend_all on app_releases for all to jarvis_backend using (true) with check (true);
grant all on app_releases to jarvis_backend;
grant all on sequence app_releases_id_seq to jarvis_backend;
