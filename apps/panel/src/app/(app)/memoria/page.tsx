import Link from "next/link";
import { memoriaApagar, memoriaSalvar } from "@/app/actions";
import { ActionButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const TIPOS = ["perfil", "pessoa", "empresa", "projeto", "preferencia", "fato", "episodio"];

export default async function Memoria({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string; escopo?: string; aba?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const aba = sp.aba ?? "fatos";
  const podeEditar = u.perfil === "dono" || u.perfil === "gestor";

  const rows =
    aba === "fatos"
      ? sp.q
        ? await sql<any[]>`select m.*, s.score from search_memories(${u.id}, ${sp.q}, 50) s join memories m on m.id = s.id`
        : await sql<any[]>`
          select * from memories
          where tenant_id = ${u.tenant_id} and substituida_por is null
            and ((escopo = 'pessoal' and user_id = ${u.id})
              or escopo = 'equipe'
              or (escopo = 'empresa' and (${u.perfil} = 'dono' or company_id is null
                  or company_id in (select company_id from user_companies where user_id = ${u.id}))))
            and (${sp.tipo ?? null}::text is null or tipo = ${sp.tipo ?? null})
            and (${sp.escopo ?? null}::text is null or escopo = ${sp.escopo ?? null})
          order by atualizado_em desc limit 300`
      : [];
  const diario = aba === "diario" ? await sql<any[]>`select * from daily_journal where user_id = ${u.id} order by data desc limit 60` : [];
  const historico =
    aba === "historico"
      ? await sql<any[]>`select m.conteudo, m.atualizado_em, n.conteudo as novo from memories m left join memories n on n.id = m.substituida_por
          where m.user_id = ${u.id} and m.substituida_por is not null order by m.atualizado_em desc limit 100`
      : [];

  const Tab = ({ id, label }: { id: string; label: string }) => (
    <Link href={`/memoria?aba=${id}`} className={`tag ${aba === id ? "font-semibold" : ""}`}>
      {label}
    </Link>
  );

  return (
    <div className="space-y-4">
      <h1 className="title">Memória</h1>
      <p className="muted text-sm">Tudo o que o Jarvis sabe, por camada e escopo. Nada de caixa-preta: veja, edite e apague.</p>
      <div className="flex gap-2">
        <Tab id="fatos" label="Fatos (longo prazo)" />
        <Tab id="diario" label="Diário automático" />
        <Tab id="historico" label="Histórico de correções" />
      </div>

      {aba === "fatos" && (
        <>
          <form className="flex gap-2 flex-wrap">
            <input type="hidden" name="aba" value="fatos" />
            <input name="q" defaultValue={sp.q} className="input max-w-md" placeholder="Buscar por significado ou palavra…" />
            <select name="tipo" defaultValue={sp.tipo ?? ""} className="input max-w-[10rem]">
              <option value="">todos os tipos</option>
              {TIPOS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select name="escopo" defaultValue={sp.escopo ?? ""} className="input max-w-[10rem]">
              <option value="">todos os escopos</option>
              <option>pessoal</option>
              <option>empresa</option>
              <option>equipe</option>
            </select>
            <button className="btn btn-ghost">Filtrar</button>
          </form>

          {podeEditar && (
            <form action={memoriaSalvar} className="card flex gap-2 flex-wrap items-center">
              <input name="conteudo" className="input flex-1 min-w-[16rem]" placeholder="Novo fato: ex. “A Juliana é a gerente da loja de Contagem”" />
              <select name="tipo" className="input max-w-[9rem]" defaultValue="fato">
                {TIPOS.slice(0, 6).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select name="escopo" className="input max-w-[9rem]" defaultValue="pessoal">
                <option>pessoal</option>
                <option>empresa</option>
                <option>equipe</option>
              </select>
              <button className="btn">Adicionar</button>
            </form>
          )}

          <div className="space-y-2">
            {rows.map((m) => (
              <div key={m.id} className="card">
                {podeEditar ? (
                  <form action={memoriaSalvar} className="flex gap-2 flex-wrap items-start">
                    <input type="hidden" name="id" value={m.id} />
                    <textarea name="conteudo" defaultValue={m.conteudo} className="input flex-1 min-w-[16rem]" rows={2} />
                    <select name="tipo" defaultValue={m.tipo} className="input max-w-[9rem]">
                      {TIPOS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                    <select name="escopo" defaultValue={m.escopo} className="input max-w-[9rem]">
                      <option>pessoal</option>
                      <option>empresa</option>
                      <option>equipe</option>
                    </select>
                    <button className="btn btn-ghost">Salvar</button>
                    <ActionButton label="Apagar" confirmText="Apagar esta memória?" action={memoriaApagar.bind(null, m.id)} />
                  </form>
                ) : (
                  <p className="text-sm">{m.conteudo}</p>
                )}
                <div className="muted text-xs mt-1 flex gap-3 flex-wrap">
                  <span>{m.camada}</span>
                  <span>confiança {Number(m.confianca).toFixed(1)}</span>
                  <span>
                    origem: {m.origem?.canal ?? "?"}
                    {m.origem?.auto ? " (automática)" : ""}
                  </span>
                  <span>{new Date(m.atualizado_em).toLocaleDateString("pt-BR")}</span>
                  {m.sensivel && <span>🔒 sensível</span>}
                </div>
              </div>
            ))}
            {!rows.length && <p className="muted text-sm">Nada por aqui ainda. A memória cresce conforme você conversa com o Jarvis.</p>}
          </div>
        </>
      )}

      {aba === "diario" && (
        <div className="space-y-2">
          {diario.map((d) => (
            <div key={d.id} className="card text-sm">
              <b>{new Date(d.data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</b>
              <p className="whitespace-pre-wrap">{d.resumo}</p>
              {d.decisoes?.length > 0 && <p className="mt-1"><b>Decisões:</b> {d.decisoes.join("; ")}</p>}
              {d.pendencias?.length > 0 && <p><b>Pendências:</b> {d.pendencias.join("; ")}</p>}
            </div>
          ))}
          {!diario.length && <p className="muted text-sm">O diário é gerado automaticamente às 23h30 nos dias com atividade.</p>}
        </div>
      )}

      {aba === "historico" && (
        <div className="card overflow-x-auto">
          <table className="t">
            <thead>
              <tr>
                <th>Antes</th>
                <th>Corrigido para</th>
                <th>Quando</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h, i) => (
                <tr key={i}>
                  <td>{h.conteudo}</td>
                  <td>{h.novo}</td>
                  <td className="muted">{new Date(h.atualizado_em).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
