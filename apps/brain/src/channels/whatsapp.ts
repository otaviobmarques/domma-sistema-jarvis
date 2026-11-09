import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  type WAMessage,
  type WASocket,
} from "baileys";
import { config } from "../lib/config.js";
import { log } from "../lib/log.js";
import { clearWaAuth, usePostgresAuthState } from "./waAuth.js";

export interface InboundMessage {
  numero: string; // só dígitos
  jid: string; // para responder
  nome: string;
  texto: string;
  audio?: { buffer: Buffer; mime: string };
  imagem?: { buffer: Buffer; mime: string };
  documento?: { buffer: Buffer; mime: string; nome: string };
  localizacao?: { lat: number; lng: number; nome?: string };
  grupo: boolean;
  mencionado: boolean;
  raw?: WAMessage;
  /** API oficial: empresa dona do número que recebeu a mensagem */
  tenantId?: string;
  /** como responder e mostrar "digitando" (padrão: o número por QR) */
  responder?: (texto: string) => Promise<void>;
  digitando?: () => Promise<void>;
}

type Handler = (m: InboundMessage) => Promise<void>;

let sock: WASocket | null = null;
let handler: Handler | null = null;
let lastQr: string | null = null;
let connected = false;
let meNumber: string | null = null;
let stopping = false;
let reconnectAttempts = 0;

const waLogger = log.child({ mod: "baileys" });
waLogger.level = process.env.BAILEYS_LOG_LEVEL ?? "warn";

export function onWhatsAppMessage(h: Handler) {
  handler = h;
}

export function whatsappStatus() {
  return { conectado: connected, qr: connected ? null : lastQr, numero: meNumber };
}

const digits = (jid: string) => jid.split("@")[0]!.split(":")[0]!.replace(/\D/g, "");

async function resolveNumber(m: WAMessage): Promise<string> {
  const key = m.key;
  const candidates = [key.remoteJidAlt, key.participantAlt, key.participant, key.remoteJid].filter(Boolean) as string[];
  const pn = candidates.find((j) => j.endsWith("@s.whatsapp.net"));
  if (pn) return digits(pn);
  const lid = candidates.find((j) => j.endsWith("@lid"));
  if (lid && sock) {
    const mapped = await sock.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
    if (mapped) return digits(mapped);
  }
  return digits(key.remoteJid ?? "");
}

function textOf(m: WAMessage): string {
  const msg = m.message;
  if (!msg) return "";
  return (
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    msg.documentMessage?.caption ??
    msg.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    msg.buttonsResponseMessage?.selectedDisplayText ??
    msg.listResponseMessage?.title ??
    ""
  );
}

async function toInbound(m: WAMessage): Promise<InboundMessage | null> {
  const jid = m.key.remoteJid ?? "";
  if (!m.message || m.key.fromMe || jid === "status@broadcast" || jid.endsWith("@newsletter")) return null;
  const grupo = jid.endsWith("@g.us");
  const msg = m.message;
  const meJid = sock?.user?.id ? jidNormalizedUser(sock.user.id) : "";
  const meLid = sock?.user?.lid ? jidNormalizedUser(sock.user.lid) : "";
  const mentions = msg.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
  const mencionado = mentions.some((j) => j === meJid || j === meLid);

  const inbound: InboundMessage = {
    numero: await resolveNumber(m),
    jid,
    nome: m.pushName ?? "",
    texto: textOf(m),
    grupo,
    mencionado,
    raw: m,
  };
  const dl = () => downloadMediaMessage(m, "buffer", {}, { logger: waLogger, reuploadRequest: sock!.updateMediaMessage }) as Promise<Buffer>;
  try {
    if (msg.audioMessage) inbound.audio = { buffer: await dl(), mime: msg.audioMessage.mimetype ?? "audio/ogg" };
    else if (msg.imageMessage) inbound.imagem = { buffer: await dl(), mime: msg.imageMessage.mimetype ?? "image/jpeg" };
    else if (msg.documentMessage || msg.documentWithCaptionMessage) {
      const d = msg.documentMessage ?? msg.documentWithCaptionMessage!.message!.documentMessage!;
      inbound.documento = { buffer: await dl(), mime: d.mimetype ?? "application/octet-stream", nome: d.fileName ?? "documento" };
    } else if (msg.locationMessage) {
      inbound.localizacao = { lat: msg.locationMessage.degreesLatitude ?? 0, lng: msg.locationMessage.degreesLongitude ?? 0, nome: msg.locationMessage.name ?? undefined };
    }
  } catch (err) {
    log.warn({ err: String(err) }, "falha ao baixar mídia do WhatsApp");
  }
  return inbound;
}

