import { z } from "zod";
import { db, json } from "../../lib/db.js";
import { defineTool } from "../types.js";

/**
 * Ponte para o celular Android (Fase 3). O PC usa as ferramentas pc_* (Fase 2).
 * O cérebro enfileira a tarefa em task_queue; o app pareado busca e devolve o resultado.
 */
export const dispositivoExecutar = defineTool({
  name: "dispositivo_executar",
  description: "Envia uma tarefa para o celular Android pareado do usuário (Fase 3). Para o PC, use as ferramentas pc_*.",
  grupo: "dispositivos",
  nivel: "confirmar",
  perfis: ["dono", "gestor", "operador"],
  muda: true,
  schema: z.object({
    instrucao: z.string(),
    prioridade: z.enum(["urgente", "normal", "quando_der"]).default("normal"),
  }),
  resumo: (i) => `Executar no Android: ${i.instrucao}`,
  async run(i, ctx) {
    const sql = db();
    const [dev] = await sql<{ id: string; nome: string; status: string }[]>`
      select id, nome, status from devices where user_id = ${ctx.user.id} and tipo = 'android' and ativo order by ultimo_contato desc nulls last limit 1`;
    if (!dev) return "Nenhum Android pareado ainda. O app Android chega na Fase 3.";
    const [q] = await sql<{ id: string }[]>`
      insert into task_queue (task_id, device_id, recurso, prioridade, payload)
      values (${ctx.taskId}, ${dev.id}, 'android', ${i.prioridade}, ${json({ instrucao: i.instrucao })})
      returning id`;
    return `Tarefa enfileirada para ${dev.nome} (${dev.status}). id ${q!.id.slice(0, 8)}.`;
  },
});
