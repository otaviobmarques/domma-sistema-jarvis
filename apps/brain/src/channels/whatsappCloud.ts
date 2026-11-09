import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "../lib/crypto.js";
import { audit, db } from "../lib/db.js";
import { getIntegration, saveIntegration } from "../lib/integrations.js";
import { log } from "../lib/log.js";
import type { InboundMessage } from "./whatsapp.js";

/**
 * WhatsApp pela API oficial da Meta (Cloud API). Cada cliente conecta o próprio número
 * (integração "whatsapp_cloud" do tenant). Um webhook único recebe as mensagens de todos.
 */

const GRAPH = () => (process.env.WHATSAPP_GRAPH_URL ?? "https://graph.facebook.com/v21.0").replace(/\/$/, "");

export interface ContaCloud {
  tenantId: string;
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  numero?: string;
  template?: string | null;
  idioma: string;
}

async function conta(tenantId: string): Promise<ContaCloud | null> {
  const i = await getIntegration(tenantId, "whatsapp_cloud");
  if (!i?.tokens.access_token || !i.config.phone_number_id) return null;
  return {
    tenantId,
    phoneNumberId: String(i.config.phone_number_id),
    accessToken: i.tokens.access_token,
    appSecret: i.tokens.app_secret ?? "",
    verifyToken: String(i.config.verify_token ?? ""),
    numero: i.config.numero ? String(i.config.numero) : undefined,
    template: i.config.template ? String(i.config.template) : null,
    idioma: String(i.config.idioma ?? "pt_BR"),
  };
}

export async function cloudConfigurado(tenantId: string) {
  return !!(await conta(tenantId));
}

async function contaPorNumero(phoneNumberId: string): Promise<ContaCloud | null> {
  const [r] = await db()<{ tenant_id: string }[]>`
    select tenant_id from integrations where tipo = 'whatsapp_cloud' and status = 'ativa' and config->>'phone_number_id' = ${phoneNumberId} limit 1`;
  return r ? conta(r.tenant_id) : null;
}

async function graph<T = any>(c: Pick<ContaCloud, "accessToken">, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${GRAPH()}${path}`, {
    method,
    headers: { authorization: `Bearer ${c.accessToken}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `Meta respondeu ${res.status}`), { codigo: data?.error?.code as number | undefined });
  return data as T;
}

/** Conecta (ou troca) o número oficial do cliente. Confere o token na Meta antes de salvar. */
export async function conectarCloud(tenantId: string, userId: string, d: { phone_number_id: string; access_token: string; app_secret: string; template?: string | null; idioma?: string }) {
  const info = await graph<{ display_phone_number?: string; verified_name?: string }>({ accessToken: d.access_token }, "GET", `/${d.phone_number_id}?fields=display_phone_number,verified_name`);
  const atual = await getIntegration(tenantId, "whatsapp_cloud");
  const verifyToken = String(atual?.config.verify_token ?? randomBytes(18).toString("base64url"));
  const numero = (info.display_phone_number ?? "").replace(/\D/g, "");
  await saveIntegration({
    tenantId,
    userId: null,
    tipo: "whatsapp_cloud",
    tokens: { access_token: d.access_token, app_secret: d.app_secret },
    config: { phone_number_id: d.phone_number_id, numero, nome: info.verified_name ?? null, verify_token: verifyToken, template: d.template || null, idioma: d.idioma || "pt_BR" },
  });
  await audit(userId, "integracao.whatsapp_cloud.conectar", numero || d.phone_number_id);
  return { numero, nome: info.verified_name ?? null, verifyToken };
}

export async function statusCloud(tenantId: string) {
  const i = await getIntegration(tenantId, "whatsapp_cloud");
  if (!i) return null;
  return { numero: i.config.numero ?? null, nome: i.config.nome ?? null, verify_token: i.config.verify_token ?? null, template: i.config.template ?? null, phone_number_id: i.config.phone_number_id };
}

// ------------------------------------------------------------------ envio
function partes(texto: string, max = 4000) {
  const out: string[] = [];
  let resto = texto;
  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n", max);
    if (corte < max / 2) corte = max;
    out.push(resto.slice(0, corte));
    resto = resto.slice(corte).trimStart();
  }
  if (resto) out.push(resto);
  return out;
}

