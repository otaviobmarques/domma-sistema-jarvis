// Configuração lida do ambiente. Só banco, segredo da API e chave de criptografia
// são obrigatórios: integrações sem credencial ficam "não configuradas" e o
// Jarvis avisa o usuário em vez de falhar.
const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8080}`).replace(/\/$/, ""),
  panelUrl: (env.PANEL_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  timezone: env.TZ_JARVIS ?? "America/Sao_Paulo",

  // Lista de URLs separadas por vírgula; a primeira que conectar é usada.
  databaseUrls: (env.DATABASE_URLS ?? env.DATABASE_URL ?? "").split(",").map((s) => s.trim()).filter(Boolean),

  apiSecret: env.BRAIN_API_SECRET ?? "", // compartilhado com o painel
  encryptionKey: env.ENCRYPTION_KEY ?? "", // 32 bytes em hex (tokens e cofre)

  // Roteador de modelos: rápido para o simples, forte quando precisa pensar
  modelFast: env.MODEL_FAST ?? "claude-haiku-5-5",
  modelStrong: env.MODEL_STRONG ?? "claude-opus-5-5",
  usdBrl: Number(env.USD_BRL ?? 5.5),
  maxAgentSteps: Number(env.MAX_AGENT_STEPS ?? 25),

  whatsapp: {
    enabled: (env.WHATSAPP_ENABLED ?? "true") !== "false",
    allowGroups: env.WHATSAPP_GROUPS === "true",
  },

  // Transcrição de áudio na nuvem (endpoint compatível com /audio/transcriptions, ex.: Groq Whisper)
  stt: {
    url: env.STT_URL ?? "https://api.groq.com/openai/v1/audio/transcriptions",
    apiKey: env.STT_API_KEY ?? "",
    model: env.STT_MODEL ?? "whisper-large-v3-turbo",
  },

  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    adsDeveloperToken: env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    adsLoginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "",
  },
  meta: {
    accessToken: env.META_ACCESS_TOKEN ?? "",
    apiVersion: env.META_API_VERSION ?? "v23.0",
  },
};

export function requireConfig() {
  const missing: string[] = [];
  if (config.databaseUrls.length === 0) missing.push("DATABASE_URL(S)");
  if (!config.apiSecret) missing.push("BRAIN_API_SECRET");
  if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey)) missing.push("ENCRYPTION_KEY (64 hex)");
  if (missing.length) throw new Error(`Variáveis de ambiente faltando: ${missing.join(", ")}`);
}
