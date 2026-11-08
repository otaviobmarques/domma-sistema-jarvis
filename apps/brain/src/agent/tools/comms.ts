import { z } from "zod";
import { audit, db } from "../../lib/db.js";
import { sendWhatsApp, whatsappStatus } from "../../channels/whatsapp.js";
import { defineTool } from "../types.js";

export const whatsappEnviar = defineTool({
  name: "whatsapp_enviar",
  description:
    "Envia uma mensagem de WhatsApp, pelo número do Jarvis, para um terceiro (cliente, loja, funcionário). Sempre pede confirmação. Número com DDI e DDD, só dígitos (ex.: 5531999998888).",
  grupo: "comunicacao",
  nivel: "confirmar",
  perfis: ["dono", "gestor", "operador"],
  muda: true,
  disponivel: async () => (whatsappStatus().conectado ? true : "WhatsApp do Jarvis desconectado"),
  schema: z.object({
    numero: z.string().regex(/^\d{10,15}$/),
    nome_destinatario: z.string(),
    mensagem: z.string().max(4000),
  }),
  resumo: (i) => `Enviar WhatsApp para ${i.nome_destinatario} (${i.numero}):\n"${i.mensagem}"`,
  async run(i, ctx) {
    await sendWhatsApp(i.numero, i.mensagem);
    await audit(ctx.user.id, "whatsapp.enviar_terceiro", i.numero, null, { mensagem: i.mensagem });
    return `Mensagem enviada para ${i.nome_destinatario}.`;
  },
});

export const contatosBuscar = defineTool({
  name: "usuarios_listar",
  description: "Lista os usuários cadastrados no Jarvis (nome, perfil, WhatsApp). Útil para achar o número de alguém da equipe.",
  grupo: "usuarios",
  nivel: "livre",
  perfis: ["dono", "gestor"],
  muda: false,
  schema: z.object({}),
  async run(_i, ctx) {
    const sql = db();
    const rows = await sql<{ nome: string; perfil: string; whatsapp: string | null; ativo: boolean }[]>`
      select nome, perfil, whatsapp, ativo from users where tenant_id = ${ctx.user.tenant_id} order by nome`;
    return rows.map((r) => `- ${r.nome} | ${r.perfil} | ${r.whatsapp ?? "-"}${r.ativo ? "" : " (inativo)"}`).join("\n");
  },
});
