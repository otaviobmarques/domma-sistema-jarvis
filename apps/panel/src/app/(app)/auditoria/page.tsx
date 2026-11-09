import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Auditoria({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await requireUser(["dono"]);
  const { q } = await searchParams;
  const rows = await sql<{ id: number; acao: string; alvo: string | null; antes: unknown; depois: unknown; dispositivo: string | null; data: Date; nome: string | null }[]>`
    select a.id, a.acao, a.alvo, a.antes, a.depois, a.dispositivo, a.data, x.nome
    from audit_log a left join users x on x.id = a.user_id
    where (x.tenant_id = ${u.tenant_id} or (a.user_id is null and (${u.plataforma} or a.alvo = ${u.tenant_id})))
      and (${q ?? null}::text is null or a.acao ilike ${"%" + (q ?? "") + "%"})
    order by a.data desc limit 300`;
  return (
    <div className="space-y-4">
      <h1 className="title">Auditoria</h1>
      <p className="muted text-sm">Registro de tudo que o Tavinho e os usuários fizeram: aprovações, envios, alterações de memória, integrações, pânico.</p>
      <form>
        <input name="q" defaultValue={q} className="input max-w-sm" placeholder="Filtrar por ação (ex.: whatsapp, aprovacao, memoria)" />
      </form>
      <div className="card overflow-x-auto">
        <table className="t">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>Ação</th>
              <th>Alvo</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted whitespace-nowrap">{r.data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                <td>{r.nome ?? "sistema"}</td>
                <td>
                  <span className="tag">{r.acao}</span>
                </td>
                <td className="text-xs">{r.alvo}</td>
                <td>
                  {(r.antes != null || r.depois != null) && (
                    <details>
                      <summary className="muted text-xs cursor-pointer">ver</summary>
                      <pre className="text-xs whitespace-pre-wrap">{JSON.stringify({ antes: r.antes, depois: r.depois }, null, 2).slice(0, 3000)}</pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
