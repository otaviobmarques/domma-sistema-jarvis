import { setAnthropicKey } from "../agent/llm.js";
import { config } from "./config.js";
import { db } from "./db.js";
import { getIntegration } from "./integrations.js";
import { log } from "./log.js";

/** Chaves de serviço cadastradas no painel (criptografadas). Variáveis de ambiente têm prioridade. */
async function tenantIds() {
  return (await db()<{ id: string }[]>`select id from tenants order by criado_em limit 1`).map((r) => r.id);
}

export async function hasStoredKey(tipo: "anthropic" | "stt") {
  for (const t of await tenantIds()) if ((await getIntegration(t, tipo))?.tokens.api_key) return true;
  return false;
}

export function applyKey(tipo: "anthropic" | "stt", key: string) {
  if (tipo === "anthropic") setAnthropicKey(key);
  else config.stt.apiKey = key;
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
  }
}
