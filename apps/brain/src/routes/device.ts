import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { handleApprovalReply } from "../agent/approvals.js";
import { runTask } from "../agent/orchestrator.js";
import { panic } from "../agent/panic.js";
import { nomeAssistente } from "../agent/prompt.js";
import { transcribe } from "../channels/stt.js";
import { autenticar, marcarVisto, parear, proximaAcao, receberResultado } from "../lib/devices.js";
import { userById } from "../lib/users.js";
import { audit, db } from "../lib/db.js";
import { sintetizar, ttsConfigurado } from "../lib/tts.js";

declare module "fastify" {
  interface FastifyRequest {
    device?: { id: string; user_id: string; nome: string; tipo: string };
  }
}

/** API usada pelo app do Jarvis no PC (e, na Fase 3, no Android). Autenticação: Bearer <token do dispositivo>. */
export async function registerDeviceRoutes(app: FastifyInstance) {
  app.post("/device/pair", async (req, reply) => {
    const b = z
      .object({ codigo: z.string().min(4).max(12), nome: z.string().min(1).max(80), tipo: z.enum(["pc", "android"]).default("pc"), info: z.record(z.string(), z.unknown()).default({}) })
      .parse(req.body);
    const r = await parear(b.codigo, b.nome, b.tipo, b.info);
    if (!r) return reply.code(400).send({ error: "Código inválido ou expirado. Gere outro no painel (Dispositivos)." });
    const u = await userById(r.userId);
    return { device_id: r.deviceId, token: r.token, usuario: u?.nome ?? "" };
  });

  app.register(async (dev) => {
    dev.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
      const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const d = await autenticar(token);
      if (!d) return reply.code(401).send({ error: "Dispositivo não autorizado. Pareie de novo." });
      req.device = d;
    });

    dev.get("/device/me", async (req) => {
      const u = await userById(req.device!.user_id);
      return { device: req.device, usuario: u ? { nome: u.nome, perfil: u.perfil, pausado: u.pausado, nome_assistente: nomeAssistente(u) } : null };
    });

    // Long-poll: devolve a próxima ação ou {acao:null} após ~25 s
    dev.post("/device/poll", async (req) => {
      const b = z.object({ info: z.record(z.string(), z.unknown()).nullish() }).parse(req.body ?? {});
      await marcarVisto(req.device!.id, b.info ?? undefined);
      const a = await proximaAcao(req.device!.id, 25_000);
      await marcarVisto(req.device!.id);
      return { acao: a };
    });

    dev.post("/device/result", async (req) => {
      const b = z
        .object({
          id: z.string().uuid(),
          ok: z.boolean(),
          texto: z.string().max(200_000).default(""),
          imagem: z.object({ media_type: z.enum(["image/png", "image/jpeg"]), data: z.string().max(8_000_000) }).optional(),
        })
        .parse(req.body);
      await receberResultado(req.device!.id, b.id, b);
      return { ok: true };
    });

    dev.post("/device/transcribe", async (req) => {
      const { audio, mime } = z.object({ audio: z.string().min(100).max(20_000_000), mime: z.string().max(100) }).parse(req.body);
      const u = await userById(req.device!.user_id);
      return { texto: await transcribe(Buffer.from(audio, "base64"), mime, u ? nomeAssistente(u) : "") };
    });

    // Preferências vindas do app (ex.: nome do assistente)
    dev.post("/device/preferencias", async (req) => {
      const b = z.object({ nome_assistente: z.string().trim().min(1).max(30).optional() }).parse(req.body ?? {});
      const sql = db();
      if (b.nome_assistente) {
        await sql`update users set preferencias = preferencias || ${sql.json({ nome_assistente: b.nome_assistente })} where id = ${req.device!.user_id}`;
      }
      const u = await userById(req.device!.user_id);
      return { nome_assistente: u ? nomeAssistente(u) : b.nome_assistente ?? "Jarvis" };
    });

    // Voz natural para as respostas
    dev.post("/device/tts", async (req) => {
      const { texto } = z.object({ texto: z.string().min(1).max(4000) }).parse(req.body);
      if (!ttsConfigurado()) return { audio: null, motivo: "voz natural não configurada" };
      const r = await sintetizar(texto);
      return { audio: r.audio.toString("base64"), mime: r.mime };
    });

    dev.get("/device/versao", async () => {
      const [r] = await db()<{ versao: string; url: string; notas: string | null }[]>`
        select versao, url, notas from app_releases where plataforma = 'windows'
        order by string_to_array(versao, '.')::int[] desc limit 1`;
      return r ?? null;
    });

    dev.post("/device/resume", async (req) => {
      await db()`update users set pausado = false where id = ${req.device!.user_id}`;
      await audit(req.device!.user_id, "retomar", "app", null, null, req.device!.nome);
      return { ok: true };
    });

    // Botão de pânico do app (bandeja ou janela)
    dev.post("/device/panic", async (req) => {
      const n = await panic(req.device!.user_id, { pausar: true });
      return { interrompidas: n };
    });

    // Pedido feito no PC (texto ou voz já transcrita)
    dev.post("/device/chat", async (req) => {
      const { texto, voz } = z.object({ texto: z.string().min(1).max(20000), voz: z.boolean().default(false) }).parse(req.body);
      const user = await userById(req.device!.user_id);
      if (!user || !user.ativo) return { resposta: "Usuário inativo." };
      const ap = await handleApprovalReply(user, texto, voz ? "voz" : "app");
      if (ap) return { resposta: ap };
      const r = await runTask({ user, canal: voz ? "voz" : "app", texto, deviceId: req.device!.id });
      return r;
    });
  });
}
