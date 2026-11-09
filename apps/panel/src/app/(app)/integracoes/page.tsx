import { removerIntegracao } from "@/app/actions";
import { whatsappCloudDesconectar, whatsappCloudSalvar, whatsappCloudTeste } from "@/app/actions";
import { ActionButton, FonteForm, FormWithResult, GoogleConnect, GoogleOAuthForm, KeyForm, VozSelect, MetaForm, WhatsAppPanel } from "@/components/client";
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
  const wa = await brain<{ conta: { numero: string | null; nome: string | null; verify_token: string; template: string | null; phone_number_id: string } | null; webhook_url: string }>(
    "/api/integrations/whatsapp-cloud",
    u.id,
  ).catch(() => null);
  const keys = await brain<{ anthropic: boolean; stt: boolean; google: boolean; tts: boolean; tts_voz: string | null }>("/api/integrations/keys", u.id).catch(() => null);
  const plat = u.plataforma;
  const faltando = [
    plat && !keys?.anthropic && "Chave da API do Claude (sem ela o Tavinho não pensa)",
    plat && !keys?.stt && "Transcrição de áudio (para entender áudios do WhatsApp)",
    plat && !keys?.tts && "Voz natural (para o Tavinho falar com voz humana)",
    plat && !keys?.google && "Credenciais do Google (seção Google abaixo) para Gmail, Agenda e Drive",
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

      {plat && (
      <>
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
        <h2 className="font-semibold">Voz natural (ElevenLabs)</h2>
        <p className="muted text-sm">
          Deixa a voz do Tavinho humana no app de PC e no painel. Crie uma conta em elevenlabs.io (o plano grátis tem 10 mil caracteres/mês), vá em <b>Developers → API Keys</b> e cole a chave aqui.
        </p>
        <KeyForm tipo="tts" configurado={!!keys?.tts} placeholder="sk_..." />
        {keys?.tts && <VozSelect atual={keys.tts_voz} />}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">WhatsApp do Tavinho (QR Code)</h2>
        <p className="muted text-sm">Número compartilhado da plataforma. Atende a Domma e os clientes em teste que ainda não conectaram a API oficial.</p>
        <WhatsAppPanel />
      </section>
      </>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">WhatsApp oficial da empresa (API da Meta) {wa?.conta ? "✅" : ""}</h2>
        {wa?.conta ? (
          <div className="text-sm space-y-2">
            <p>
              Conectado: <b>{wa.conta.nome}</b> +{wa.conta.numero}. A equipe fala com o Tavinho por esse número.
              {wa.conta.template ? ` Modelo para mensagens fora da janela de 24 h: ${wa.conta.template}.` : " Sem modelo cadastrado: rotinas e avisos só chegam a quem falou com o Tavinho nas últimas 24 h."}
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionButton label="Enviar mensagem de teste" action={whatsappCloudTeste} />
              <ActionButton label="Desconectar" confirmText="Desconectar o número oficial? A equipe deixa de falar com o Tavinho por ele." action={whatsappCloudDesconectar} />
            </div>
          </div>
        ) : (
          <p className="muted text-sm">
            Use um número só para o Tavinho (não pode estar em uso no app do WhatsApp). {!u.plataforma && "Enquanto não conectar, a equipe usa o número compartilhado do Tavinho."}
          </p>
        )}
        <details className="text-sm" open={!wa?.conta}>
          <summary className="cursor-pointer muted">{wa?.conta ? "Trocar número ou credenciais" : "Como conectar"}</summary>
          <ol className="list-decimal ml-5 space-y-1 mt-2">
            <li>
              Em <a className="underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">developers.facebook.com</a>, crie um app do tipo <b>Empresa</b> e adicione o produto <b>WhatsApp</b>. Cadastre e verifique o número da empresa.
            </li>
            <li>
              Copie o <b>Identificador do número de telefone</b> (WhatsApp → Configuração da API), crie um <b>token permanente</b> (Configurações do negócio → Usuários do sistema → gerar token com as permissões whatsapp_business_messaging e whatsapp_business_management) e a <b>Chave secreta do app</b> (Configurações do app → Básico).
            </li>
            <li>
              Depois de salvar, em WhatsApp → Configuração → <b>Webhook</b>: URL <code>{wa?.webhook_url}</code>, token de verificação{" "}
              {wa?.conta ? <code className="break-all">{wa.conta.verify_token}</code> : <span className="muted">(aparece depois de salvar)</span>}, e assine o campo <b>messages</b>.
            </li>
            <li>Opcional: crie um modelo de mensagem (categoria Utilidade) com o corpo “{"{{1}}"}” para o Tavinho mandar rotinas e avisos a qualquer hora, e informe o nome dele abaixo.</li>
          </ol>
          <FormWithResult action={whatsappCloudSalvar} className="grid md:grid-cols-2 gap-2 mt-3">
            <input name="phone_number_id" className="input" placeholder="Identificador do número (só dígitos)" defaultValue={wa?.conta?.phone_number_id ?? ""} required />
            <input name="access_token" type="password" className="input" placeholder="Token de acesso permanente (EAA...)" required autoComplete="off" />
            <input name="app_secret" type="password" className="input" placeholder="Chave secreta do app" required autoComplete="off" />
            <input name="template" className="input" placeholder="Nome do modelo (opcional)" defaultValue={wa?.conta?.template ?? ""} />
            <button className="btn md:col-span-2">Conectar número oficial</button>
          </FormWithResult>
        </details>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Google (Gmail, Agenda, Drive, Google Ads)</h2>
        <p className="muted text-sm">Cada usuário conecta a própria conta. Permissões pedidas: Gmail (ler/rascunhar/enviar), Agenda, Drive (leitura) e Google Ads.</p>
        {keys?.google ? (
          <GoogleConnect conectado={g ? (g.config?.email ?? "conectado") : null} />
        ) : (
          <ol className="text-sm list-decimal ml-5 space-y-1">
            <li>
              Em <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">console.cloud.google.com → APIs e serviços → Credenciais</a>, crie um projeto (ex.: “Tavinho”).
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
        {plat && (
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
        <p className="muted text-sm">Domma Chat, CRM, Master Laudo, RedBox… O Tavinho consulta em modo somente leitura para responder “quantos laudos ontem?”, “leads do dia por fonte” etc.</p>
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
