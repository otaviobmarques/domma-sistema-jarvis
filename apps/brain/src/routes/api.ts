import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { google } from "googleapis";
import { z } from "zod";
import { execute, handleApprovalReply, reject } from "../agent/approvals.js";
import { runTask } from "../agent/orchestrator.js";
import { nomeAssistente } from "../agent/prompt.js";
import { transcribe } from "../channels/stt.js";
import { panic, runningCount } from "../agent/panic.js";
import type { User } from "../agent/types.js";
import { logoutWhatsApp, sendWhatsApp, whatsappStatus } from "../channels/whatsapp.js";
import { config } from "../lib/config.js";
import { hashPin, safeEqual } from "../lib/crypto.js";
import { audit, db } from "../lib/db.js";
import { GOOGLE_SCOPES, getIntegration, googleOAuthClient, saveIntegration } from "../lib/integrations.js";
import { applyGoogle, applyKey } from "../lib/keys.js";
import { listarVozes, sintetizar, tts, ttsConfigurado } from "../lib/tts.js";
import { log } from "../lib/log.js";
import { invalidarUsuario, userById } from "../lib/users.js";
import { criarCodigoPareamento, isOnline, revogar } from "../lib/devices.js";
import { reloadRoutines, runRoutine } from "../scheduler.js";

declare module "fastify" {
  interface FastifyRequest {
    jarvisUser?: User;
  }
}

/** O painel autentica o usuário (Supabase Auth) e chama o cérebro com o segredo compartilhado + id do usuário. */
async function auth(req: FastifyRequest, reply: FastifyReply) {
  const secret = String(req.headers["x-jarvis-secret"] ?? "");
  if (!config.apiSecret || !safeEqual(secret, config.apiSecret)) return reply.code(401).send({ error: "não autorizado" });
  const uid = String(req.headers["x-jarvis-user"] ?? "");
  if (uid) {
    const u = await userById(uid);
    if (!u || !u.ativo) return reply.code(403).send({ error: "usuário inválido" });
    req.jarvisUser = u;
  }
}

const needUser = (req: FastifyRequest) => {
  if (!req.jarvisUser) throw Object.assign(new Error("x-jarvis-user obrigatório"), { statusCode: 400 });
  return req.jarvisUser;
};
const needOwner = (req: FastifyRequest) => {
  const u = needUser(req);
  if (u.perfil !== "dono") throw Object.assign(new Error("apenas o dono"), { statusCode: 403 });
  return u;
};

