import { z } from "zod";
import { executarNoDispositivo, pcOnlineDoUsuario } from "../../lib/devices.js";
import { defineTool, type ToolContext, type ToolOutput, type User } from "../types.js";

/**
 * Mãos no PC (Fase 2). Cada ferramenta vira uma ação executada pelo app do Jarvis no Windows.
 * Ordem de preferência (seção 6): integração direta > ação local > controle de tela.
 */
const quem = ["dono", "gestor", "operador"] as const;

const disp = async (u: User): Promise<true | string> => ((await pcOnlineDoUsuario(u.id)) ? true : "Nenhum PC com o app do Jarvis está online");

async function noPc(ctx: ToolContext, acao: string, params: Record<string, unknown>, timeoutMs?: number): Promise<string | ToolOutput> {
  const pc = await pcOnlineDoUsuario(ctx.user.id, ctx.deviceId);
  if (!pc) return "Nenhum PC com o app do Jarvis está online agora.";
  const r = await executarNoDispositivo(pc.id, ctx.taskId, acao, params, { timeoutMs, signal: ctx.signal });
  if (!r.ok) throw new Error(r.texto || "falhou no PC");
  return r.imagem ? { texto: r.texto, imagem: r.imagem } : r.texto;
}

export const pcAbrir = defineTool({
  name: "pc_abrir",
  description: "Abre no PC do usuário um programa (ex.: 'excel', 'chrome', 'calc', 'explorer'), um site (URL) ou um arquivo/pasta (caminho).",
  grupo: "pc",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ alvo: z.string().describe("Nome do programa, URL ou caminho") }),
  run: (i, ctx) => noPc(ctx, "abrir", i),
});

export const pcArquivos = defineTool({
  name: "pc_arquivos",
  description:
    "Mexe em arquivos do PC: listar uma pasta, ler um arquivo de texto, criar pasta, mover, copiar ou escrever um arquivo de texto. Atalhos de caminho: ~ (pasta do usuário), ~/Desktop, ~/Documents, ~/Downloads.",
  grupo: "pc",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({
    acao: z.enum(["listar", "ler", "criar_pasta", "mover", "copiar", "escrever"]),
    caminho: z.string(),
    destino: z.string().optional().describe("Para mover/copiar"),
    conteudo: z.string().optional().describe("Para escrever"),
  }),
  run: (i, ctx) => noPc(ctx, "arquivos", i),
});

export const pcApagar = defineTool({
  name: "pc_apagar",
  description: "Apaga um arquivo ou pasta do PC (vai para a Lixeira quando possível). Exige PIN.",
  grupo: "pc",
  nivel: "pin",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ caminho: z.string() }),
  resumo: (i) => `Apagar no PC: ${i.caminho}`,
  run: (i, ctx) => noPc(ctx, "apagar", i),
});

export const pcComando = defineTool({
  name: "pc_comando",
  description: "Executa um comando PowerShell no PC e devolve a saída. Pede confirmação. Prefira as outras ferramentas quando servirem.",
  grupo: "pc",
  nivel: "confirmar",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ comando: z.string().max(4000), motivo: z.string().describe("Em uma frase, o que o comando faz") }),
  resumo: (i) => `Rodar no PC (PowerShell): ${i.motivo}\n\n${i.comando.slice(0, 500)}`,
  run: (i, ctx) => noPc(ctx, "comando", { comando: i.comando }, 120_000),
});

export const pcJanelas = defineTool({
  name: "pc_janelas",
  description: "Lista as janelas abertas no PC (programa e título) e qual está em foco.",
  grupo: "pc",
  nivel: "livre",
  perfis: [...quem],
  muda: false,
  disponivel: disp,
  schema: z.object({}),
  run: (i, ctx) => noPc(ctx, "janelas", i),
});

export const pcPrint = defineTool({
  name: "pc_print",
  description:
    "Tira um print da tela do PC e mostra para você. Use no controle de tela: veja a tela, aja com pc_mouse/pc_teclado e tire outro print para conferir. As coordenadas de pc_mouse são em pixels deste print.",
  grupo: "pc",
  nivel: "livre",
  perfis: [...quem],
  muda: false,
  disponivel: disp,
  schema: z.object({ monitor: z.number().int().min(0).max(5).default(0).describe("0 = principal") }),
  run: (i, ctx) => noPc(ctx, "print", i),
});

export const pcMouse = defineTool({
  name: "pc_mouse",
  description: "Controla o mouse do PC: clique, duplo clique, clique direito, mover ou rolar. x/y em pixels do último print (pc_print).",
  grupo: "pc",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({
    acao: z.enum(["clique", "duplo", "direito", "mover", "rolar"]),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    rolagem: z.number().int().optional().describe("Para rolar: positivo desce, negativo sobe"),
  }),
  run: (i, ctx) => noPc(ctx, "mouse", i),
});

export const pcTeclado = defineTool({
  name: "pc_teclado",
  description: "Digita um texto e/ou pressiona teclas no PC. Atalhos no formato 'ctrl+c', 'alt+tab', 'enter', 'win+r'.",
  grupo: "pc",
  nivel: "livre",
  perfis: [...quem],
  muda: true,
  disponivel: disp,
  schema: z.object({ texto: z.string().max(5000).optional(), teclas: z.array(z.string()).max(20).optional().describe("Pressionadas em ordem, depois do texto") }),
  run: (i, ctx) => noPc(ctx, "teclado", i),
});
