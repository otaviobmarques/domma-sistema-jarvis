import Link from "next/link";
import { Approval, Chat } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { usd } from "@/lib/brain";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Inicio() {
  const u = await requireUser();
  const [conv] = await sql<{ id: string }[]>`
    select id from conversations where user_id = ${u.id} and canal = 'painel' order by ultima_msg_em desc limit 1`;
  const [msgs, pend, rodando, hoje, journal] = await Promise.all([
    conv
      ? sql<{ autor: "user" | "assistant"; conteudo: string }[]>`
          select autor, conteudo from (select autor, conteudo, criado_em from messages where conversation_id = ${conv.id} and autor in ('user','assistant') order by criado_em desc limit 20) t order by criado_em`
      : Promise.resolve([]),
    sql<{ id: string; resumo: string; nivel: string }[]>`select id, resumo, nivel from approvals where user_id = ${u.id} and status = 'pendente' and expira_em > now() order by criado_em desc`,
    sql<{ id: string; pedido: string; status: string; canal: string; inicio: Date }[]>`
      select id, pedido, status, canal, inicio from tasks where user_id = ${u.id} and status in ('executando','aguardando_aprovacao') order by inicio desc limit 10`,
    sql<{ n: number; custo: string | null }[]>`
      select count(*)::int as n, sum(custo) as custo from tasks where user_id = ${u.id} and (inicio at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date`,
    sql<{ data: Date; resumo: string; pendencias: string[] }[]>`select data, resumo, pendencias from daily_journal where user_id = ${u.id} order by data desc limit 1`,
  ]);

  return (
    <div className="space-y-6">
      <h1 className="title">Olá, {u.nome.split(" ")[0]}</h1>
      {!u.whatsapp && (
        <div className="card text-sm">
          📱 Cadastre seu número de WhatsApp em <Link className="underline" href="/configuracoes">Autonomia e conta</Link> para falar com o Jarvis pelo celular.
        </div>
      )}
      {!u.tem_pin && (
        <div className="card text-sm">
          🔐 Defina seu PIN de 6 dígitos em <Link className="underline" href="/configuracoes">Autonomia e conta</Link> — ele confirma ações sensíveis.
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Chat inicial={msgs.map((m) => ({ autor: m.autor, texto: m.conteudo }))} />
        </div>
        <div className="space-y-4">
          <div className="card">
            <div className="muted text-xs">Hoje</div>
            <div className="text-2xl font-semibold">{hoje[0]?.n ?? 0} tarefas</div>
            <div className="muted text-sm">{usd(hoje[0]?.custo)} em IA</div>
          </div>
          <div>
            <h2 className="font-semibold mb-2">Aprovações pendentes</h2>
            {pend.length ? <div className="space-y-2">{pend.map((p) => <Approval key={p.id} id={p.id} resumo={p.resumo} nivel={p.nivel} />)}</div> : <p className="muted text-sm">Nada pendente.</p>}
          </div>
          <div>
            <h2 className="font-semibold mb-2">Em andamento</h2>
            {rodando.length ? (
              <ul className="space-y-1 text-sm">
                {rodando.map((t) => (
                  <li key={t.id}>
                    <Link className="underline" href={`/tarefas/${t.id}`}>
                      {t.status === "executando" ? "⏳" : "🔐"} {t.pedido.slice(0, 60)}
                    </Link>{" "}
                    <span className="tag">{t.canal}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted text-sm">Nenhuma tarefa rodando.</p>
            )}
          </div>
          {journal[0] && (
            <div className="card">
              <div className="muted text-xs">Resumo de {new Date(journal[0].data).toLocaleDateString("pt-BR")}</div>
              <p className="text-sm whitespace-pre-wrap">{journal[0].resumo}</p>
              {journal[0].pendencias?.length > 0 && (
                <ul className="text-sm list-disc ml-5 mt-2">
                  {journal[0].pendencias.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