export async function startWhatsApp() {
  if (!config.whatsapp.enabled) {
    log.info("WhatsApp desligado (WHATSAPP_ENABLED=false)");
    return;
  }
  stopping = false;
  const { state, saveCreds } = await usePostgresAuthState();
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined as any }));
  sock = makeWASocket({
    version,
    auth: state,
    logger: waLogger as any,
    browser: Browsers.ubuntu("Tavinho"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (u) => {
    if (u.qr) {
      lastQr = u.qr;
      log.info("novo QR Code do WhatsApp disponível no painel (Integrações)");
    }
    if (u.connection === "open") {
      connected = true;
      lastQr = null;
      reconnectAttempts = 0;
      meNumber = sock?.user?.id ? digits(sock.user.id) : null;
      log.info({ numero: meNumber }, "WhatsApp conectado");
    }
    if (u.connection === "close") {
      connected = false;
      const code = (u.lastDisconnect?.error as any)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.warn("WhatsApp deslogado; limpando sessão e gerando novo QR");
        await clearWaAuth();
      }
      if (!stopping) {
        const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts++);
        log.info({ code, delay }, "WhatsApp desconectado, reconectando");
        setTimeout(() => void startWhatsApp().catch((e) => log.error({ e }, "falha ao reconectar")), delay);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try {
        const inbound = await toInbound(m);
        if (!inbound || !handler) continue;
        if (inbound.grupo && (!config.whatsapp.allowGroups || !inbound.mencionado)) continue;
        void handler(inbound).catch((err) => log.error({ err }, "erro ao tratar mensagem"));
      } catch (err) {
        log.error({ err }, "erro ao processar mensagem do WhatsApp");
      }
    }
  });
}

export async function logoutWhatsApp() {
  stopping = true;
  try {
    await sock?.logout();
  } catch {
    /* já deslogado */
  }
  await clearWaAuth();
  connected = false;
  meNumber = null;
  setTimeout(() => void startWhatsApp(), 1000);
}

async function jidFor(numero: string): Promise<string> {
  if (numero.includes("@")) return numero;
  if (!sock) throw new Error("WhatsApp não conectado");
  const [res] = (await sock.onWhatsApp(numero).catch(() => [])) ?? [];
  if (res?.exists) return res.jid;
  // Brasil: tenta com/sem o nono dígito
  if (numero.startsWith("55") && (numero.length === 12 || numero.length === 13)) {
    const alt = numero.length === 13 ? numero.slice(0, 4) + numero.slice(5) : numero.slice(0, 4) + "9" + numero.slice(4);
    const [r2] = (await sock.onWhatsApp(alt).catch(() => [])) ?? [];
    if (r2?.exists) return r2.jid;
  }
  throw new Error(`O número ${numero} não está no WhatsApp`);
}

export async function sendWhatsApp(to: string, text: string) {
  if (!sock || !connected) throw new Error("WhatsApp do Tavinho não está conectado");
  const jid = await jidFor(to);
  // WhatsApp corta mensagens muito longas; divide em partes
  for (let i = 0; i < text.length; i += 3500) {
    await sock.sendMessage(jid, { text: text.slice(i, i + 3500) });
  }
}

export async function sendTyping(jid: string) {
  await sock?.sendPresenceUpdate("composing", jid).catch(() => {});
}

export async function sendFile(to: string, buffer: Buffer, fileName: string, mimetype: string, caption?: string) {
  if (!sock || !connected) throw new Error("WhatsApp do Tavinho não está conectado");
  const jid = await jidFor(to);
  if (mimetype.startsWith("image/")) await sock.sendMessage(jid, { image: buffer, caption });
  else await sock.sendMessage(jid, { document: buffer, fileName, mimetype, caption });
}

export function stopWhatsApp() {
  stopping = true;
  sock?.end(undefined);
}
