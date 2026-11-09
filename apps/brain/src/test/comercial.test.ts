/**
 * Fase 4 (produto): cadastro de clientes, bloqueio por status e cobrança no Asaas (API falsa).
 * Rode com:  TEST_DATABASE_URL=postgres://... npm test
 * (o banco precisa das migrações até a 0007 e de um esquema "auth" mínimo; os dados de teste são apagados no fim)
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

const DB = process.env.TEST_DATABASE_URL;

describe("Tavinho como produto (cadastro, bloqueio, Asaas)", { skip: !DB && "TEST_DATABASE_URL não definido" }, () => {
  let mods: any;
  let asaas: Server;
  let meta: Server;
  const enviadas: any[] = [];
  const chamadas: { method: string; path: string; body: any }[] = [];
  let plataformaId: string;
  let tinhaAsaas = false;
  const criados: string[] = [];

  before(async () => {
    asaas = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const body = data ? JSON.parse(data) : null;
        chamadas.push({ method: req.method!, path: req.url!, body });
        assert.ok(String(req.headers.access_token).startsWith("$aact_teste"), "chave enviada no cabeçalho access_token");
        res.setHeader("content-type", "application/json");
        if (req.url === "/customers" && req.method === "POST") return res.end(JSON.stringify({ id: "cus_1" }));
        if (req.url === "/subscriptions" && req.method === "POST") return res.end(JSON.stringify({ id: "sub_1" }));
        if (req.url?.startsWith("/subscriptions/sub_1/payments")) {
          return res.end(JSON.stringify({ data: [{ id: "pay_1", value: body?.value ?? 99, status: "PENDING", dueDate: "2026-11-23", invoiceUrl: "https://asaas/i/pay_1", subscription: "sub_1" }] }));
        }
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((r) => asaas.listen(0, r));
    process.env.ASAAS_BASE_URL = `http://127.0.0.1:${(asaas.address() as any).port}`;

    // Meta (Graph API) falsa
    meta = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        const base = `http://127.0.0.1:${(meta.address() as any).port}`;
        if (req.method === "GET" && req.url?.startsWith("/1234567890?")) return res.end(JSON.stringify({ display_phone_number: "+55 31 3333-4444", verified_name: "Padaria Teste" }));
        if (req.method === "GET" && req.url === "/midia_1") return res.end(JSON.stringify({ url: `${base}/arquivo`, mime_type: "audio/ogg" }));
        if (req.method === "GET" && req.url === "/arquivo") return res.end("AUDIO");
        if (req.method === "POST" && req.url === "/1234567890/messages") {
          const b = JSON.parse(data);
          enviadas.push(b);
          if (b.type === "text" && b.to === "5531900000000") {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }));
          }
          return res.end(JSON.stringify({ messages: [{ id: "wamid.out" }] }));
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => meta.listen(0, r));
    process.env.WHATSAPP_GRAPH_URL = `http://127.0.0.1:${(meta.address() as any).port}`;
    process.env.ANTHROPIC_API_KEY ??= "test";
    process.env.DATABASE_URL = DB;
    process.env.BRAIN_API_SECRET ??= "s";
    process.env.ENCRYPTION_KEY ??= "a".repeat(64);
    process.env.WHATSAPP_ENABLED = "false";

    const db = await import("../lib/db.js");
    await db.connectDb();
    mods = {
      db,
      cadastro: await import("../lib/cadastro.js"),
      asaas: await import("../lib/asaas.js"),
      plat: await import("../lib/plataforma.js"),
      orch: await import("../agent/orchestrator.js"),
      users: await import("../lib/users.js"),
    };
    const sql = db.db();
    const [p] = await sql`select id from tenants where plataforma`;
    assert.ok(p, "existe o tenant da plataforma");
    plataformaId = p.id;
    tinhaAsaas = !!(await sql`select 1 from integrations where tenant_id = ${plataformaId} and tipo = 'asaas'`).length;
  });

  after(async () => {
    const sql = mods?.db.db();
    if (sql) {
      for (const t of criados) {
        await sql`delete from auth.users where id in (select auth_user_id from users where tenant_id = ${t} and auth_user_id is not null)`.catch(() => {});
        await sql`delete from tenants where id = ${t}`;
      }
      if (!tinhaAsaas) await sql`delete from integrations where tenant_id = ${plataformaId} and tipo = 'asaas'`;
      await sql`delete from webhook_eventos where id like 'evt_teste_%' or id like 'wamid.teste%'`;
      (await import("../scheduler.js")).stopScheduler();
      await sql.end({ timeout: 2 });
    }
    asaas?.close();
    meta?.close();
  });

  it("valida CPF e CNPJ", () => {
    const { cpfValido, cnpjValido } = mods.cadastro;
    assert.ok(cnpjValido("11222333000181"));
    assert.ok(!cnpjValido("11222333000180"));
    assert.ok(cpfValido("52998224725"));
    assert.ok(!cpfValido("11111111111"));
  });

  it("cadastra um cliente em teste, com login próprio, e cria a assinatura no fim do teste", async () => {
    const sql = mods.db.db();
    await mods.asaas.salvarChaveAsaas(null, "$aact_teste_123456789012345", true);
    const r = await mods.cadastro.cadastrarCliente(
      { empresa: "Padaria Teste E2E", documento: "11.222.333/0001-81", responsavel: "Maria Teste", email: "maria@example.com", whatsapp: "(31) 98888-1234", login: "maria.teste.e2e", senha: "Senha1234" },
      "10.0.0.1",
    );
    criados.push(r.tenantId);
    const [t] = await sql`select status, teste_ate, documento, asaas_cliente_id, asaas_assinatura_id, usuarios_cobrados, valor_mensal from tenants where id = ${r.tenantId}`;
    assert.equal(t.status, "teste");
    assert.ok(t.teste_ate > new Date(Date.now() + 13 * 86400_000));
    assert.equal(t.documento, "11222333000181");
    assert.equal(t.asaas_assinatura_id, "sub_1");
    assert.equal(t.usuarios_cobrados, 1);
    const [u] = await sql`select perfil, whatsapp, auth_user_id from users where tenant_id = ${r.tenantId}`;
    assert.equal(u.perfil, "dono");
    assert.equal(u.whatsapp, "5531988881234");
    const [au] = await sql`select email, raw_user_meta_data from auth.users where id = ${u.auth_user_id}`;
    assert.equal(au.email, "maria.teste.e2e@jarvis.local");
    assert.equal(au.raw_user_meta_data.trocar_senha, false, "quem se cadastra já escolheu a senha");
    const sub = chamadas.find((c) => c.path === "/subscriptions" && c.method === "POST")!;
    assert.equal(sub.body.billingType, "UNDEFINED");
    assert.equal(sub.body.cycle, "MONTHLY");
    assert.equal(sub.body.value, 99);
    assert.equal(sub.body.nextDueDate, new Date(t.teste_ate.getTime() - 3 * 3600_000).toISOString().slice(0, 10));

    await assert.rejects(
      mods.cadastro.cadastrarCliente({ empresa: "Outra", documento: "52998224725", responsavel: "Zé", email: "ze@example.com", whatsapp: "31988881234", login: "ze.teste.e2e", senha: "Senha1234" }, "10.0.0.2"),
      /WhatsApp já está cadastrado/,
    );
    await assert.rejects(
      mods.cadastro.cadastrarCliente({ empresa: "Outra", documento: "123", responsavel: "Zé", email: "ze@example.com", whatsapp: "31977771234", login: "ze.teste.e2e", senha: "Senha1234" }, "10.0.0.2"),
      /CPF ou CNPJ inválido/,
    );

    // novo usuário ativo → valor da assinatura dobra (preço por usuário)
    await sql`insert into users (tenant_id, nome, perfil) values (${r.tenantId}, 'João Teste', 'operador')`;
    const s = await mods.asaas.sincronizarUsuarios(r.tenantId);
    assert.deepEqual(s, { usuarios: 2, valor: 198, mudou: true });
    const upd = chamadas.find((c) => c.path === "/subscriptions/sub_1" && c.method === "POST")!;
    assert.equal(upd.body.value, 198);
    assert.equal(upd.body.updatePendingPayments, true);
    assert.equal((await mods.asaas.sincronizarUsuarios(r.tenantId)).mudou, false, "sem mudança, não chama o Asaas");
  });

  it("webhook do Asaas: token, idempotência, atraso → bloqueio e pagamento → liberado", async () => {
    const sql = mods.db.db();
    const [t] = await sql`select id from tenants where asaas_assinatura_id = 'sub_1' and not plataforma`;
    const token = await mods.asaas.tokenWebhook();
    const pay = { id: "pay_1", value: 198, status: "OVERDUE", dueDate: "2026-11-23", subscription: "sub_1", invoiceUrl: "https://asaas/i/pay_1" };

    assert.equal((await mods.asaas.webhookAsaas("errado", { id: "evt_teste_0", event: "PAYMENT_OVERDUE", payment: pay })).status, 401);

    await mods.asaas.webhookAsaas(token, { id: "evt_teste_1", event: "PAYMENT_OVERDUE", payment: pay });
    let [x] = await sql`select status, atraso_desde from tenants where id = ${t.id}`;
    assert.equal(x.status, "inadimplente");
    mods.plat.invalidarTenant(t.id);
    assert.equal((await mods.plat.situacaoTenant(t.id)).liberado, true, "dentro da tolerância ainda funciona");

    // passou da tolerância → o assistente responde que está suspenso
    await sql`update tenants set atraso_desde = now() - interval '10 days' where id = ${t.id}`;
    mods.plat.invalidarTenant(t.id);
    const dono = await mods.users.userById((await sql`select id from users where tenant_id = ${t.id} and perfil = 'dono'`)[0].id);
    const r = await mods.orch.runTask({ user: dono, canal: "whatsapp", texto: "oi" });
    assert.match(r.resposta, /suspenso/);
    const rot = await mods.asaas.rotinaCobranca();
    assert.ok(rot.bloqueados >= 1);
    assert.equal((await sql`select status from tenants where id = ${t.id}`)[0].status, "bloqueado");

    const pago = { ...pay, status: "RECEIVED", paymentDate: "2026-11-24", billingType: "PIX" };
    await mods.asaas.webhookAsaas(token, { id: "evt_teste_2", event: "PAYMENT_RECEIVED", payment: pago });
    [x] = await sql`select status, atraso_desde from tenants where id = ${t.id}`;
    assert.equal(x.status, "ativo");
    assert.equal(x.atraso_desde, null);
    const [c] = await sql`select status, forma, pago_em from cobrancas where asaas_id = 'pay_1'`;
    assert.equal(c.status, "RECEIVED");
    assert.equal(c.forma, "PIX");

    const rep = await mods.asaas.webhookAsaas(token, { id: "evt_teste_2", event: "PAYMENT_RECEIVED", payment: pago });
    assert.equal(rep.repetido, true, "evento repetido é ignorado");
  });

  it("teste vencido bloqueia o assistente; a plataforma nunca é bloqueada", async () => {
    const sql = mods.db.db();
    const [t] = await sql`insert into tenants (nome, status, teste_ate) values ('Teste Vencido E2E', 'teste', now() - interval '1 day') returning id`;
    criados.push(t.id);
    const s = await mods.plat.situacaoTenant(t.id);
    assert.equal(s.liberado, false);
    assert.match(s.motivo, /teste/);
    assert.equal((await mods.plat.situacaoTenant(plataformaId)).liberado, true);
  });

  it("WhatsApp oficial: conecta, confere a assinatura, recebe áudio e cai para o modelo fora da janela de 24 h", async () => {
    const sql = mods.db.db();
    const cloud = await import("../channels/whatsappCloud.js");
    const [t] = await sql`select t.id, u.id as dono from tenants t join users u on u.tenant_id = t.id and u.perfil = 'dono' where t.asaas_assinatura_id = 'sub_1'`;
    const segredo = "segredo-do-app-meta-123";
    const r = await cloud.conectarCloud(t.id, t.dono, { phone_number_id: "1234567890", access_token: "EAAteste_token_de_acesso_longo", app_secret: segredo, template: "aviso_tavinho" });
    assert.equal(r.numero, "553133334444");
    assert.equal(r.nome, "Padaria Teste");

    assert.equal(await cloud.verificarWebhook({ "hub.mode": "subscribe", "hub.verify_token": r.verifyToken, "hub.challenge": "42" }), "42");
    assert.equal(await cloud.verificarWebhook({ "hub.mode": "subscribe", "hub.verify_token": "errado", "hub.challenge": "42" }), null);

    const payload = (id: string, from: string, msg: object) =>
      Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "1234567890" }, contacts: [{ wa_id: from, profile: { name: "Maria" } }], messages: [{ id, from, ...msg }] } }] }] }));
    const assina = (b: Buffer) => `sha256=${createHmac("sha256", segredo).update(b).digest("hex")}`;
    const recebidas: any[] = [];
    const entregar = async (m: any) => void recebidas.push(m);

    const corpo = payload("wamid.teste1", "5531988881234", { type: "audio", audio: { id: "midia_1", mime_type: "audio/ogg" } });
    assert.equal(await cloud.receberWebhook(corpo, "sha256=errada", entregar), 401, "assinatura inválida é recusada");
    assert.equal(await cloud.receberWebhook(corpo, assina(corpo), entregar), 200);
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(recebidas.length, 1);
    assert.equal(recebidas[0].tenantId, t.id);
    assert.equal(recebidas[0].audio.buffer.toString(), "AUDIO");
    assert.equal(await cloud.receberWebhook(corpo, assina(corpo), entregar), 200);
    await new Promise((res) => setTimeout(res, 50));
    assert.equal(recebidas.length, 1, "a Meta reenviou: não processa duas vezes");

    // responder dentro da janela: texto normal
    await recebidas[0].responder("Oi, Maria!");
    assert.deepEqual(enviadas.at(-1).text, { body: "Oi, Maria!", preview_url: false });
    // fora da janela (a Meta recusa texto): manda o modelo aprovado com o texto como parâmetro
    await cloud.enviarCloud(t.id, "5531900000000", "Relatório da semana:\nvendas ok");
    const tpl = enviadas.at(-1);
    assert.equal(tpl.type, "template");
    assert.equal(tpl.template.name, "aviso_tavinho");
    assert.equal(tpl.template.components[0].parameters[0].text, "Relatório da semana: · vendas ok");

    // mensagem para o número da empresa vinda de alguém de outra empresa: não é atendida
    const { handleWhatsApp } = await import("../channels/inbound.js");
    const antes = (await sql`select count(*)::int n from blocked_attempts`)[0].n;
    await handleWhatsApp({ numero: "5511911112222", jid: "5511911112222", nome: "", texto: "oi", grupo: false, mencionado: false, tenantId: t.id, responder: async () => assert.fail("não deveria responder") });
    assert.equal((await sql`select count(*)::int n from blocked_attempts`)[0].n, antes + 1);
    await sql`delete from blocked_attempts where remetente = '5511911112222'`;
  });
});
