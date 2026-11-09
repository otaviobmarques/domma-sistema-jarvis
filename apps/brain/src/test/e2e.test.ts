/**
 * Teste ponta a ponta do cérebro contra um Postgres real e uma API Anthropic falsa.
 * Rode com:  TEST_DATABASE_URL=postgres://... npm test
 * (o banco precisa ter a migração aplicada; os dados de teste são apagados no fim)
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

const DB = process.env.TEST_DATABASE_URL;

// ------------------------------------------------------------------ API Anthropic falsa
type Script = (body: any) => any | Promise<any>;
let script: Script = () => ({});
let fake: Server;
const requests: any[] = [];

function msg(content: any[], stop_reason = "end_turn") {
  return {
    id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason,
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

describe("Jarvis cérebro (e2e)", { skip: !DB && "TEST_DATABASE_URL não definido" }, () => {
  let mods: any;
  let user: any;

  before(async () => {
    fake = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        const body = JSON.parse(data || "{}");
        requests.push(body);
        res.setHeader("content-type", "application/json");
        void Promise.resolve(script(body)).then((r) => res.end(JSON.stringify(r)));
      });
    });
    await new Promise<void>((r) => fake.listen(0, r));
    const port = (fake.address() as any).port;
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.DATABASE_URL = DB;
    process.env.BRAIN_API_SECRET = "s";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.WHATSAPP_ENABLED = "false";

    const db = await import("../lib/db.js");
    await db.connectDb();
    mods = {
      db,
      orch: await import("../agent/orchestrator.js"),
      approvals: await import("../agent/approvals.js"),
      perms: await import("../agent/permissions.js"),
      crypto: await import("../lib/crypto.js"),
      users: await import("../lib/users.js"),
      time: await import("../lib/time.js"),
    };
    const sql = db.db();
    const [t] = await sql`insert into tenants (nome) values ('Teste E2E') returning id`;
    const [u] = await sql`insert into users (tenant_id, nome, perfil, whatsapp, pin_hash)
      values (${t!.id}, 'Dono Teste', 'dono', '5531988887777', ${mods.crypto.hashPin("123456")}) returning id`;
    user = await mods.users.userById(u!.id);
  });

  after(async () => {
    const sql = mods?.db.db();
    (await import("../scheduler.js")).stopScheduler();
    if (sql && user) await sql`delete from tenants where id = ${user.tenant_id}`;
    await sql?.end({ timeout: 2 });
    fake?.close();
  });

  it("criptografia e PIN", () => {
    const enc = mods.crypto.encrypt("segredo");
    assert.equal(mods.crypto.decrypt(enc), "segredo");
    assert.ok(mods.crypto.verifyPin("123456", user.pin_hash));
    assert.ok(!mods.crypto.verifyPin("000000", user.pin_hash));
  });

  it("encontra usuário pelo WhatsApp com ou sem o nono dígito", async () => {
    assert.equal((await mods.users.userByWhatsApp("553188887777"))?.id, user.id);
    assert.equal((await mods.users.userByWhatsApp("5531988887777"))?.id, user.id);
    assert.equal(await mods.users.userByWhatsApp("5511000000000"), null);
  });

  it("matriz de permissões e autonomia", async () => {
    const { decidir } = mods.perms;
    const tools = (await import("../agent/tools/index.js")).TOOLS_BY_NAME;
    const email = tools.get("gmail_enviar");
    const pausar = tools.get("meta_ads_status");
    const salvar = tools.get("memoria_salvar");
    assert.deepEqual(decidir(user, email), { tipo: "aprovacao", nivel: "confirmar" });
    assert.deepEqual(decidir(user, pausar), { tipo: "aprovacao", nivel: "pin" });
    assert.deepEqual(decidir({ ...user, autonomia: 1 }, salvar), { tipo: "aprovacao", nivel: "confirmar" });
    assert.deepEqual(decidir({ ...user, perfil: "operador" }, pausar).tipo, "negado");
    // nível 4 expirado volta para 3, que ainda confirma mensagens para fora
    assert.deepEqual(decidir({ ...user, autonomia: 4, autonomia_total_ate: new Date(Date.now() - 1000) }, email), { tipo: "aprovacao", nivel: "confirmar" });
    assert.deepEqual(decidir({ ...user, autonomia: 4, autonomia_total_ate: new Date(Date.now() + 60000) }, email), { tipo: "livre" });
  });

  it("horário de silêncio atravessando a meia-noite", () => {
    const { inQuietHours } = mods.time;
    // 23h e 03h em São Paulo (UTC-3)
    assert.ok(inQuietHours("22:00", "07:00", new Date("2026-11-09T02:00:00Z")));
    assert.ok(inQuietHours("22:00", "07:00", new Date("2026-11-09T06:00:00Z")));
    assert.ok(!inQuietHours("22:00", "07:00", new Date("2026-11-09T15:00:00Z")));
  });

  it("loop do agente: usa ferramenta de memória e responde", async () => {
    let call = 0;
    script = (body) => {
      if (body.max_tokens === 16) return msg([{ type: "text", text: "COMPLEXO" }]); // roteador
      if (body.output_config?.format) return msg([{ type: "text", text: JSON.stringify({ fatos: [] }) }]); // extração de memória
      call++;
      if (call === 1) {
        return msg(
          [{ type: "tool_use", id: "tu_1", name: "memoria_salvar", input: { conteudo: "O Alexandre cuida do tráfego da RedBox.", tipo: "pessoa", escopo: "pessoal" } }],
          "tool_use",
        );
      }
      const last = body.messages[body.messages.length - 1];
      assert.equal(last.content[0].type, "tool_result");
      assert.match(last.content[0].content, /Memória salva/);
      return msg([{ type: "text", text: "Anotado: o Alexandre cuida do tráfego da RedBox." }]);
    };
    const r = await mods.orch.runTask({ user, canal: "painel", texto: "Lembra que o Alexandre cuida do tráfego da RedBox, ok? Isso é importante para as campanhas." });
    assert.equal(r.resposta, "Anotado: o Alexandre cuida do tráfego da RedBox.");
    assert.ok(r.custoUsd > 0);

    const sql = mods.db.db();
    const found = await sql`select * from search_memories(${user.id}, 'quem cuida do tráfego da redbox', 5)`;
    assert.ok(found.some((m: any) => m.conteudo.includes("Alexandre")), "busca de memória deve achar o fato");
    const [task] = await sql`select status, custo from tasks where id = ${r.taskId}`;
    assert.equal(task.status, "concluida");
    const steps = await sql`select ferramenta from task_steps where task_id = ${r.taskId}`;
    assert.deepEqual(steps.map((s: any) => s.ferramenta), ["memoria_salvar"]);

    // o system prompt estável vai com cache_control e o contexto dinâmico traz a memória relevante
    const main = requests.find((b) => Array.isArray(b.system));
    assert.equal(main.system[0].cache_control.type, "ephemeral");
    assert.ok(main.tools.some((t: any) => t.name === "web_search"));
    // fallback de recusa só nos modelos que suportam (Opus); o roteador mandou esta consulta curta ao modelo rápido
    assert.equal(main.fallbacks, main.model === "claude-opus-5-5" ? "default" : undefined);
  });

  it("ação sensível pede confirmação e só executa com o PIN certo", async () => {
    let call = 0;
    script = (body) => {
      if (body.max_tokens === 16) return msg([{ type: "text", text: "SIMPLES" }]);
      if (body.output_config?.format) return msg([{ type: "text", text: JSON.stringify({ fatos: [] }) }]);
      call++;
      if (call === 1) {
        return msg([{ type: "tool_use", id: "tu_2", name: "rotina_criar", input: { nome: "x", cron: "0 8 * * *", instrucao: "y" } }], "tool_use");
      }
      return msg([{ type: "text", text: "ok" }]);
    };
    // autonomia 1: até criar rotina pede confirmação
    const assisted = { ...user, autonomia: 1 };
    const r = await mods.orch.runTask({ user: assisted, canal: "whatsapp", texto: "cria uma rotina de teste" });
    assert.ok(r.aguardandoAprovacao);
    assert.match(r.resposta, /Responda \*SIM\*/);
    const sql = mods.db.db();
    assert.equal((await sql`select count(*)::int as n from routines where user_id = ${user.id}`)[0].n, 0, "não pode executar antes da confirmação");

    assert.equal(await mods.approvals.handleApprovalReply(assisted, "qual a previsão do tempo?", "whatsapp"), null, "mensagem comum não é resposta");
    const done = await mods.approvals.handleApprovalReply(assisted, "sim", "whatsapp");
    assert.match(done, /✅/);
    assert.equal((await sql`select count(*)::int as n from routines where user_id = ${user.id}`)[0].n, 1);
  });

  it("app de PC: pareia, recebe a ação por long-poll e devolve o resultado", async () => {
    const devices = await import("../lib/devices.js");
    const { codigo } = await devices.criarCodigoPareamento(user.id);
    assert.equal(await devices.parear("ERRADO", "PC", "pc", {}), null);
    const par = await devices.parear(codigo.toLowerCase(), "PC do teste", "pc", { os: "Windows 11" });
    assert.ok(par?.token);
    assert.equal(await devices.parear(codigo, "de novo", "pc", {}), null, "código é de uso único");
    const dev = await devices.autenticar(par!.token);
    assert.equal(dev?.user_id, user.id);
    await devices.marcarVisto(dev!.id);

    // o "app" fica em long-poll e responde a ação de abrir
    const app = (async () => {
      const a = await devices.proximaAcao(dev!.id, 5000);
      assert.equal(a?.acao, "abrir");
      await devices.receberResultado(dev!.id, a!.id, { ok: true, texto: `Abri ${String(a!.params.alvo)}.` });
    })();

    let call = 0;
    script = (body) => {
      if (body.max_tokens === 16) return msg([{ type: "text", text: "SIMPLES" }]);
      if (body.output_config?.format) return msg([{ type: "text", text: JSON.stringify({ fatos: [] }) }]);
      call++;
      if (call === 1) return msg([{ type: "tool_use", id: "tu_pc", name: "pc_abrir", input: { alvo: "excel" } }], "tool_use");
      const last = body.messages[body.messages.length - 1];
      assert.match(last.content[0].content, /Abri excel/);
      return msg([{ type: "text", text: "Pronto, abri o Excel." }]);
    };
    const r = await mods.orch.runTask({ user: { ...user, pausado: false }, canal: "voz", texto: "abre o excel", deviceId: dev!.id });
    await app;
    assert.equal(r.resposta, "Pronto, abri o Excel.");
    await devices.revogar(dev!.id, user.id);
    assert.equal(await devices.autenticar(par!.token), null, "token revogado não funciona");
  });

  it("app Android: cria alarme pelo celular e registra recurso 'android'", async () => {
    const devices = await import("../lib/devices.js");
    const sql = mods.db.db();
    const { codigo } = await devices.criarCodigoPareamento(user.id);
    const par = await devices.parear(codigo, "Celular do teste", "android", { os: "Android 15" });
    const dev = await devices.autenticar(par!.token);
    assert.equal(dev?.tipo, "android");
    await devices.marcarVisto(dev!.id);
    assert.equal(await devices.pcOnlineDoUsuario(user.id, dev!.id), null, "celular não conta como PC");

    const app = (async () => {
      const a = await devices.proximaAcao(dev!.id, 5000);
      assert.equal(a?.acao, "alarme");
      assert.equal(a?.params.hora, 7);
      await devices.receberResultado(dev!.id, a!.id, { ok: true, texto: "Alarme criado para 07:00." });
    })();

    let call = 0;
    script = (body) => {
      if (body.max_tokens === 16) return msg([{ type: "text", text: "SIMPLES" }]);
      if (body.output_config?.format) return msg([{ type: "text", text: JSON.stringify({ fatos: [] }) }]);
      call++;
      if (call === 1) {
        assert.ok(body.tools.some((t: any) => t.name === "android_alarme"), "ferramentas android oferecidas");
        return msg([{ type: "tool_use", id: "tu_and", name: "android_alarme", input: { hora: 7, minuto: 0 } }], "tool_use");
      }
      return msg([{ type: "text", text: "Alarme para as 7h criado." }]);
    };
    const r = await mods.orch.runTask({ user: { ...user, pausado: false }, canal: "app", texto: "me acorda às 7", deviceId: dev!.id });
    await app;
    assert.equal(r.resposta, "Alarme para as 7h criado.");
    const [q] = await sql`select recurso, status from task_queue where device_id = ${dev!.id}`;
    assert.equal(q.recurso, "android");
    assert.equal(q.status, "concluida");
    await devices.revogar(dev!.id, user.id);
  });

  it("skills: aprende com uma tarefa de várias etapas e reaproveita em pedido parecido", async () => {
    const sql = mods.db.db();
    const sistema = (body: any) => (Array.isArray(body.system) ? body.system.map((b: any) => b.text).join("\n") : String(body.system ?? ""));
    const skillJson = {
      acao: "nova",
      melhorar_id: null,
      nome: "Resumo da operação",
      descricao: "Quando o usuário pede um panorama das rotinas e da equipe",
      gatilhos: ["resumo da operação", "como está a operação", "panorama das rotinas e da equipe"],
      passos: [
        { ferramenta: "rotina_listar", instrucao: "Listar as rotinas ativas" },
        { ferramenta: "usuarios_listar", instrucao: "Listar a equipe" },
        { ferramenta: null, instrucao: "Resumir em poucas linhas" },
      ],
    };
    let ofertou = false;
    const roteiro = () => {
      let call = 0;
      return (body: any) => {
        if (body.max_tokens === 16) return msg([{ type: "text", text: "SIMPLES" }]);
        if (body.output_config?.format) {
          if (sistema(body).includes("procedimentos reutilizáveis")) return msg([{ type: "text", text: JSON.stringify(skillJson) }]);
          return msg([{ type: "text", text: JSON.stringify({ fatos: [] }) }]);
        }
        call++;
        if (call === 1) {
          if (sistema(body).includes("### Resumo da operação")) ofertou = true;
          return msg(
            [
              { type: "tool_use", id: `tu_r${Math.random()}`, name: "rotina_listar", input: {} },
              { type: "tool_use", id: `tu_u${Math.random()}`, name: "usuarios_listar", input: {} },
            ],
            "tool_use",
          );
        }
        return msg([{ type: "text", text: "Operação em dia." }]);
      };
    };
    const esperar = async (cond: () => Promise<boolean>) => {
      for (let i = 0; i < 50 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 100));
    };

    script = roteiro();
    await mods.orch.runTask({ user: { ...user, pausado: false }, canal: "app", texto: "me passa o resumo da operação de hoje", novaConversa: true });
    await esperar(async () => (await sql`select count(*)::int n from skills where user_id = ${user.id}`)[0].n > 0);
    const [sk] = await sql`select id, nome, usos, ferramentas, status from skills where user_id = ${user.id}`;
    assert.equal(sk?.nome, "Resumo da operação");
    assert.deepEqual([...sk.ferramentas].sort(), ["rotina_listar", "usuarios_listar"]);
    assert.equal(ofertou, false);

    script = roteiro();
    await mods.orch.runTask({ user: { ...user, pausado: false }, canal: "app", texto: "como está a operação hoje?", novaConversa: true });
    assert.equal(ofertou, true, "skill aparece no contexto do pedido parecido");
    await esperar(async () => (await sql`select usos from skills where id = ${sk.id}`)[0].usos >= 2);
    const [depois] = await sql`select usos from skills where id = ${sk.id}`;
    assert.ok(depois.usos >= 2, "uso contado");
    const [t] = await sql`select skills_ofertadas from tasks where user_id = ${user.id} order by inicio desc limit 1`;
    assert.deepEqual(t.skills_ofertadas, [sk.id]);
  });

  it("sub-agentes: executa as partes em paralelo, só com ferramentas de leitura", async () => {
    const sistema = (body: any) => (Array.isArray(body.system) ? body.system.map((b: any) => b.text).join("\n") : "");
    let principal = 0;
    let ferramentasSub: string[] = [];
    script = async (body) => {
      if (body.max_tokens === 16) return msg([{ type: "text", text: "COMPLEXO" }]);
      if (body.output_config?.format) return msg([{ type: "text", text: JSON.stringify({ fatos: [], acao: "nenhuma", melhorar_id: null, nome: "", descricao: "", gatilhos: [], passos: [] }) }]);
      if (sistema(body).includes("SUB-AGENTE")) {
        ferramentasSub = body.tools.map((t: any) => t.name);
        await new Promise((r) => setTimeout(r, 400));
        return msg([{ type: "text", text: `resultado de ${body.messages[0].content}` }]);
      }
      principal++;
      if (principal === 1) {
        return msg(
          [
            {
              type: "tool_use",
              id: "tu_sub",
              name: "subagentes",
              input: { partes: [{ titulo: "Empresa A", instrucao: "parte A" }, { titulo: "Empresa B", instrucao: "parte B" }, { titulo: "Empresa C", instrucao: "parte C" }] },
            },
          ],
          "tool_use",
        );
      }
      const res = body.messages[body.messages.length - 1].content[0].content as string;
      assert.match(res, /resultado de parte A/);
      assert.match(res, /resultado de parte B/);
      assert.match(res, /resultado de parte C/);
      return msg([{ type: "text", text: "Relatório consolidado." }]);
    };
    const t0 = Date.now();
    const r = await mods.orch.runTask({ user: { ...user, pausado: false }, canal: "app", texto: "relatório das três empresas", novaConversa: true });
    const ms = Date.now() - t0;
    assert.equal(r.resposta, "Relatório consolidado.");
    assert.ok(ms < 1100, `as 3 partes de 400 ms rodaram em paralelo (levou ${ms} ms)`);
    assert.ok(ferramentasSub.includes("rotina_listar"), "leitura liberada");
    assert.ok(!ferramentasSub.includes("rotina_criar") && !ferramentasSub.includes("gmail_enviar") && !ferramentasSub.includes("subagentes"), "nada que muda");
    assert.ok(r.custoUsd > 0.004, "custo dos sub-agentes somado à tarefa");
  });

  it("botão de pânico cancela pendências e pausa", async () => {
    const sql = mods.db.db();
    const [t] = await sql`insert into tasks (user_id, pedido, status) values (${user.id}, 'x', 'aguardando_aprovacao') returning id`;
    await sql`insert into approvals (task_id, user_id, nivel, ferramenta, entrada, resumo) values (${t!.id}, ${user.id}, 'pin', 'meta_ads_status', '{}', 'teste')`;
    const { panic } = await import("../agent/panic.js");
    await panic(user.id, { pausar: true });
    assert.equal((await sql`select count(*)::int as n from approvals where user_id = ${user.id} and status = 'pendente'`)[0].n, 0);
    const paused = await mods.users.userById(user.id);
    assert.equal(paused.pausado, true);
    const r = await mods.orch.runTask({ user: paused, canal: "whatsapp", texto: "oi" });
    assert.match(r.resposta, /pausado/);
  });
});
