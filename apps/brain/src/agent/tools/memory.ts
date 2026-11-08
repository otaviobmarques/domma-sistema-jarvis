import { z } from "zod";
import { audit, db, json } from "../../lib/db.js";
import { defineTool } from "../types.js";

const todos = ["dono", "gestor", "operador", "loja"] as const;

export const memoriaBuscar = defineTool({
  name: "memoria_buscar",
  description:
    "Busca na memória de longo prazo fatos sobre pessoas, empresas, projetos, preferências e o histórico. Use antes de perguntar algo que o usuário já pode ter dito.",
  grupo: "memoria",
  nivel: "livre",
  perfis: [...todos],
  muda: false,
  schema: z.object({ consulta: z.string().describe("O que procurar, em linguagem natural"), limite: z.number().int().min(1).max(20).optional() }),
  async run({ consulta, limite }, ctx) {
    const sql = db();
    const rows = await sql<{ id: string; conteudo: string; tipo: string; escopo: string; confianca: number; criado_em: Date }[]>`
      select * from search_memories(${ctx.user.id}, ${consulta}, ${limite ?? 8})`;
    if (!rows.length) return "Nada encontrado na memória.";
    return rows
      .map((r) => `- [${r.id.slice(0, 8)}] (${r.tipo}, ${r.escopo}, confiança ${r.confianca.toFixed(1)}, ${r.criado_em.toISOString().slice(0, 10)}) ${r.conteudo}`)
      .join("\n");
  },
});

export const memoriaSalvar = defineTool({
  name: "memoria_salvar",
  description:
    "Guarda um fato novo ou corrigido na memória. Use quando o usuário pedir para lembrar algo, ou quando surgir um fato estável e útil. Dados sensíveis (saúde, finanças pessoais, documentos) só com pedido explícito.",
  grupo: "memoria",
  nivel: "livre",
  perfis: ["dono", "gestor"],
  muda: true,
  schema: z.object({
    conteudo: z.string().describe("O fato, em uma frase autoexplicativa"),
    tipo: z.enum(["perfil", "pessoa", "empresa", "projeto", "preferencia", "fato"]),
    escopo: z.enum(["pessoal", "empresa", "equipe"]).default("pessoal").describe("Na dúvida, pessoal"),
    empresa: z.string().optional().describe("Nome da empresa, se o escopo for empresa"),
    substitui_id: z.string().optional().describe("Prefixo do id de uma memória que este fato corrige"),
    sensivel: z.boolean().default(false),
  }),
  async run(input, ctx) {
    const sql = db();
    let companyId: string | null = null;
    if (input.empresa) {
      const [c] = await sql<{ id: string }[]>`select id from companies where tenant_id = ${ctx.user.tenant_id} and nome ilike ${input.empresa} limit 1`;
      companyId = c?.id ?? null;
    }
    const [row] = await sql<{ id: string }[]>`
      insert into memories (user_id, tenant_id, escopo, company_id, tipo, conteudo, origem, sensivel)
      values (${ctx.user.id}, ${ctx.user.tenant_id}, ${input.escopo}, ${companyId}, ${input.tipo}, ${input.conteudo},
              ${json({ canal: ctx.canal, quem: ctx.user.nome, quando: new Date().toISOString(), task_id: ctx.taskId })}, ${input.sensivel})
      returning id`;
    if (input.substitui_id) {
      await sql`update memories set substituida_por = ${row!.id}, atualizado_em = now()
                where user_id = ${ctx.user.id} and id::text like ${input.substitui_id + "%"} and id <> ${row!.id}`;
    }
    return `Memória salva [${row!.id.slice(0, 8)}].`;
  },
});

export const memoriaEsquecer = defineTool({
  name: "memoria_esquecer",
  description: "Apaga memórias quando o usuário pedir ('esquece isso'). Busque antes para obter os ids.",
  grupo: "memoria",
  nivel: "livre",
  perfis: ["dono", "gestor"],
  muda: true,
  schema: z.object({ ids: z.array(z.string()).min(1).describe("Prefixos dos ids retornados por memoria_buscar") }),
  async run({ ids }, ctx) {
    const sql = db();
    let total = 0;
    for (const id of ids) {
      const del = await sql<{ id: string; conteudo: string }[]>`
        delete from memories where user_id = ${ctx.user.id} and id::text like ${id + "%"} returning id, conteudo`;
      total += del.length;
      for (const d of del) await audit(ctx.user.id, "memoria.apagar", d.id, d, null);
    }
    return `${total} memória(s) apagada(s).`;
  },
});