function sign(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", config.apiSecret).update(body).digest("base64url")}`;
}
function verify<T>(token: string): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", config.apiSecret).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString()) as T & { exp: number };
  return data.exp > Date.now() ? data : null;
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, whatsapp: whatsappStatus().conectado, rodando: runningCount() }));

  // ------------------------------------------------------------- OAuth Google (público, protegido por token assinado)
  app.get("/oauth/google/start", async (req, reply) => {
    const { t } = req.query as { t?: string };
    const data = t ? verify<{ uid: string }>(t) : null;
    if (!data) return reply.code(400).send("link expirado — gere outro no painel");
    if (!config.google.clientId) return reply.code(400).send("GOOGLE_CLIENT_ID não configurado no servidor");
    const url = googleOAuthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPES,
      state: sign({ uid: data.uid, exp: Date.now() + 10 * 60_000 }),
    });
    return reply.redirect(url);
  });

  app.get("/oauth/google/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const data = state ? verify<{ uid: string }>(state) : null;
    const { error } = req.query as { error?: string };
    if (error) return reply.redirect(`${config.panelUrl}/integracoes?google=${encodeURIComponent(error)}`);
    if (!code || !data) {
      return reply
        .code(400)
        .type("text/html; charset=utf-8")
        .send(`<meta charset="utf-8"><p style="font-family:sans-serif">Este endereço é o retorno do login do Google e não deve ser aberto diretamente.<br>Para conectar, use o botão <b>Conectar conta Google</b> em <a href="${config.panelUrl}/integracoes">Integrações</a>.</p>`);
    }
    const user = await userById(data.uid);
    if (!user) return reply.code(400).send("usuário inválido");
    const client = googleOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const me = await google.oauth2({ version: "v2", auth: client }).userinfo.get().catch(() => null);
    await saveIntegration({
      tenantId: user.tenant_id,
      userId: user.id,
      tipo: "google",
      tokens: tokens as Record<string, unknown>,
      config: { email: me?.data.email ?? null },
      escopos: (tokens.scope ?? "").split(" "),
    });
    await audit(user.id, "integracao.google.conectar", me?.data.email ?? null);
    return reply.redirect(`${config.panelUrl}/integracoes?google=ok`);
  });

  // ------------------------------------------------------------- API do painel
  app.register(async (api) => {
    api.addHook("preHandler", auth);

    api.post("/api/devices/pair-code", async (req) => {
      const u = needUser(req);
      return criarCodigoPareamento(u.id);
    });
    api.get("/api/devices", async (req) => {
      const u = needUser(req);
      const rows = await db()<{ id: string; tipo: string; nome: string; status: string; ultimo_contato: Date | null; info: unknown }[]>`
        select id, tipo, nome, status, ultimo_contato, info from devices where user_id = ${u.id} and ativo order by criado_em`;
      return rows.map((r) => ({ ...r, online: isOnline(r.id) }));
    });
    api.post("/api/devices/:id/revoke", async (req) => {
      const u = needUser(req);
      await revogar((req.params as { id: string }).id, u.id);
      return { ok: true };
    });

    api.get("/api/tts/voices", async (req) => {
      needOwner(req);
      return listarVozes();
    });
    api.post("/api/tts/voice", async (req) => {
      const u = needOwner(req);
      const { voice_id } = z.object({ voice_id: z.string().min(5).max(64) }).parse(req.body);
      await db()`update integrations set config = config || ${db().json({ voice_id })} where tenant_id = ${u.tenant_id} and tipo = 'tts'`;
      tts.voiceId = voice_id;
      return { ok: true };
    });
    api.post("/api/tts", async (req) => {
      needUser(req);
      const { texto } = z.object({ texto: z.string().min(1).max(4000) }).parse(req.body);
      const r = await sintetizar(texto);
      return { audio: r.audio.toString("base64"), mime: r.mime };
    });

    api.post("/api/transcribe", async (req) => {
      const u = needUser(req);
      const { audio, mime } = z.object({ audio: z.string().min(100).max(20_000_000), mime: z.string().max(100) }).parse(req.body);
      const texto = await transcribe(Buffer.from(audio, "base64"), mime, nomeAssistente(u));
      return { texto };
    });

    api.post("/api/chat", async (req) => {
      const user = needUser(req);
      const { texto } = z.object({ texto: z.string().min(1).max(20000) }).parse(req.body);
      const ap = await handleApprovalReply(user, texto, "painel");
      if (ap) return { resposta: ap };
      const r = await runTask({ user, canal: "painel", texto });
      return r;
    });

    api.get("/api/whatsapp", async () => whatsappStatus());
    api.post("/api/whatsapp/logout", async (req) => {
      const u = needOwner(req);
      await audit(u.id, "whatsapp.logout");
      await logoutWhatsApp();
      return { ok: true };
    });
    api.post("/api/whatsapp/test", async (req) => {
      const u = needUser(req);
      if (!u.whatsapp) throw Object.assign(new Error("cadastre seu número primeiro"), { statusCode: 400 });
      await sendWhatsApp(u.whatsapp, "👋 Olá! Aqui é o Jarvis. Seu número está conectado. Mande /ajuda para ver os comandos.");
      return { ok: true };
    });

    api.post("/api/approvals/:id/approve", async (req) => {
      const user = needUser(req);
      const { id } = req.params as { id: string };
      const { pin } = z.object({ pin: z.string().optional() }).parse(req.body ?? {});
      const sql = db();
      const [a] = await sql<{ nivel: string }[]>`select nivel from approvals where id = ${id} and user_id = ${user.id} and status = 'pendente'`;
      if (!a) return { resposta: "Não está mais pendente." };
      if (a.nivel !== "confirmar") {
        const { verifyPin } = await import("../lib/crypto.js");
        if (!pin || !verifyPin(pin, user.pin_hash)) {
          await audit(user.id, "aprovacao.pin_incorreto", id);
          throw Object.assign(new Error("PIN incorreto"), { statusCode: 400 });
        }
      }
      return { resposta: await execute(id, user, "painel") };
    });
    api.post("/api/approvals/:id/reject", async (req) => {
      const user = needUser(req);
      await reject((req.params as { id: string }).id, user, "painel");
      return { ok: true };
    });

    api.post("/api/panic", async (req) => {
      const user = needUser(req);
      const { global, pausar } = z.object({ global: z.boolean().default(false), pausar: z.boolean().default(true) }).parse(req.body ?? {});
      const n = await panic(user.id, { global: global && user.perfil === "dono", pausar });
      return { interrompidas: n };
    });
    api.post("/api/resume", async (req) => {
      const user = needUser(req);
      const { global } = z.object({ global: z.boolean().default(false) }).parse(req.body ?? {});
      const sql = db();
      if (global && user.perfil === "dono") await sql`update users set pausado = false where tenant_id = ${user.tenant_id}`;
      else await sql`update users set pausado = false where id = ${user.id}`;
      invalidarUsuario();
      await audit(user.id, "retomar", global ? "tenant" : "usuario");
      return { ok: true };
    });

    api.post("/api/routines/reload", async () => {
      await reloadRoutines();
      return { ok: true };
    });
    api.post("/api/routines/:id/run", async (req) => {
      const user = needUser(req);
      const { id } = req.params as { id: string };
      const sql = db();
      const [r] = await sql`select 1 from routines where id = ${id} and user_id = ${user.id}`;
      if (!r) throw Object.assign(new Error("rotina não encontrada"), { statusCode: 404 });
      const res = await runRoutine(id);
      return { resposta: res?.resposta ?? null };
    });

    api.post("/api/users/:id/pin", async (req) => {
      const actor = needUser(req);
      const { id } = req.params as { id: string };
      if (actor.id !== id && actor.perfil !== "dono") throw Object.assign(new Error("sem permissão"), { statusCode: 403 });
      const { pin } = z.object({ pin: z.string().regex(/^\d{6}$/) }).parse(req.body);
      await db()`update users set pin_hash = ${hashPin(pin)} where id = ${id} and tenant_id = ${actor.tenant_id}`;
      await audit(actor.id, "usuario.pin", id);
      return { ok: true };
    });

    api.get("/api/oauth/google/link", async (req) => {
      const user = needUser(req);
      return { url: `${config.publicUrl}/oauth/google/start?t=${encodeURIComponent(sign({ uid: user.id, exp: Date.now() + 10 * 60_000 }))}` };
    });

    api.post("/api/integrations/meta", async (req) => {
      const u = needOwner(req);
      const { token } = z.object({ token: z.string().min(20) }).parse(req.body);
      await saveIntegration({ tenantId: u.tenant_id, userId: null, tipo: "meta_ads", tokens: { access_token: token } });
      await audit(u.id, "integracao.meta.salvar");
      return { ok: true };
    });

    api.post("/api/integrations/key", async (req) => {
      const u = needOwner(req);
      const { tipo, key } = z.object({ tipo: z.enum(["anthropic", "stt", "tts"]), key: z.string().min(20).max(500) }).parse(req.body);
      if (tipo === "tts") {
        try {
          await listarVozes(key);
        } catch (err) {
          throw Object.assign(new Error((err as Error).message), { statusCode: 400 });
        }
      }
      if (tipo === "anthropic") {
        // valida a chave sem gastar tokens
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        try {
          await new Anthropic({ apiKey: key, maxRetries: 1 }).models.retrieve(config.modelStrong);
        } catch (err) {
          throw Object.assign(new Error(err instanceof Anthropic.AuthenticationError ? "Chave inválida" : `Não consegui validar: ${(err as Error).message}`), { statusCode: 400 });
        }
      }
      await saveIntegration({ tenantId: u.tenant_id, userId: null, tipo, tokens: { api_key: key } });
      applyKey(tipo, key);
      await audit(u.id, `integracao.${tipo}.salvar`);
      return { ok: true };
    });

    api.post("/api/integrations/google-oauth", async (req) => {
      const u = needOwner(req);
      const b = z
        .object({ client_id: z.string().regex(/\.apps\.googleusercontent\.com$/, "ID do cliente deve terminar em .apps.googleusercontent.com"), client_secret: z.string().min(10).max(200) })
        .parse(req.body);
      await saveIntegration({ tenantId: u.tenant_id, userId: null, tipo: "google_oauth", tokens: b });
      applyGoogle(b.client_id, b.client_secret);
      await audit(u.id, "integracao.google_oauth.salvar");
      return { ok: true };
    });

    api.get("/api/integrations/keys", async (req) => {
      const u = needOwner(req);
      const has = async (t: string) => !!(await getIntegration(u.tenant_id, t))?.tokens.api_key;
      return {
        anthropic: !!process.env.ANTHROPIC_API_KEY || (await has("anthropic")),
        stt: !!process.env.STT_API_KEY || (await has("stt")),
        tts: ttsConfigurado(),
        tts_voz: tts.voiceId || null,
        google: !!config.google.clientId,
      };
    });

    api.post("/api/integrations/postgres", async (req) => {
      const u = needOwner(req);
      const b = z.object({ nome: z.string().min(2), descricao: z.string().default(""), url: z.string().startsWith("postgres") }).parse(req.body);
      // Testa a conexão antes de salvar
      const postgres = (await import("postgres")).default;
      const test = postgres(b.url, { max: 1, connect_timeout: 10, prepare: false });
      try {
        await test`select 1`;
      } finally {
        await test.end({ timeout: 1 });
      }
      const sql = db();
      const { encrypt } = await import("../lib/crypto.js");
      await sql`
        insert into integrations (tenant_id, tipo, tokens_criptografados, config)
        values (${u.tenant_id}, 'postgres', ${encrypt(JSON.stringify({ url: b.url }))}, ${sql.json({ nome: b.nome, descricao: b.descricao })})`;
      await audit(u.id, "integracao.postgres.adicionar", b.nome);
      return { ok: true };
    });
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode ?? (err.name === "ZodError" ? 400 : 500);
    if (status >= 500) log.error({ err }, "erro na API");
    reply.code(status).send({ error: err.message });
  });
}
