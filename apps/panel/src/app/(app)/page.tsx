import Link from "next/link";
import { Approval, Chat } from "@/components/client";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { brain, usd } from "@/lib/brain";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

function saudacao() {
  const h = Number(new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function Status({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <span className="pill">
      <span className="dot" style={{ background: ok === null ? "#94a3b8" : ok ? "#10b981" : "#f59e0b" }} />
      {label}
    </span>
  );
}

function Kpi({ icon, label, valor, sub }: { icon: string; label: string; valor: string; sub?: string }) {
  return (
    <div className="card flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg grid place-items-center shrink-0" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
        <Icon name={icon} size={18} />
      </div>
      <div className="min-w-0">
        <div className="muted text-xs font-medium">{label}</div>
        <div className="text-xl font-bold tracking-tight">{valor}</div>
        {sub && <div className="muted text-xs">{sub}</div>}
      </div>
    </div>
  );
}

export default async function Inicio() {
  const u = await requireUser();
  const [conv] = await sql<{ id: string }[]>`
    select id from conversations where user_id = ${u.id} and canal = 'painel' order by ultima_msg_em desc limit 1`;
  const [msgs, pend, rodando, hoje, mes, journal, google, meta, keys, wa] = await Promise.all([
    conv
      ? sql<{ autor: "user" | "assistant"; conteudo: string }[]>`
          select autor, conteudo from (select autor, conteudo, criado_em from messages where conversation_id = ${conv.id} and autor in ('user','assistant') order by criado_em desc limit 20) t order by criado_em`
      : Promise.resolve([]),
    sql<{ id: string; resumo: string; nivel: string }[]>`select id, resumo, nivel from approvals where user_id = ${u.id} and status = 'pendente' and expira_em > now() order by criado_em desc`,
    sql<{ id: string; pedido: string; status: string; canal: string }[]>`
      select id, pedido, status, canal from tasks where user_id = ${u.id} and status in ('executando','aguardando_aprovacao') order by inicio desc limit 6`,
    sql<{ n: number; custo: string | null }[]>`
      select count(*)::int as n, sum(custo) as custo from tasks where user_id = ${u.id} and (inicio at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date`,
    sql<{ n: number; custo: string | null }[]>`
      select count(*)::int as n, sum(custo) as custo from tasks where user_id = ${u.id} and inicio >= date_trunc('month', now() at time zone 'America/Sao_Paulo')`,
    sql<{ data: Date; resumo: string; pendencias: string[] }[]>`select data, resumo, pendencias from daily_journal where user_id = ${u.id} order by data desc limit 1`,
    sql<{ email: string | null }[]>`select config->>'email' as email from integrations where tipo = 'google' and user_id = ${u.id} and status = 'ativa' limit 1`,
    sql<{ n: number }[]>`select count(*)::int as n from integrations where tipo = 'meta_ads' and tenant_id = ${u.tenant_id} and status = 'ativa'`,
    brain<{ anthropic: boolean; stt: boolean; google: boolean }>("/api/integrations/keys", u.id).catch(() => null),
    brain<{ conectado: boolean }>("/api/whatsapp", u.id).catch(() => null),
  ]);

  // a Domma configura a plataforma; o cliente só o que é dele
  const passos = [
    ...(u.plataforma ? [{ ok: !!keys?.anthropic, label: "Conectar a inteligência (Claude)", href: "/integracoes" }] : []),
    { ok: !!google[0], label: "Conectar sua conta Google", href: "/integracoes" },
    { ok: u.tem_pin, label: "Definir seu PIN de 6 dígitos", href: "/configuracoes" },
    ...(u.plataforma ? [{ ok: !!wa?.conectado, label: "Conectar o WhatsApp do Tavinho", href: "/integracoes" }] : []),
    { ok: !!u.whatsapp, label: "Cadastrar seu número de WhatsApp", href: "/configuracoes" },
    ...(u.perfil === "dono" ? [{ ok: (meta[0]?.n ?? 0) > 0, label: "Conectar a Meta Ads", href: "/integracoes" }] : []),
  ];
  const feitos = passos.filter((p) => p.ok).length;
  const primeiroNome = u.nome.replace(/\(.*?\)/g, "").trim().split(/\s+/)[0];
  const hojeRaw = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(new Date());
  const hojeLabel = hojeRaw.charAt(0).toUpperCase() + hojeRaw.slice(1);

  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <div className="muted text-sm">{hojeLabel}</div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
            {saudacao()}, {primeiroNome} 👋
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Status ok={keys ? keys.anthropic : null} label="Inteligência" />
          <Status ok={!!google[0]} label="Google" />
          <Status ok={wa ? wa.conectado : null} label="WhatsApp" />
          {u.pausado && <Status ok={false} label="Pausado" />}
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi icon="tasks" label="Tarefas hoje" valor={String(hoje[0]?.n ?? 0)} />
        <Kpi icon="wallet" label="Gasto hoje" valor={usd(hoje[0]?.custo)} />
        <Kpi icon="chart" label="Tarefas no mês" valor={String(mes[0]?.n ?? 0)} sub={`${usd(mes[0]?.custo)} em IA`} />
        <Kpi icon="shield" label="Aprovações pendentes" valor={String(pend.length)} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Chat inicial={msgs.map((m) => ({ autor: m.autor, texto: m.conteudo }))} nome={primeiroNome} />
        </div>

        <div className="space-y-4">
          {feitos < passos.length && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-sm">Configuração</div>
                <span className="muted text-xs">
                  {feitos} de {passos.length}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
                <div className="h-full rounded-full" style={{ width: `${(feitos / passos.length) * 100}%`, background: "linear-gradient(90deg,#6f5cf6,#10b981)" }} />
              </div>
              <ul className="space-y-1.5">
                {passos.map((p) => (
                  <li key={p.label}>
                    <Link href={p.href} className="flex items-center gap-2.5 text-sm rounded-lg px-1.5 py-1 hover:bg-black/5">
                      <span
                        className="w-5 h-5 rounded-full grid place-items-center shrink-0"
                        style={p.ok ? { background: "var(--ok)", color: "white" } : { border: "1.5px solid var(--line)" }}
                      >
                        {p.ok && <Icon name="check" size={12} strokeWidth={3} />}
                      </span>
                      <span className={p.ok ? "muted line-through" : ""}>{p.label}</span>
                      {!p.ok && (
                        <span className="ml-auto muted">
                          <Icon name="arrow" size={14} />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card space-y-3">
            <div className="font-semibold text-sm">Aprovações pendentes</div>
            {pend.length ? (
              <div className="space-y-2">
                {pend.map((p) => (
                  <Approval key={p.id} id={p.id} resumo={p.resumo} nivel={p.nivel} />
                ))}
              </div>
            ) : (
              <p className="muted text-sm">Nada esperando por você. ✨</p>
            )}
          </div>

          <div className="card space-y-2">
            <div className="font-semibold text-sm">Em andamento</div>
            {rodando.length ? (
              <ul className="space-y-1.5 text-sm">
                {rodando.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span>{t.status === "executando" ? "⏳" : "🔐"}</span>
                    <Link className="hover:underline truncate" href={`/tarefas/${t.id}`}>
                      {t.pedido}
                    </Link>
                    <span className="tag ml-auto">{t.canal}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted text-sm">Nenhuma tarefa rodando.</p>
            )}
          </div>

          {journal[0] && (
            <div className="card space-y-1">
              <div className="font-semibold text-sm">Resumo de {new Date(journal[0].data).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</div>
              <p className="text-sm whitespace-pre-wrap">{journal[0].resumo}</p>
              {journal[0].pendencias?.length > 0 && (
                <ul className="text-sm list-disc ml-5 mt-1">
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
