-- Multiusuário: o dono enxerga as memórias de todas as empresas do grupo;
-- os demais perfis, só as das empresas liberadas para eles (e as da equipe).
create or replace function search_memories(p_user uuid, p_query text, p_limit int default 8)
returns table (id uuid, conteudo text, tipo text, escopo text, confianca real, criado_em timestamptz, score real)
language sql stable
set search_path = public, extensions
as $$
  with u as (select tenant_id, perfil from users where users.id = p_user),
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
      or (m.escopo = 'empresa' and (u.perfil = 'dono' or m.company_id is null or m.company_id in (select company_id from user_companies where user_id = p_user)))
      or (m.escopo = 'equipe')
    )
    and (m.fts @@ q.tsq or similarity(m.conteudo, p_query) > 0.1 or p_query = '')
  order by score desc
  limit p_limit
$$;
