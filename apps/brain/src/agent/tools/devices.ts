import { z } from "zod";
import { db, json } from "../../lib/db.js";
import { defineTool } from "../types.js";

/**
 * Ponte para as "mãos" (Fase 2: app PC, Fase 3: app Android).
 * O cérebro enfileira a tarefa em task_queue; o app pareado busca/recebe e devolve o resultado.
 */
export const dispositivoExecutar = defineTool({
  name: "dispositivo_executar",
  description:
    "Envia uma tarefa para o PC ou o Android pareado do usuário (abrir app, mexer em arquivos, usar um site sem API, controlar a tela). Use só quando não existir integração direta.",
  grupo: "dispositivos",
  nivel: "confirmar",
  perfis: ["dono", "gestor", "operador"],
  muda: true,
  schema: z.object({
    tipo: z.enum(["pc", "android"]),
    instrucao: z.string(),
    prioridade: z.enum(["urgente", "normal", "quando_der"]).default("normal"),
  }),
  resumo: (i) => `Executar no ${i.tipo === "pc" ? "PC" : "Android"}: ${i.instrucao}`,
  async run(i, ctx) {
    const sql = db();
    const [dev] = await sql<{ id: string; nome: string; status: string }[]>`
      select id, nome, status from devices where user_id = ${ctx.user.id} and tipo = ${i.tipo} order by ultimo_contato desc nulls last limit 1`;
    if (!dev) return `Nenhum ${i.tipo === "pc" ? "PC" : "Android"} pareado ainda. O app ${i.tipo === "pc" ? "de PC (Fase 2)" : "Android (Fase 3)"} ainda não foi instalado.`;
    const [q] = await sql<{ id: string }[]>`
      insert into task_queue (task_id, device_id, recurso, prioridade, payload)
      values (${ctx.taskId}, ${dev.id}, ${i.tipo === "pc" ? "pc" : "android"}, ${i.prioridade}, ${json({ instrucao: i.instrucao })})
      returning id`;
    return `Tarefa enfileirada para ${dev.nome} (${dev.status}). id ${q!.id.slice(0, 8)}. O resultado chega quando o dispositivo concluir.`;
  },
});
