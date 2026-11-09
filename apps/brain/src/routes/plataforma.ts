import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { User } from "../agent/types.js";
import {
  asaasConfigurado,
  atualizarCobrancas,
  cancelarAssinatura,
  criarAssinatura,
  salvarChaveAsaas,
  sincronizarUsuarios,
  tokenWebhook,
  webhookAsaas,
} from "../lib/asaas.js";
import { cadastrarCliente, ErroCadastro } from "../lib/cadastro.js";
import { config } from "../lib/config.js";
import { audit, db } from "../lib/db.js";
import { log } from "../lib/log.js";
import { configPlataforma, invalidarTenant, precoUsuario, situacaoTenant, usuariosAtivos } from "../lib/plataforma.js";
import { handleWhatsApp } from "../channels/inbound.js";
import { conectarCloud, enviarCloud, receberWebhook, statusCloud, verificarWebhook } from "../channels/whatsappCloud.js";
import { auth, needUser } from "./api.js";

/** Só o dono do tenant da plataforma (Domma) administra os clientes. */
async function needPlataforma(req: FastifyRequest): Promise<User> {
  const u = needUser(req);
  const s = await situacaoTenant(u.tenant_id);
  if (u.perfil !== "dono" || !s.plataforma) throw Object.assign(new Error("apenas a administração da plataforma"), { statusCode: 403 });
  return u;
}
function needDono(req: FastifyRequest): User {
  const u = needUser(req);
  if (u.perfil !== "dono") throw Object.assign(new Error("apenas o responsável pela conta"), { statusCode: 403 });
  return u;
}

