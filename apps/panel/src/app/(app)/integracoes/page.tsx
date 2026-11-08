import { removerIntegracao } from "@/app/actions";
import { ActionButton, FonteForm, GoogleConnect, GoogleOAuthForm, KeyForm, MetaForm, WhatsAppPanel } from "@/components/client";
import { brain } from "@/lib/brain";
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
  const keys = await brain<{ anthropic: boolean; stt: boolean; google: boolean }>("/api/integrations/keys", u.id).catch(() => null);
  const faltando = [
    !keys?.anthropic && "Chave da API do Claude (sem ela o Jarvis não pensa)",
    !keys?.stt && "Transcrição de áudio (para entender áudios do WhatsApp)",
    !keys?.google && "Credenciais do Google (seção Google abaixo) para Gmail, Agenda e Drive",
    !meta && "Token da Meta Ads",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <h1 className="title">Integrações</h1>
      {google === "ok" && <div className="card text-sm text-green-600">Conta Google conectada.</div>}
      {google && google !== "ok" && <div className="card text-sm text-red-600">O Google recusou a conexão ({google}). Confira as credenciais e tente de novo.</div>}

      {faltando.length > 0 && (
        <div className="card text-sm">
          <b>Falta configurar:</b>
          <ul className="list-disc ml-5 mt-1">
            {faltando.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="card space-y-2">
        <h2 className="font-semibold">Inteligência (Claude)</h2>
        <p className="muted text-sm">Chave da API da Anthropic (console.anthropic.com → API Keys). Validada antes de salvar e guardada criptografada.</p>
        <KeyForm tipo="anthropic" configurado={!!keys?.anthropic} placeholder="sk-ant-..." />
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Transcrição de áudio</h2>
        <p className="muted text-sm">Chave da Groq (console.groq.com → API Keys) para transcrever os áudios do WhatsApp com Whisper.</p>
        <KeyForm tipo="stt" configurado={!!keys?.stt} placeholder="gsk_..." />
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">WhatsApp do Jarvis</h2>
        <WhatsAppPanel />
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Google (Gmail, Agenda, Drive, Google Ads)</h2>
        <p className="muted text-sm">Cada usuário conecta a própria conta. Permissões pedidas: Gmail (ler/rascunhar/enviar), Agenda, Drive (leitura) e Google Ads.</p>
        {keys?.google ? (
          <GoogleConnect conectado={g ? (g.config?.email ?? "conectado") : null} />
        ) : (
          <ol className="text-sm list-decimal ml-5 space-y-1">
            <li>
              Em <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">console.cloud.google.com → APIs e serviços → Credenciais</a>, crie um projeto (ex.: “Jarvis”).
            </li>
            <li>Em “Biblioteca”, ative: Gmail API, Google Calendar API, Google Drive API (e Google Ads API, se for usar).</li>
            <li>Em “Tela de permissão OAuth”: tipo Externo (ou Interno, se for Google Workspace), adicione seu e-mail como usuário de teste.</li>
            <li>
              Em “Criar credenciais → ID do cliente OAuth”: tipo <b>Aplicativo da Web</b>, URI de redirecionamento autorizado:
              <code className="block mt-1 p-1 rounded" style={{ background: "var(--bg)" }}>https://jarvis.dommasistemas.com.br/oauth/google/callback</code>
            </li>
            <li>Cole abaixo o ID e a chave secreta gerados.</li>
          </ol>
        )}
        {(

          <details className="text-sm" open={!keys?.google}>
            <summary className="cursor-pointer muted">{keys?.google ? "Trocar credenciais do Google" : "Credenciais do Google"}</summary>
            <div className="mt-2">
              <GoogleOAuthForm configurado={!!keys?.google} />
            </div>
          </details>
        )}
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
