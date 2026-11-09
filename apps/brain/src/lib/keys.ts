import { setAnthropicKey } from "../agent/llm.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { getIntegration } from "./integrations.js";
import { log } from "./log.js";
import { tts } from "./tts.js";

/** Chaves de serviço cadastradas no painel (criptografadas). Variáveis de ambiente têm prioridade. */
async function tenantIds() {
  // as chaves de IA, voz e do app do Google são da plataforma (Domma), valem para todos os clientes
  return (await db()<{ id: string }[]>`select id from tenants order by plataforma desc, criado_em limit 1`).map((r) => r.id);
}

export async function hasStoredKey(tipo: "anthropic" | "stt" | "tts") {
  for (const t of await tenantIds()) if ((await getIntegration(t, tipo))?.tokens.api_key) return true;
  return false;
}

export function applyKey(tipo: "anthropic" | "stt" | "tts", key: string, extra: Record<string, string> = {}) {
  if (tipo === "anthropic") setAnthropicKey(key);
  else if (tipo === "tts") {
    tts.apiKey = key;
    if (extra.voice_id !== undefined) tts.voiceId = extra.voice_id;
  } else config.stt.apiKey = key;
}

export function applyGoogle(clientId: string, clientSecret: string) {
  config.google.clientId = clientId;
  config.google.clientSecret = clientSecret;
}

export async function loadStoredKeys() {
  for (const t of await tenantIds()) {
    const a = await getIntegration(t, "anthropic");
    if (a?.tokens.api_key && !process.env.ANTHROPIC_API_KEY) {
      applyKey("anthropic", a.tokens.api_key);
      log.info("chave do Claude carregada do banco");
    }
    const s = await getIntegration(t, "stt");
    if (s?.tokens.api_key && !process.env.STT_API_KEY) applyKey("stt", s.tokens.api_key);
    const v = await getIntegration(t, "tts");
    if (v?.tokens.api_key && !process.env.ELEVENLABS_API_KEY) applyKey("tts", v.tokens.api_key, { voice_id: String(v.config.voice_id ?? "") });
    const g = await getIntegration(t, "google_oauth");
    if (g?.tokens.client_id && !process.env.GOOGLE_CLIENT_ID) applyGoogle(g.tokens.client_id, g.tokens.client_secret);
  }
}
