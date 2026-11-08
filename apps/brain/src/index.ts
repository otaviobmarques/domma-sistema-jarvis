import cors from "@fastify/cors";
import Fastify from "fastify";
import { handleWhatsApp } from "./channels/inbound.js";
import { onWhatsAppMessage, startWhatsApp, stopWhatsApp } from "./channels/whatsapp.js";
import { config, requireConfig } from "./lib/config.js";
import { connectDb, db } from "./lib/db.js";
import { log } from "./lib/log.js";
import { registerRoutes } from "./routes/api.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

async function main() {
  requireConfig();
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    log.warn("ANTHROPIC_API_KEY não definida — o Jarvis sobe, mas não vai conseguir pensar até você configurar.");
  }
  await connectDb();

  const app = Fastify({ logger: false, bodyLimit: 25 * 1024 * 1024 });
  await app.register(cors, { origin: [config.panelUrl], credentials: true });
  await registerRoutes(app);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info({ port: config.port }, "cérebro do Jarvis no ar");

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