export async function registerPlataformaRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------- webhook do Asaas (público, com token)
  app.post("/webhooks/asaas", async (req, reply) => {
    const token = String(req.headers["asaas-access-token"] ?? "");
    try {
      const r = await webhookAsaas(token, (req.body ?? {}) as Parameters<typeof webhookAsaas>[1]);
      return reply.code(r.status).send({ ok: r.status === 200 });
    } catch (err) {
      log.error({ err }, "webhook do Asaas falhou");
      return reply.code(500).send({ ok: false }); // o Asaas tenta de novo
    }
  });

  // ------------------------------------------------------------- webhook da API oficial do WhatsApp (público, assinado pela Meta)
  app.register(async (w) => {
    // a assinatura é calculada sobre o corpo original: não deixa o Fastify converter
    w.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    w.get("/webhooks/whatsapp", async (req, reply) => {
      const desafio = await verificarWebhook(req.query as Record<string, string>);
      if (desafio === null) return reply.code(403).send("token inválido");
      return reply.type("text/plain").send(desafio);
    });
    w.post("/webhooks/whatsapp", async (req, reply) => {
      const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
      const status = await receberWebhook(corpo, String(req.headers["x-hub-signature-256"] ?? ""), handleWhatsApp);
      return reply.code(status).send({ ok: status === 200 });
    });
  });

  app.register(async (api) => {
    api.addHook("preHandler", auth);

    // ----------------------------------------------------------- WhatsApp oficial do cliente
    api.get("/api/integrations/whatsapp-cloud", async (req) => {
      const u = needDono(req);
      return { conta: await statusCloud(u.tenant_id), webhook_url: `${config.panelUrl}/webhooks/whatsapp` };
    });
    api.post("/api/integrations/whatsapp-cloud", async (req) => {
      const u = needDono(req);
      const b = z
        .object({
          phone_number_id: z.string().regex(/^\d{5,30}$/, "O identificador do número tem só dígitos"),
          access_token: z.string().min(20).max(1000),
          app_secret: z.string().min(16).max(200),
          template: z.string().max(100).nullish(),
          idioma: z.string().max(10).nullish(),
        })
        .parse(req.body);
      try {
        return { ok: true, ...(await conectarCloud(u.tenant_id, u.id, { ...b, template: b.template ?? null, idioma: b.idioma ?? "pt_BR" })) };
      } catch (err) {
        throw Object.assign(new Error(`A Meta recusou: ${(err as Error).message}`), { statusCode: 400 });
      }
    });
    api.post("/api/integrations/whatsapp-cloud/teste", async (req) => {
      const u = needDono(req);
      if (!u.whatsapp) throw Object.assign(new Error("cadastre seu WhatsApp em Autonomia e conta"), { statusCode: 400 });
      await enviarCloud(u.tenant_id, u.whatsapp, "👋 Olá! Aqui é o Tavinho, pelo número oficial da sua empresa. Pode me mandar mensagens por aqui.");
      return { ok: true };
    });
    api.post("/api/integrations/whatsapp-cloud/desconectar", async (req) => {
      const u = needDono(req);
      await db()`delete from integrations where tenant_id = ${u.tenant_id} and tipo = 'whatsapp_cloud'`;
      await audit(u.id, "integracao.whatsapp_cloud.desconectar");
      return { ok: true };
    });

    // ----------------------------------------------------------- cadastro público (o painel chama sem usuário)
    api.post("/api/cadastro", async (req, reply) => {
      const b = z
        .object({
          empresa: z.string().max(200),
          documento: z.string().max(30),
          responsavel: z.string().max(200),
          email: z.string().max(200),
          whatsapp: z.string().max(30),
          login: z.string().max(100),
          senha: z.string().max(200),
          ip: z.string().max(100).default("?"),
        })
        .parse(req.body);
      try {
        const r = await cadastrarCliente(b, b.ip);
        return { ok: true, login: r.login, teste_ate: r.testeAte };
      } catch (err) {
        if (err instanceof ErroCadastro) return reply.code(400).send({ error: err.message });
        log.error({ err }, "cadastro falhou");
        return reply.code(500).send({ error: "Não consegui concluir o cadastro agora. Tente de novo em alguns minutos." });
      }
    });

    // ----------------------------------------------------------- assinatura do próprio cliente
    api.get("/api/assinatura", async (req) => {
      const u = needDono(req);
      const sql = db();
      await atualizarCobrancas(u.tenant_id).catch((err) => log.warn({ err }, "faturas do Asaas"));
      const [t] = await sql<any[]>`
        select nome, status, plataforma, teste_ate, usuarios_cobrados, valor_mensal, asaas_assinatura_id is not null as tem_assinatura, atraso_desde
        from tenants where id = ${u.tenant_id}`;
      const cobrancas = await sql<any[]>`
        select valor, status, forma, vencimento, pago_em, link from cobrancas where tenant_id = ${u.tenant_id} order by vencimento desc nulls last limit 12`;
      const [usuarios, preco, sit, cfg] = await Promise.all([usuariosAtivos(u.tenant_id), precoUsuario(u.tenant_id), situacaoTenant(u.tenant_id), configPlataforma()]);
      return { tenant: t, cobrancas, usuarios, preco, situacao: sit, asaas: await asaasConfigurado(), limite_ia_usuario_usd: cfg.limite_ia_usuario_usd };
    });

    api.post("/api/assinatura/assinar", async (req) => {
      const u = needDono(req);
      const r = await criarAssinatura(u.tenant_id);
      if (!r.ok) throw Object.assign(new Error("A cobrança online ainda não está disponível. Fale com a Domma."), { statusCode: 400 });
      await atualizarCobrancas(u.tenant_id).catch(() => {});
      return r;
    });

    // chamado pelo painel quando usuários são criados, ativados ou desativados
    api.post("/api/assinatura/sincronizar", async (req) => {
      const u = needUser(req);
      return (await sincronizarUsuarios(u.tenant_id)) ?? { mudou: false };
    });

    // ----------------------------------------------------------- administração da plataforma (Domma)
    api.get("/api/plataforma", async (req) => {
      await needPlataforma(req);
      const sql = db();
      const clientes = await sql<any[]>`
        select t.id, t.nome, t.status, t.criado_em, t.teste_ate, t.documento, t.email_cobranca, t.telefone, t.preco_usuario,
               t.usuarios_cobrados, t.valor_mensal, t.asaas_assinatura_id is not null as tem_assinatura, t.atraso_desde,
               (select count(*)::int from users u where u.tenant_id = t.id and u.ativo) as usuarios,
               (select coalesce(sum(k.custo), 0) from tasks k join users u on u.id = k.user_id
                 where u.tenant_id = t.id and k.inicio >= date_trunc('month', now() at time zone 'America/Sao_Paulo')) as custo_ia_mes,
               (select max(k.inicio) from tasks k join users u on u.id = k.user_id where u.tenant_id = t.id) as ultimo_uso
        from tenants t where not t.plataforma order by t.criado_em desc`;
      const k = await tokenWebhook();
      return {
        clientes,
        config: await configPlataforma(),
        asaas: { configurado: !!k, webhook_url: `${config.panelUrl}/webhooks/asaas`, webhook_token: k },
      };
    });

    api.post("/api/plataforma/config", async (req) => {
      const u = await needPlataforma(req);
      const b = z
        .object({
          preco_usuario: z.number().min(0).max(100000),
          dias_teste: z.number().int().min(0).max(90),
          limite_ia_usuario_usd: z.number().min(0).max(10000),
          tolerancia_dias: z.number().int().min(0).max(60),
        })
        .parse(req.body);
      await db()`update plataforma_config set preco_usuario = ${b.preco_usuario}, dias_teste = ${b.dias_teste},
                 limite_ia_usuario_usd = ${b.limite_ia_usuario_usd}, tolerancia_dias = ${b.tolerancia_dias}, atualizado_em = now()`;
      invalidarTenant();
      await audit(u.id, "plataforma.config", null, null, b);
      return { ok: true };
    });

    api.post("/api/plataforma/asaas", async (req) => {
      const u = await needPlataforma(req);
      const b = z.object({ api_key: z.string().min(20).max(400), sandbox: z.boolean().default(false) }).parse(req.body);
      try {
        return { ok: true, ...(await salvarChaveAsaas(u.id, b.api_key.trim(), b.sandbox)) };
      } catch (err) {
        throw Object.assign(new Error(`O Asaas recusou a chave: ${(err as Error).message}`), { statusCode: 400 });
      }
    });

    api.post("/api/plataforma/clientes/:id", async (req) => {
      const u = await needPlataforma(req);
      const { id } = req.params as { id: string };
      const b = z
        .object({
          acao: z.enum(["ativar", "bloquear", "estender_teste", "preco", "criar_assinatura", "cancelar", "sincronizar"]),
          dias: z.number().int().min(1).max(90).optional(),
          preco: z.number().min(0).max(100000).nullable().optional(),
        })
        .parse(req.body);
      const sql = db();
      const [t] = await sql<{ id: string; plataforma: boolean }[]>`select id, plataforma from tenants where id = ${id}`;
      if (!t || t.plataforma) throw Object.assign(new Error("cliente não encontrado"), { statusCode: 404 });
      let r: unknown = { ok: true };
      switch (b.acao) {
        case "ativar":
          await sql`update tenants set status = 'ativo', atraso_desde = null, bloqueado_em = null where id = ${id}`;
          break;
        case "bloquear":
          await sql`update tenants set status = 'bloqueado', bloqueado_em = now() where id = ${id}`;
          break;
        case "estender_teste":
          await sql`update tenants set status = 'teste', teste_ate = greatest(coalesce(teste_ate, now()), now()) + make_interval(days => ${b.dias ?? 7}) where id = ${id}`;
          break;
        case "preco":
          await sql`update tenants set preco_usuario = ${b.preco ?? null} where id = ${id}`;
          r = await sincronizarUsuarios(id);
          break;
        case "criar_assinatura":
          r = await criarAssinatura(id);
          break;
        case "cancelar":
          await cancelarAssinatura(id, u.id);
          break;
        case "sincronizar":
          r = await sincronizarUsuarios(id);
          break;
      }
      invalidarTenant(id);
      await audit(u.id, `plataforma.cliente.${b.acao}`, id, null, b);
      return r;
    });
  });
}