export async function enviarCloud(tenantId: string, para: string, texto: string) {
  const c = await conta(tenantId);
  if (!c) throw new Error("WhatsApp oficial não conectado para esta empresa");
  const numero = para.replace(/\D/g, "");
  try {
    for (const p of partes(texto)) {
      await graph(c, "POST", `/${c.phoneNumberId}/messages`, { messaging_product: "whatsapp", to: numero, type: "text", text: { body: p, preview_url: false } });
    }
  } catch (err) {
    // Fora da janela de 24 h a Meta só aceita modelos aprovados: manda o modelo com o texto como parâmetro.
    if ((err as { codigo?: number }).codigo !== 131047 || !c.template) throw err;
    const param = texto.replace(/\s*\n+\s*/g, " · ").replace(/\s{4,}/g, "   ").slice(0, 1000);
    await graph(c, "POST", `/${c.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: numero,
      type: "template",
      template: { name: c.template, language: { code: c.idioma }, components: [{ type: "body", parameters: [{ type: "text", text: param }] }] },
    });
  }
}

async function digitando(c: ContaCloud, messageId: string) {
  await graph(c, "POST", `/${c.phoneNumberId}/messages`, { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }).catch(() => {});
}

async function baixarMidia(c: ContaCloud, id: string): Promise<{ buffer: Buffer; mime: string }> {
  const m = await graph<{ url: string; mime_type: string }>(c, "GET", `/${id}`);
  const res = await fetch(m.url, { headers: { authorization: `Bearer ${c.accessToken}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`não baixou a mídia (${res.status})`);
  return { buffer: Buffer.from(await res.arrayBuffer()), mime: m.mime_type };
}

// ------------------------------------------------------------------ webhook
/** Verificação do webhook (GET): o token precisa ser o de alguma empresa conectada. */
export async function verificarWebhook(q: Record<string, string | undefined>) {
  if (q["hub.mode"] !== "subscribe" || !q["hub.verify_token"]) return null;
  const [r] = await db()<{ ok: boolean }[]>`
    select true as ok from integrations where tipo = 'whatsapp_cloud' and config->>'verify_token' = ${q["hub.verify_token"]} limit 1`;
  return r ? (q["hub.challenge"] ?? "") : null;
}

interface MsgMeta {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type: string };
  voice?: { id: string; mime_type: string };
  image?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
  location?: { latitude: number; longitude: number; name?: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
}

/**
 * Recebe o POST da Meta. Confere a assinatura (X-Hub-Signature-256) com a chave secreta do app
 * da empresa dona do número e entrega cada mensagem ao mesmo fluxo do WhatsApp por QR.
 */
export async function receberWebhook(corpo: Buffer, assinatura: string, entregar: (m: InboundMessage) => Promise<void>) {
  let payload: any;
  try {
    payload = JSON.parse(corpo.toString("utf8"));
  } catch {
    return 400;
  }
  const sql = db();
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      const phoneId = v?.metadata?.phone_number_id;
      if (!phoneId) continue;
      const c = await contaPorNumero(String(phoneId));
      if (!c) {
        log.warn({ phoneId }, "webhook do WhatsApp para número não conectado");
        continue;
      }
      const esperado = `sha256=${createHmac("sha256", c.appSecret).update(corpo).digest("hex")}`;
      if (!c.appSecret || !safeEqual(assinatura, esperado)) {
        log.warn({ tenant: c.tenantId }, "assinatura do webhook do WhatsApp inválida");
        return 401;
      }
      const nomes = new Map<string, string>((v.contacts ?? []).map((k: any) => [k.wa_id, k.profile?.name ?? ""]));
      for (const msg of (v.messages ?? []) as MsgMeta[]) {
        const [novo] = await sql<{ id: string }[]>`insert into webhook_eventos (id, origem) values (${msg.id}, 'whatsapp') on conflict do nothing returning id`;
        if (!novo) continue; // a Meta reenvia: já tratado
        const m: InboundMessage = {
          numero: msg.from,
          jid: msg.from,
          nome: nomes.get(msg.from) ?? "",
          texto: msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? msg.button?.text ?? msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "",
          grupo: false,
          mencionado: false,
          tenantId: c.tenantId,
          responder: (t) => enviarCloud(c.tenantId, msg.from, t),
          digitando: () => digitando(c, msg.id),
        };
        try {
          const audio = msg.audio ?? msg.voice;
          if (audio) m.audio = await baixarMidia(c, audio.id);
          if (msg.image) m.imagem = await baixarMidia(c, msg.image.id);
          if (msg.document) m.documento = { ...(await baixarMidia(c, msg.document.id)), nome: msg.document.filename ?? "arquivo" };
        } catch (err) {
          log.warn({ err }, "mídia do WhatsApp oficial");
          m.texto += "\n(O usuário mandou um arquivo que não consegui baixar.)";
        }
        if (msg.location) m.localizacao = { lat: msg.location.latitude, lng: msg.location.longitude, nome: msg.location.name };
        // responde 200 logo; a tarefa segue em segundo plano (a Meta reenvia se demorar)
        void entregar(m).catch((err) => log.error({ err }, "mensagem do WhatsApp oficial falhou"));
      }
    }
  }
  return 200;
}
