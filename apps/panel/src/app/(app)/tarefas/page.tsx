import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { usd } from "@/lib/brain";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const ICON: Record<string, string> = { executando: "⏳", aguardando_aprovacao: "🔐", concluida: "✅", erro: "⚠️", cancelada: "⛔" };

export default async function Tarefas({ searchParams }: { searchParams: Promise<{ status?: string; todos?: string }> }) {
  const u = await requireUser();
  const { status, todos } = await searchParams;
  const verTodos = todos === "1" && u.perfil === "dono";
  const rows = await sql<{ id: string; pedido: string; status: string; canal: string; modelo: string; inicio: Date; fim: Date | null; custo: string; nome: string; passos: number; feedback: number | null }[]>`
    select t.id, t.pedido, t.status, t.canal, t.modelo, t.inicio, t.fim, t.custo, u.nome, t.feedback,
      (select count(*)::int from task_steps s where s.task_id = t.id) as passos
    from tasks t join users u on u.id = t.user_id
    where u.tenant_id = ${u.tenant_id}
      and (${verTodos} or t.user_id = ${u.id})
      and (${status ?? null}::text is null or t.status = ${status ?? null})
    order by t.inicio desc limit 200`;
  return (
    <div>
      <h1 className="title">Tarefas</h1>
      <div className="flex gap-2 mb-3 text-sm flex-wrap">
        {["", "executando", "aguardando_aprovacao", "concluida", "erro", "cancelada"].map((s) => (
          <Link key={s} href={`/tarefas?${new URLSearchParams({ ...(s ? { status: s } : {}), ...(verTodos ? { todos: "1" } : {}) })}`} className={`tag ${status === s || (!status && !s) ? "font-semibold" : ""}`}>
            {s ? `${ICON[s]} ${s.replace("_", " ")}` : "todas"}
          </Link>
        ))}
        {u.perfil === "dono" && (
          <Link href={verTodos ? "/tarefas" : "/tarefas?todos=1"} className="tag">
            {verTodos ? "só minhas" : "de todos os usuários"}
          </Link>
        )}
      </div>
      <div className="card overflow-x-auto">
        <table className="t">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Status</th>
              <th>Canal</th>
              <th>Passos</th>
              <th>Duração</th>
              <th>Custo</th>
              <th>Quando</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link className="underline" href={`/tarefas/${t.id}`}>
                    {t.pedido.slice(0, 90)}
                  </Link>
                  {verTodos && <div className="muted text-xs">{t.nome}</div>}
                </td>
                <td>
                  {ICON[t.status]} {t.feedback === 1 ? "👍" : t.feedback === -1 ? "👎" : ""}
                </td>
                <td>
                  <span className="tag">{t.canal}</span>
                </td>
                <td>{t.passos}</td>
                <td>{t.fim ? `${Math.round((+t.fim - +t.inicio) / 1000)} s` : "—"}</td>
                <td>{usd(t.custo)}</td>
                <td className="muted whitespace-nowrap">{t.inicio.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="muted text-sm p-2">Nenhuma tarefa ainda.</p>}
      </div>
    </div>
  );
}
