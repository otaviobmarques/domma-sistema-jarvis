import { z } from "zod";
import { dispositivoOnline, executarNoDispositivo } from "../../lib/devices.js";
import { defineTool, type ToolContext, type ToolOutput, type User } from "../types.js";

/**
 * Mãos no celular (Fase 3). Cada ferramenta vira uma ação executada pelo app Android do Tavinho
 * (serviço de acessibilidade + intents do sistema).
 */
const quem = ["dono", "gestor", "operador"] as const;

const disp = async (u: User): Promise<true | string> =>
  (await dispositivoOnline(u.id, "android")) ? true : "Nenhum celular Android com o app está online";

async function noCelular(ctx: ToolContext, acao: string, params: Record<string, unknown>, timeoutMs?: number): Promise<string | ToolOutput> {
  const cel = await dispositivoOnline(ctx.user.id, "android", ctx.deviceId);
  if (!cel) return "Nenhum celular Android com o app está online agora.";
  const r = await executarNoDispositivo(cel.id, ctx.taskId, acao, params, { timeoutMs, signal: ctx.signal, recurso: "android" });
  if (!r.ok) throw new Error(r.texto || "falhou no celular");
  return r.imagem ? { texto: r.texto, imagem: r.imagem } : r.texto;
}

export const androidTela = defineTool({
  name: "android_tela",
  description:
    "Lê a tela atual do celular Android como uma lista numerada de elementos (textos, botões, campos). Use antes de android_tocar/android_digitar; prefira tocar pelo índice.",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: false,
  disponivel: disp,
  schema: z.object({}),
  run: (i, ctx) => noCelular(ctx, "tela", i),
});

export const androidPrint = defineTool({
  name: "android_print",
  description: "Tira um print da tela do celular e mostra para você (Android 11+). Use quando a lista de android_tela não bastar.",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: false,
  disponivel: disp,
  schema: z.object({}),
  run: (i, ctx) => noCelular(ctx, "print", i, 30_000),
});

export const androidTocar = defineTool({
  name: "android_tocar",
  description: "Toca num elemento da tela do celular: pelo índice de android_tela (melhor), pelo texto visível ou por coordenadas x/y. longo=true para toque longo.",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({
    indice: z.number().int().min(0).optional(),
    texto: z.string().max(200).optional(),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    longo: z.boolean().default(false),
  }),
  run: (i, ctx) => noCelular(ctx, "tocar", i),
});

export const androidDigitar = defineTool({
  name: "android_digitar",
  description: "Digita um texto num campo do celular (o campo em foco, ou o do índice de android_tela).",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ texto: z.string().max(5000), indice: z.number().int().min(0).optional() }),
  run: (i, ctx) => noCelular(ctx, "digitar", i),
});

export const androidRolar = defineTool({
  name: "android_rolar",
  description: "Rola a tela do celular.",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: false,
  disponivel: disp,
  schema: z.object({ direcao: z.enum(["baixo", "cima"]).default("baixo") }),
  run: (i, ctx) => noCelular(ctx, "rolar", i),
});

export const androidNavegar = defineTool({
  name: "android_navegar",
  description: "Botões do sistema no celular: voltar, início, recentes, abrir notificações ou configurações rápidas.",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ acao: z.enum(["voltar", "inicio", "recentes", "notificacoes", "configuracoes_rapidas"]) }),
  run: (i, ctx) => noCelular(ctx, "navegar", i),
});

export const androidAbrir = defineTool({
  name: "android_abrir",
  description: "Abre no celular um app pelo nome (ex.: 'whatsapp', 'instagram', 'maps'), um site (URL) ou um link (tel:, mailto:, geo:).",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ alvo: z.string().max(500) }),
  run: (i, ctx) => noCelular(ctx, "abrir", i),
});

export const androidNotificacoes = defineTool({
  name: "android_notificacoes",
  description: "Lê as notificações recentes do celular (app, título e texto).",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: false,
  disponivel: disp,
  schema: z.object({ limite: z.number().int().min(1).max(100).default(30) }),
  run: (i, ctx) => noCelular(ctx, "notificacoes", i),
});

export const androidAlarme = defineTool({
  name: "android_alarme",
  description: "Cria um alarme no relógio do celular.",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ hora: z.number().int().min(0).max(23), minuto: z.number().int().min(0).max(59).default(0), rotulo: z.string().max(80).default("") }),
  run: (i, ctx) => noCelular(ctx, "alarme", i),
});

export const androidTimer = defineTool({
  name: "android_timer",
  description: "Inicia um timer (contagem regressiva) no celular.",
  grupo: "android",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ segundos: z.number().int().min(1).max(86_400), rotulo: z.string().max(80).default("") }),
  run: (i, ctx) => noCelular(ctx, "timer", i),
});

export const androidLigar = defineTool({
  name: "android_ligar",
  description: "Faz uma ligação telefônica pelo celular. Pede confirmação. Procure o número antes (contatos_buscar/memória).",
  grupo: "android",
  nivel: "confirmar",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ numero: z.string().min(3).max(30), para: z.string().max(80).optional().describe("Nome de quem vai receber a ligação") }),
  resumo: (i) => `Ligar pelo celular para ${i.para ? `${i.para} (${i.numero})` : i.numero}`,
  run: (i, ctx) => noCelular(ctx, "ligar", { numero: i.numero }),
});
