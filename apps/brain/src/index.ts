import cors from "@fastify/cors";
import Fastify from "fastify";
import { handleWhatsApp } from "./channels/inbound.js";
import { onWhatsAppMessage, startWhatsApp, stopWhatsApp } from "./channels/whatsapp.js";
import { config, requireConfig } from "./lib/config.js";
import { connectDb, db } from "./lib/db.js";
import { log } from "./lib/log.js";
import { hasStoredKey, loadStoredKeys } from "./lib/keys.js";
import { registerRoutes } from "./routes/api.js";
import { registerDeviceRoutes } from "./routes/device.js";
import { registerPlataformaRoutes } from "./routes/plataforma.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

async function main() {
  requireConfig();
  await connectDb();
  await loadStoredKeys();
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !(await hasStoredKey("anthropic"))) {
    log.warn("Chave da API do Claude não configurada — cadastre no painel (Integrações).");
  }

  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  await app.register(cors, { origin: [config.panelUrl], credentials: true });
  await registerRoutes(app);
  await registerDeviceRoutes(app);
  await registerPlataformaRoutes(app);
  // "::" aceita IPv4 e IPv6 (a rede privada do Railway usa IPv6)
  await app.listen({ port: config.port, host: "::" });
  log.info({ port: config.port }, "cérebro do Tavinho no ar");

  onWhatsAppMessage(handleWhatsApp);
  await startWhatsApp().catch((err) => log.error({ err }, "falha ao iniciar WhatsApp"));
  await startScheduler();

  const shutdown = async (sig: string) => {
    log.info({ sig }, "encerrando");
    stopScheduler();
    stopWhatsApp();
    await app.close().catch(() => {});
    await db().end({ timeout: 5 }).catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.fatal({ err }, "falha ao iniciar");
  process.exit(1);
});
