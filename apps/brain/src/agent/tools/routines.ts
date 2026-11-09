import cron from "node-cron";
import { z } from "zod";
import { audit, db } from "../../lib/db.js";
import { reloadRoutines } from "../../scheduler.js";
import { defineTool } from "../types.js";

export const rotinaCriar = defineTool({
  name: "rotina_criar",
  description:
    "Cria uma rotina agendada (piloto automático). O Tavinho executa a instrução no horário e manda o resultado no WhatsApp. Cron de 5 campos no fuso America/Sao_Paulo (ex.: '0 8 * * *' = todo dia 8h; '0 17 * * 5' = sexta 17h).",
  grupo: "rotinas",
  nivel: "livre",
  perfis: ["dono", "gestor"],
  muda: true,
  schema: z.object({
    nome: z.string(),
    cron: z.string(),
    instrucao: z.string().describe("O que fazer, como se fosse um pedido do usuário"),
    critica: z.boolean().default(false).describe("Se true, avisa mesmo no horário de silêncio"),
  }),
  async run(i, ctx) {
    if (!cron.validate(i.cron)) return `Expressão cron inválida: ${i.cron}`;
    const sql = db();
    const [r] = await sql<{ id: string }[]>`
      insert into routines (user_id, nome, cron, instrucao, critica)
      values (${ctx.user.id}, ${i.nome}, ${i.cron}, ${i.instrucao}, ${i.critica}) returning id`;
    await audit(ctx.user.id, "rotina.criar", r!.id, null, i);
    await reloadRoutines();
    return `Rotina "${i.nome}" criada (${i.cron}).`;
  },
});

export const rotinaListar = defineTool({
  name: "rotina_listar",
  description: "Lista as rotinas do usuário.",
  grupo: "rotinas",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador", "loja"],
  muda: false,
  schema: z.object({}),
  async run(_i, ctx) {
    const sql = db();
    const rows = await sql<{ id: string; nome: string; cron: string; ativa: boolean; instrucao: string; ultima_execucao: Date | null }[]>`
      select id, nome, cron, ativa, instrucao, ultima_execucao from routines where user_id = ${ctx.user.id} order by criado_em`;
    if (!rows.length) return "Nenhuma rotina.";
    return rows.map((r) => `- [${r.id.slice(0, 8)}] ${r.ativa ? "✅" : "⏸️"} ${r.nome} | ${r.cron} | ${r.instrucao}${r.ultima_execucao ? ` | última: ${r.ultima_execucao.toISOString()}` : ""}`).join("\n");
  },
});

export const rotinaAlterar = defineTool({
  name: "rotina_alterar",
  description: "Ativa, pausa ou apaga uma rotina pelo prefixo do id.",
  grupo: "rotinas",
  nivel: "livre",
  perfis: ["dono", "gestor"],
  muda: true,
  schema: z.object({ id: z.string(), acao: z.enum(["ativar", "pausar", "apagar"]) }),
  async run({ id, acao }, ctx) {
    const sql = db();
    const like = id + "%";
    const res =
      acao === "apagar"
        ? await sql`delete from routines where user_id = ${ctx.user.id} and id::text like ${like} returning id`
        : await sql`update routines set ativa = ${acao === "ativar"} where user_id = ${ctx.user.id} and id::text like ${like} returning id`;
    await audit(ctx.user.id, `rotina.${acao}`, id);
    await reloadRoutines();
    return res.length ? `Rotina ${acao === "apagar" ? "apagada" : acao === "ativar" ? "ativada" : "pausada"}.` : "Rotina não encontrada.";
  },
});
