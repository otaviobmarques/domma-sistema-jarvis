import { redirect } from "next/navigation";
import { plataformaAsaas, plataformaCliente, plataformaConfig, plataformaPreco } from "@/app/actions";
import { ActionButton, FormWithResult } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { brain, usd } from "@/lib/brain";

export const dynamic = "force-dynamic";

const brl = (v: number | string | null | undefined) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const COR: Record<string, string> = { teste: "#6f5cf6", ativo: "#10b981", inadimplente: "#f59e0b", bloqueado: "#ef4444", cancelado: "#94a3b8" };
const doc = (d: string | null) =>
  !d ? "—" : d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");

export default async function Plataforma() {
  const u = await requireUser(["dono"]);
  if (!u.plataforma) redirect("/?erro=sem-permissao");
  const p = await brain<any>("/api/plataforma", u.id);
  const clientes: any[] = p.clientes;
  const pagantes = clientes.filter((c) => c.status === "ativo");
  const mrr = pagantes.reduce((s, c) => s + Number(c.valor_mensal ?? 0), 0);
  const emTeste = clientes.filter((c) => c.status === "teste").length;
  const custoIa = clientes.reduce((s, c) => s + Number(c.custo_ia_mes ?? 0), 0);

  return (
    <div className="space-y-6">
      <h1 className="title">Plataforma</h1>
      <p className="muted text-sm">Os clientes do Tavinho. Cada um é um ambiente separado, com os próprios usuários, memória e integrações.</p>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="card">
          <div className="muted text-sm">Receita mensal (ativos)</div>
          <div className="text-2xl font-semibold">{brl(mrr)}</div>
        </div>
        <div className="card">
          <div className="muted text-sm">Clientes ativos</div>
          <div className="text-2xl font-semibold">{pagantes.length}</div>
        </div>
        <div className="card">
          <div className="muted text-sm">Em teste</div>
          <div className="text-2xl font-semibold">{emTeste}</div>
        </div>
        <div className="card">
          <div className="muted text-sm">Custo de IA no mês (clientes)</div>
          <div className="text-2xl font-semibold">{usd(custoIa)}</div>
        </div>
      </div>

      <div className="card space-y-2">
        <div className="font-medium">
          Cadastro público: <a className="underline" href="/cadastro" target="_blank">jarvis.dommasistemas.com.br/cadastro</a>
        </div>
        <p className="muted text-sm">Mande esse link para quem quiser testar. A pessoa cria a conta, ganha o período de teste e a primeira fatura vence no fim dele.</p>
      </div>

      <div className="space-y-2">
        {clientes.map((c) => (
          <details key={c.id} className="card text-sm">
            <summary className="cursor-pointer flex flex-wrap items-center gap-2">
              <span className="dot" style={{ background: COR[c.status] ?? "#94a3b8" }} />
              <b>{c.nome}</b>
              <span className="tag">{c.status}</span>
              <span className="tag">{c.usuarios} usuários</span>
              <span className="tag">{brl(c.valor_mensal)}/mês</span>
              <span className="tag">IA: {usd(c.custo_ia_mes)}</span>
              {c.status === "teste" && <span className="muted">teste até {data(c.teste_ate)}</span>}
            </summary>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div>CNPJ/CPF: {doc(c.documento)}</div>
                <div>E-mail: {c.email_cobranca ?? "—"}</div>
                <div>WhatsApp: {c.telefone ? `+${c.telefone}` : "—"}</div>
                <div>Cliente desde: {data(c.criado_em)} · último uso: {c.ultimo_uso ? data(c.ultimo_uso) : "nunca"}</div>
                <div>Assinatura no Asaas: {c.tem_assinatura ? "sim" : "não"} {c.atraso_desde && <span style={{ color: "#f59e0b" }}>· em atraso desde {data(c.atraso_desde)}</span>}</div>
              </div>
              <div className="space-y-2">
                <FormWithResult action={plataformaPreco} className="flex flex-wrap gap-2 items-center">
                  <input type="hidden" name="id" value={c.id} />
                  <input name="preco" className="input max-w-[9rem]" placeholder={`padrão ${brl(p.config.preco_usuario)}`} defaultValue={c.preco_usuario ?? ""} />
                  <button className="btn btn-ghost">Preço por usuário</button>
                </FormWithResult>
                <div className="flex flex-wrap gap-2">
                  {c.status !== "ativo" && <ActionButton label="Ativar" action={plataformaCliente.bind(null, c.id, "ativar", {})} />}
                  {c.status !== "bloqueado" && <ActionButton label="Bloquear" confirmText={`Bloquear ${c.nome}? O assistente para de responder para a equipe.`} action={plataformaCliente.bind(null, c.id, "bloquear", {})} />}
                  <ActionButton label="+7 dias de teste" action={plataformaCliente.bind(null, c.id, "estender_teste", { dias: 7 })} />
                  {!c.tem_assinatura && p.asaas.configurado && <ActionButton label="Criar assinatura" action={plataformaCliente.bind(null, c.id, "criar_assinatura", {})} />}
                  {c.tem_assinatura && <ActionButton label="Recalcular valor" action={plataformaCliente.bind(null, c.id, "sincronizar", {})} />}
                  {c.status !== "cancelado" && (
                    <ActionButton label="Cancelar assinatura" confirmText={`Cancelar a assinatura de ${c.nome}? As faturas futuras deixam de ser geradas.`} action={plataformaCliente.bind(null, c.id, "cancelar", {})} />
                  )}
                </div>
              </div>
            </div>
          </details>
        ))}
        {!clientes.length && <p className="muted text-sm">Nenhum cliente ainda.</p>}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <div className="font-medium">Preços e regras</div>
          <FormWithResult action={plataformaConfig} className="space-y-2 text-sm">
            <label className="block">
              Preço por usuário ativo / mês (R$)
              <input name="preco_usuario" className="input mt-1" defaultValue={p.config.preco_usuario} required />
            </label>
            <label className="block">
              Dias de teste grátis
              <input name="dias_teste" className="input mt-1" defaultValue={p.config.dias_teste} required />
            </label>
            <label className="block">
              Franquia de IA por usuário / mês (US$)
              <input name="limite_ia_usuario_usd" className="input mt-1" defaultValue={p.config.limite_ia_usuario_usd} required />
            </label>
            <label className="block">
              Dias de atraso antes de suspender
              <input name="tolerancia_dias" className="input mt-1" defaultValue={p.config.tolerancia_dias} required />
            </label>
            <button className="btn">Salvar</button>
          </FormWithResult>
        </div>

        <div className="card space-y-3 text-sm">
          <div className="font-medium">Cobrança (Asaas) {p.asaas.configurado ? "✅" : "— não configurada"}</div>
          <ol className="list-decimal ml-5 space-y-1">
            <li>
              No Asaas: <b>Integrações → Chaves de API</b> → gere uma chave e cole abaixo.
            </li>
            <li>
              Em <b>Integrações → Webhooks</b>, crie um webhook de <b>Cobranças</b> e <b>Assinaturas</b> com:
              <div className="mt-1 space-y-1">
                <div>
                  URL: <code>{p.asaas.webhook_url}</code>
                </div>
                <div>
                  Token de autenticação: {p.asaas.webhook_token ? <code className="break-all">{p.asaas.webhook_token}</code> : <span className="muted">aparece depois de salvar a chave</span>}
                </div>
              </div>
            </li>
          </ol>
          <FormWithResult action={plataformaAsaas} className="space-y-2">
            <input name="api_key" type="password" className="input" placeholder={p.asaas.configurado ? "•••••• (cole para trocar)" : "$aact_..."} required autoComplete="off" />
            <label className="flex items-center gap-2">
              <input type="checkbox" name="sandbox" /> Conta de testes (sandbox)
            </label>
            <button className="btn">Salvar chave</button>
          </FormWithResult>
        </div>
      </div>
    </div>
  );
}
