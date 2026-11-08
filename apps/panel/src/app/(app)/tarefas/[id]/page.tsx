import { notFound } from "next/navigation";
import { feedback } from "@/app/actions";
import { ActionButton } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { usd } from "@/lib/brain";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Tarefa({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t] = await sql<{ id: string; user_id: string; pedido: string; resposta: string | null; status: string; canal: string; modelo: string; inicio: Date; fim: Date | null; custo: string; tokens_entrada: number; tokens_saida: number; nome: string; plano_json: any }[]>`
    select t.*, u.nome from tasks t join users u on u.id = t.user_id
    where t.id = ${id} and u.tenant_id = ${u.tenant_id} and (t.user_id = ${u.id} or ${u.perfil} = 'dono')`;
  if (!t) notFound();
  const steps = await sql<{ id: string; ferramenta: string; entrada: unknown; saida: string | null; erro: string | null; duracao_ms: number; criado_em: Date }[]>`
    select id, ferramenta, entrada, saida, erro, duracao_ms, criado_em from task_steps where task_id = ${id} order by criado_em`;

  return (
    <div className="space-y-4">
      <h1 className="title">Tarefa</h1>
      <div className="card space-y-2 text-sm">
        <div>
          <b>Pedido:</b> {t.pedido}
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className="tag">{t.status}</span>
          <span className="tag">{t.canal}</span>
          <span className="tag">{t.modelo}</span>
          <span className="tag">{t.nome}</span>
          <span className="tag">
            {t.tokens_entrada.toLocaleString("pt-BR")} in / {t.tokens_saida.toLocaleString("pt-BR")} out
          </span>
          <span className="tag">{usd(t.custo)}</span>
          {t.fim && <span className="tag">{Math.round((+t.fim - +t.inicio) / 1000)} s</span>}
        </div>
        {t.plano_json?.chamadas?.length > 0 && (
          <div className="muted text-xs">
            Roteador: {t.plano_json.rota?.motivo} · chamadas ao Claude:{" "}
            {t.plano_json.chamadas.map((c: any) => `${(c.ms / 1000).toFixed(1)}s`).join(" + ")} (cache: {t.plano_json.chamadas.reduce((a: number, c: any) => a + c.cache, 0).toLocaleString("pt-BR")} tokens)
          </div>
        )}
      </div>
      <h2 className="font-semibold">Linha do tempo</h2>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="card text-sm">
            <div className="flex justify-between gap-2">
              <b>
                {s.erro ? "⚠️" : "🔧"} {s.ferramenta}
              </b>
              <span className="muted text-xs">
                {s.criado_em.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })} · {s.duracao_ms} ms
              </span>
            </div>
            <details className="mt-1">
              <summary className="muted text-xs cursor-pointer">entrada / saída</summary>
              <pre className="text-xs whitespace-pre-wrap mt-1">{JSON.stringify(s.entrada, null, 2)}</pre>
              <pre className="text-xs whitespace-pre-wrap mt-1">{(s.erro ?? s.saida ?? "").slice(0, 5000)}</pre>
            </details>
          </li>
        ))}
        {!steps.length && <p className="muted text-sm">Respondida sem usar ferramentas.</p>}
      </ol>
      {t.resposta && (
        <div className="card">
          <div className="muted text-xs mb-1">Resposta</div>
          <p className="text-sm whitespace-pre-wrap">{t.resposta}</p>
          {t.user_id === u.id && (
            <div className="flex gap-2 mt-2">
              <ActionButton label="👍" action={feedback.bind(null, t.id, 1)} />
              <ActionButton label="👎" action={feedback.bind(null, t.id, -1)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
