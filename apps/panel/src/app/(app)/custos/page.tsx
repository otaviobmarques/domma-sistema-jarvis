import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { usd } from "@/lib/brain";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

async function salvarLimite(form: FormData) {
  "use server";
  const u = await requireUser(["dono"]);
  const id = String(form.get("id"));
  const brl = Number(form.get("limite_brl") ?? 0);
  const usdV = brl / Number(process.env.USD_BRL ?? 5.5);
  await sql`update users set limite_mensal_usd = ${usdV} where id = ${id} and tenant_id = ${u.tenant_id}`;
  revalidatePath("/custos");
}

export default async function Custos() {
  const u = await requireUser(["dono", "gestor"]);
  const rate = Number(process.env.USD_BRL ?? 5.5);
  const [porDia, porUsuario, ferramentas, indicadores] = await Promise.all([
    sql<{ dia: Date; tarefas: number; custo: string }[]>`
      select (t.inicio at time zone 'America/Sao_Paulo')::date as dia, count(*)::int as tarefas, sum(t.custo) as custo
      from tasks t join users x on x.id = t.user_id where x.tenant_id = ${u.tenant_id} and t.inicio > now() - interval '30 days'
      group by 1 order by 1 desc`,
    sql<{ id: string; nome: string; mes: string | null; limite: string | null }[]>`
      select x.id, x.nome, x.limite_mensal_usd as limite,
        (select sum(custo) from tasks t where t.user_id = x.id and t.inicio >= date_trunc('month', now() at time zone 'America/Sao_Paulo')) as mes
      from users x where x.tenant_id = ${u.tenant_id} order by mes desc nulls last`,
    sql<{ ferramenta: string; usos: number; erros: number; ms: number }[]>`
      select s.ferramenta, count(*)::int as usos, count(s.erro)::int as erros, avg(s.duracao_ms)::int as ms
      from task_steps s join tasks t on t.id = s.task_id join users x on x.id = t.user_id
      where x.tenant_id = ${u.tenant_id} and s.criado_em > now() - interval '30 days'
      group by 1 order by erros desc, usos desc limit 30`,
    sql<{ total: number; ok: number; seg: number; bons: number; ruins: number; abandonadas: number }[]>`
      select count(*)::int as total, count(*) filter (where status = 'concluida')::int as ok,
        coalesce(avg(extract(epoch from fim - inicio)) filter (where fim is not null), 0)::int as seg,
        count(*) filter (where feedback = 1)::int as bons, count(*) filter (where feedback = -1)::int as ruins,
        count(*) filter (where status in ('cancelada','erro'))::int as abandonadas
      from tasks t join users x on x.id = t.user_id where x.tenant_id = ${u.tenant_id} and t.inicio > now() - interval '30 days'`,
  ]);
  const ind = indicadores[0]!;

  return (
    <div className="space-y-6">
      <h1 className="title">Custos e indicadores (30 dias)</h1>
      <div className="grid md:grid-cols-4 gap-3">
        <div className="card">
          <div className="muted text-xs">Tarefas</div>
          <div className="text-xl font-semibold">{ind.total}</div>
        </div>
        <div className="card">
          <div className="muted text-xs">Taxa de sucesso</div>
          <div className="text-xl font-semibold">{ind.total ? Math.round((ind.ok / ind.total) * 100) : 0}%</div>
        </div>
        <div className="card">
          <div className="muted text-xs">Tempo médio</div>
          <div className="text-xl font-semibold">{ind.seg} s</div>
        </div>
        <div className="card">
          <div className="muted text-xs">Satisfação</div>
          <div className="text-xl font-semibold">
            👍 {ind.bons} · 👎 {ind.ruins}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="font-medium mb-2">Por usuário (mês atual) e limite mensal</div>
        <table className="t">
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Gasto no mês</th>
              <th>Limite</th>
              <th>Uso</th>
            </tr>
          </thead>
          <tbody>
            {porUsuario.map((x) => {
              const pct = x.limite && Number(x.limite) > 0 ? Math.round((Number(x.mes ?? 0) / Number(x.limite)) * 100) : 0;
              return (
                <tr key={x.id}>
                  <td>{x.nome}</td>
                  <td>{usd(x.mes)}</td>
                  <td>
                    {u.perfil === "dono" ? (
                      <form action={salvarLimite} className="flex gap-1">
                        <input type="hidden" name="id" value={x.id} />
                        <input name="limite_brl" className="input max-w-[8rem]" defaultValue={(Number(x.limite ?? 0) * rate).toFixed(0)} />
                        <button className="btn btn-ghost">ok</button>
                      </form>
                    ) : (
                      usd(x.limite)
                    )}
                  </td>
                  <td className={pct >= 80 ? "text-red-600 font-semibold" : ""}>{pct}%{pct >= 80 ? " ⚠️" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card overflow-x-auto">
          <div className="font-medium mb-2">Por dia</div>
          <table className="t">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Tarefas</th>
                <th>Custo</th>
              </tr>
            </thead>
            <tbody>
              {porDia.map((d) => (
                <tr key={String(d.dia)}>
                  <td>{new Date(d.dia).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</td>
                  <td>{d.tarefas}</td>
                  <td>{usd(d.custo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card overflow-x-auto">
          <div className="font-medium mb-2">Ferramentas (erros e tempo)</div>
          <table className="t">
            <thead>
              <tr>
                <th>Ferramenta</th>
                <th>Usos</th>
                <th>Erros</th>
                <th>Média</th>
              </tr>
            </thead>
            <tbody>
              {ferramentas.map((f) => (
                <tr key={f.ferramenta}>
                  <td>{f.ferramenta}</td>
                  <td>{f.usos}</td>
                  <td className={f.erros ? "text-red-600" : ""}>{f.erros}</td>
                  <td>{f.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="muted text-xs">Valores em reais com câmbio de referência {rate.toFixed(2)} (variável USD_BRL).</p>
    </div>
  );
}
