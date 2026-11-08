import { removerIntegracao } from "@/app/actions";
import { ActionButton, FonteForm, GoogleConnect, MetaForm, WhatsAppPanel } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Integracoes({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const u = await requireUser(["dono"]);
  const { google } = await searchParams;
  const integ = await sql<{ id: string; tipo: string; config: any; user_id: string | null; atualizado_em: Date }[]>`
    select id, tipo, config, user_id, atualizado_em from integrations where tenant_id = ${u.tenant_id} and status = 'ativa' order by tipo`;
  const g = integ.find((i) => i.tipo === "google" && i.user_id === u.id);
  const meta = integ.some((i) => i.tipo === "meta_ads");
  const fontes = integ.filter((i) => i.tipo === "postgres");

  return (
    <div className="space-y-6">
      <h1 className="title">Integrações</h1>
      {google === "ok" && <div className="card text-sm text-green-600">Conta Google conectada.</div>}

      <section className="card space-y-2">
        <h2 className="font-semibold">WhatsApp do Jarvis</h2>
        <WhatsAppPanel />
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Google (Gmail, Agenda, Drive, Google Ads)</h2>
        <p className="muted text-sm">Cada usuário conecta a própria conta. Permissões pedidas: Gmail (ler/rascunhar/enviar), Agenda, Drive (leitura) e Google Ads.</p>
        <GoogleConnect conectado={g ? (g.config?.email ?? "conectado") : null} />
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Meta Ads</h2>
        <p className="muted text-sm">Token de um System User do Business Manager com acesso às contas de anúncio (ads_read; ads_management para pausar/orçamento).</p>
        <MetaForm configurado={meta} />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Sistemas da empresa (bancos de dados)</h2>
        <p className="muted text-sm">Domma Chat, CRM, Master Laudo, RedBox… O Jarvis consulta em modo somente leitura para responder “quantos laudos ontem?”, “leads do dia por fonte” etc.</p>
        {fontes.map((f) => (
          <div key={f.id} className="flex justify-between items-center text-sm border-b pb-2" style={{ borderColor: "var(--line)" }}>
            <div>
              <b>{f.config?.nome}</b> <span className="muted">— {f.config?.descricao}</span>
            </div>
            <ActionButton label="Remover" confirmText={`Remover a fonte ${f.config?.nome}?`} action={removerIntegracao.bind(null, f.id)} />
          </div>
        ))}
        <FonteForm />
      </section>
    </div>
  );
}
