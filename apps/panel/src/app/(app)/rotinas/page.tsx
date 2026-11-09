import { rotinaAlternar, rotinaApagar, rotinaSalvar, skillApagar, skillStatus } from "@/app/actions";
import { ActionButton, RunRoutine } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const EXEMPLOS = [
  { nome: "Resumo da manhã", cron: "0 8 * * 1-5", instrucao: "Resuma meus e-mails não lidos importantes e a agenda de hoje. Destaque o que precisa de resposta." },
  { nome: "Campanhas da semana", cron: "0 17 * * 5", instrucao: "Relatório de desempenho das campanhas de Meta Ads dos últimos 7 dias, com alertas de CPA alto." },
];

export default async function Rotinas() {
  const u = await requireUser();
  const pode = u.perfil === "dono" || u.perfil === "gestor";
  const [rotinas, skills] = await Promise.all([
    sql<{ id: string; nome: string; cron: string; instrucao: string; ativa: boolean; critica: boolean; ultima_execucao: Date | null }[]>`
      select id, nome, cron, instrucao, ativa, critica, ultima_execucao from routines where user_id = ${u.id} order by criado_em`,
    sql<{ id: string; nome: string; descricao: string | null; versao: number; usos: number; taxa_sucesso: number; status: string; passos_json: { ferramenta: string | null; instrucao: string }[]; gatilhos: string[]; ultimo_uso: Date | null; compartilhada: boolean }[]>`
      select id, nome, descricao, versao, usos, taxa_sucesso, status, passos_json, gatilhos, ultimo_uso, user_id is null as compartilhada
      from skills where tenant_id = ${u.tenant_id} and (user_id = ${u.id} or user_id is null)
      order by status = 'ativa' desc, usos desc, nome`,
  ]);

  return (
    <div className="space-y-6">
      <h1 className="title">Skills e rotinas</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">Rotinas (piloto automático)</h2>
        <p className="muted text-sm">O Tavinho executa a instrução no horário (fuso de São Paulo) e manda o resultado no seu WhatsApp. Também dá para criar falando: “toda sexta às 17h me manda o resumo das campanhas”.</p>
        {rotinas.map((r) => (
          <div key={r.id} className="card flex gap-3 justify-between flex-wrap">
            <div className="text-sm">
              <b>
                {r.ativa ? "✅" : "⏸️"} {r.nome}
              </b>{" "}
              <span className="tag">{r.cron}</span> {r.critica && <span className="tag">crítica</span>}
              <p className="mt-1">{r.instrucao}</p>
              <p className="muted text-xs">{r.ultima_execucao ? `Última execução: ${r.ultima_execucao.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "Ainda não executou"}</p>
            </div>
            {pode && (
              <div className="flex gap-2 items-start">
                <RunRoutine id={r.id} />
                <ActionButton label={r.ativa ? "Pausar" : "Ativar"} action={rotinaAlternar.bind(null, r.id, !r.ativa)} />
                <ActionButton label="Apagar" confirmText="Apagar esta rotina?" action={rotinaApagar.bind(null, r.id)} />
              </div>
            )}
          </div>
        ))}
        {!rotinas.length && <p className="muted text-sm">Nenhuma rotina ainda.</p>}

        {pode && (
          <form action={rotinaSalvar} className="card space-y-2">
            <div className="font-medium text-sm">Nova rotina</div>
            <div className="grid md:grid-cols-3 gap-2">
              <input name="nome" className="input" placeholder="Nome" required />
              <input name="cron" className="input" placeholder="Cron: 0 8 * * * (todo dia 8h)" required />
              <label className="text-sm flex items-center gap-2">
                <input type="checkbox" name="critica" /> crítica (ignora horário de silêncio)
              </label>
            </div>
            <textarea name="instrucao" className="input" rows={2} placeholder="O que o Tavinho deve fazer" required />
            <button className="btn">Criar</button>
            <p className="muted text-xs">Exemplos: {EXEMPLOS.map((e) => `“${e.nome}” (${e.cron})`).join(" · ")}. Cron: minuto hora dia mês dia-da-semana.</p>
          </form>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Skills aprendidas</h2>
        <p className="muted text-sm">
          Quando uma tarefa de várias etapas dá certo, o assistente guarda o caminho como uma skill. Num pedido parecido, ele já sabe o que fazer. Cada uso conta acerto ou erro (inclusive o 👎 numa tarefa); skills que falham muito vão para revisão e deixam de ser usadas.
        </p>
        {skills.map((s) => {
          const podeMexer = !s.compartilhada || pode;
          return (
            <details key={s.id} className="card text-sm">
              <summary className="cursor-pointer flex flex-wrap items-center gap-2">
                <b>{s.status === "ativa" ? "🧠" : "⚠️"} {s.nome}</b>
                <span className="tag">v{s.versao}</span>
                <span className="tag">{s.usos} {s.usos === 1 ? "uso" : "usos"}</span>
                <span className="tag">{Math.round(s.taxa_sucesso * 100)}% de acerto</span>
                {s.status !== "ativa" && <span className="tag">em revisão</span>}
                {s.compartilhada && <span className="tag">da empresa</span>}
              </summary>
              <div className="mt-3 space-y-2">
                {s.descricao && <p>{s.descricao}</p>}
                {!!s.gatilhos?.length && <p className="muted text-xs">Pedidos parecidos: {s.gatilhos.map((g) => `“${g}”`).join(" · ")}</p>}
                <ol className="list-decimal ml-5 space-y-1">
                  {s.passos_json.map((p, i) => (
                    <li key={i}>
                      {p.ferramenta && <code className="text-xs">{p.ferramenta}</code>} {p.instrucao}
                    </li>
                  ))}
                </ol>
                <p className="muted text-xs">{s.ultimo_uso ? `Último uso: ${s.ultimo_uso.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : "Ainda não foi reutilizada"}</p>
                {podeMexer && (
                  <div className="flex gap-2">
                    <ActionButton label={s.status === "ativa" ? "Pôr em revisão" : "Reativar"} action={skillStatus.bind(null, s.id, s.status === "ativa" ? "precisa_revisao" : "ativa")} />
                    <ActionButton label="Apagar" confirmText={`Apagar a skill “${s.nome}”?`} action={skillApagar.bind(null, s.id)} />
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {!skills.length && <p className="muted text-sm">Nenhuma skill ainda. Elas aparecem sozinhas conforme você usa o assistente em tarefas de várias etapas.</p>}
      </section>
    </div>
  );
}
