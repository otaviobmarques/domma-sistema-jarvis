import { assinar } from "@/app/actions";
import { FormWithResult } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { brain, usd } from "@/lib/brain";

export const dynamic = "force-dynamic";

const brl = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

const STATUS: Record<string, [string, string]> = {
  teste: ["Em teste grátis", "#6f5cf6"],
  ativo: ["Ativa", "#10b981"],
  inadimplente: ["Fatura em atraso", "#f59e0b"],
  bloqueado: ["Suspensa", "#ef4444"],
  cancelado: ["Cancelada", "#94a3b8"],
};
const FATURA: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  RECEIVED: "Paga",
  CONFIRMED: "Paga",
  RECEIVED_IN_CASH: "Paga",
  OVERDUE: "Vencida",
  REFUNDED: "Estornada",
  CANCELED: "Cancelada",
};

export default async function Assinatura() {
  const u = await requireUser(["dono"]);
  if (u.plataforma) {
    return (
      <div className="space-y-4">
        <h1 className="title">Assinatura</h1>
        <p className="muted">Esta é a conta da plataforma (Domma): não tem cobrança. Os clientes ficam em <a className="underline" href="/plataforma">Plataforma</a>.</p>
      </div>
    );
  }
  const a = await brain<any>("/api/assinatura", u.id);
  const t = a.tenant;
  const [rotulo, cor] = STATUS[t.status] ?? [t.status, "#94a3b8"];
  const valor = Number(a.usuarios) * Number(a.preco);
  const aberta = (a.cobrancas as any[]).find((c) => ["PENDING", "OVERDUE"].includes(c.status));

  return (
    <div className="space-y-6">
      <h1 className="title">Assinatura</h1>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card space-y-1">
          <div className="muted text-sm">Situação</div>
          <div className="text-lg font-semibold flex items-center gap-2">
            <span className="dot" style={{ background: cor }} /> {rotulo}
          </div>
          {t.status === "teste" && <div className="text-sm muted">Grátis até {data(t.teste_ate)}{a.situacao?.diasTeste ? ` (${a.situacao.diasTeste} dias)` : ""}</div>}
          {a.situacao?.motivo && <div className="text-sm" style={{ color: cor }}>{a.situacao.motivo}</div>}
        </div>
        <div className="card space-y-1">
          <div className="muted text-sm">Valor mensal</div>
          <div className="text-lg font-semibold">{brl(valor)}</div>
          <div className="text-sm muted">
            {a.usuarios} {a.usuarios === 1 ? "usuário ativo" : "usuários ativos"} × {brl(a.preco)}
          </div>
        </div>
        <div className="card space-y-1">
          <div className="muted text-sm">Uso de IA incluso</div>
          <div className="text-lg font-semibold">{usd(Number(a.limite_ia_usuario_usd) * Math.max(1, a.usuarios))} / mês</div>
          <div className="text-sm muted">Franquia somada de todos os usuários. Ao acabar, o assistente pausa até o mês seguinte.</div>
        </div>
      </div>

      {aberta?.link && (
        <div className="card flex flex-wrap items-center justify-between gap-3" style={{ borderColor: aberta.status === "OVERDUE" ? "#f59e0b" : undefined }}>
          <div className="text-sm">
            <b>{aberta.status === "OVERDUE" ? "Fatura vencida" : "Próxima fatura"}:</b> {brl(aberta.valor)} · vence em {data(aberta.vencimento)}
          </div>
          <a className="btn" href={aberta.link} target="_blank" rel="noreferrer">
            Pagar (Pix, boleto ou cartão)
          </a>
        </div>
      )}

      {!t.tem_assinatura && t.status !== "cancelado" && (
        <div className="card space-y-2">
          <div className="font-medium">Assinar agora</div>
          <p className="text-sm muted">
            {a.asaas
              ? `A primeira fatura vence ${t.status === "teste" ? `no fim do teste (${data(t.teste_ate)})` : "hoje"}. O valor acompanha o número de usuários ativos.`
              : "A cobrança online ainda está sendo configurada pela Domma. Fale com a gente para assinar."}
          </p>
          {a.asaas && (
            <FormWithResult action={assinar}>
              <button className="btn">Assinar o Tavinho</button>
            </FormWithResult>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="font-medium mb-2">Faturas</div>
        {a.cobrancas.length ? (
          <table className="t">
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Situação</th>
                <th>Forma</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {a.cobrancas.map((c: any, i: number) => (
                <tr key={i}>
                  <td>{data(c.vencimento)}</td>
                  <td>{brl(c.valor)}</td>
                  <td>
                    <span className="tag">{FATURA[c.status] ?? c.status}</span>
                  </td>
                  <td className="muted">{c.forma && c.forma !== "UNDEFINED" ? c.forma : "—"}</td>
                  <td>
                    {c.link && (
                      <a className="underline text-sm" href={c.link} target="_blank" rel="noreferrer">
                        {["PENDING", "OVERDUE"].includes(c.status) ? "Pagar" : "Ver"}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted text-sm">Nenhuma fatura ainda.</p>
        )}
      </div>

      <p className="muted text-xs">
        Para adicionar ou remover pessoas, use <a className="underline" href="/usuarios">Usuários e permissões</a> — o valor da assinatura se ajusta sozinho. Para cancelar, fale com a Domma.
      </p>
    </div>
  );
}
