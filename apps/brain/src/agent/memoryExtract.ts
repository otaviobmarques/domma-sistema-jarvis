import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../lib/config.js";
import { db, json } from "../lib/db.js";
import { anthropic, costUsd } from "./llm.js";
import type { Canal, User } from "./types.js";

const Extracao = z.object({
  fatos: z.array(
    z.object({
      conteudo: z.string().describe("Fato autoexplicativo em uma frase, em terceira pessoa"),
      tipo: z.enum(["perfil", "pessoa", "empresa", "projeto", "preferencia", "fato"]),
      escopo: z.enum(["pessoal", "empresa", "equipe"]),
      empresa: z.string().nullable(),
      confianca: z.number().describe("0 a 1"),
      sensivel: z.boolean(),
    }),
  ),
});

/**
 * Ciclo de vida da memória (seção 11.2): depois de cada troca, extrai fatos novos ou corrigidos.
 * Conflitos: o mais recente vence e o antigo vira histórico (substituida_por).
 */
export async function extractMemories(user: User, canal: Canal, taskId: string, pedido: string, resposta: string) {
  if (pedido.length < 15) return;
  const sql = db();
  const existentes = await sql<{ id: string; conteudo: string }[]>`select id, conteudo from search_memories(${user.id}, ${pedido.slice(0, 500)}, 10)`;

  const res = await anthropic.messages.parse({
    model: config.modelFast,
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(Extracao) },
    system:
      "Você extrai fatos duráveis e úteis de uma conversa entre um usuário e seu assistente executivo: pessoas e papéis, empresas, projetos, decisões, preferências de formato/tom/horário. Ignore conversa fiada, pedidos pontuais e dados transitórios (números do dia, status momentâneo). Não repita fatos já conhecidos, a menos que tenham mudado. Marque sensivel=true para saúde, finanças pessoais ou documentos pessoais. Na dúvida sobre escopo, use pessoal. Se não houver nada, devolva lista vazia.",
    messages: [
      {
        role: "user",
        content: `Usuário: ${user.nome} (${user.perfil})\n\nFatos já conhecidos:\n${existentes.map((e) => `- ${e.conteudo}`).join("\n") || "(nenhum)"}\n\n<conversa>\nUSUÁRIO: ${pedido}\nASSISTENTE: ${resposta}\n</conversa>`,
      },
    ],
  });
  const custo = costUsd(config.modelFast, res.usage as any);
  await sql`update tasks set custo = custo + ${custo} where id = ${taskId}`;

  const fatos = res.parsed_output?.fatos ?? [];
  for (const f of fatos) {
    // Dados sensíveis só com autorização explícita (o usuário pede com memoria_salvar).
    if (f.sensivel || f.confianca < 0.5) continue;
    const [dup] = await sql<{ id: string; sim: number }[]>`
      select id, similarity(conteudo, ${f.conteudo}) as sim from memories
      where user_id = ${user.id} and substituida_por is null order by sim desc limit 1`;
    if (dup && dup.sim > 0.75) continue;
    let companyId: string | null = null;
    if (f.empresa) {
      const [c] = await sql<{ id: string }[]>`select id from companies where tenant_id = ${user.tenant_id} and nome ilike ${f.empresa} limit 1`;
      companyId = c?.id ?? null;
    }
    const [novo] = await sql<{ id: string }[]>`
      insert into memories (user_id, tenant_id, escopo, company_id, tipo, conteudo, confianca, origem)
      values (${user.id}, ${user.tenant_id}, ${f.escopo === "pessoal" || companyId ? f.escopo : "pessoal"}, ${companyId}, ${f.tipo}, ${f.conteudo},
              ${Math.min(1, Math.max(0, f.confianca))}, ${json({ canal, quem: user.nome, quando: new Date().toISOString(), task_id: taskId, auto: true })})
      returning id`;
    // fato parecido porém diferente (0.45–0.75) → provável correção: o antigo vira histórico
    if (dup && dup.sim > 0.45) await sql`update memories set substituida_por = ${novo!.id} where id = ${dup.id}`;
  }
}
