import { z } from "zod";
import { defineTool } from "../types.js";

/**
 * Sub-agentes em paralelo (Fase 4): divide um pedido grande em partes independentes que rodam
 * ao mesmo tempo, cada uma com ferramentas só de leitura. O agente principal junta os resultados.
 */
export const subagentes = defineTool({
  name: "subagentes",
  description:
    "Divide um pedido grande em 2 a 6 partes INDEPENDENTES e executa todas ao mesmo tempo (ex.: o mesmo relatório para várias empresas, comparar várias fontes, pesquisar vários temas). Cada parte só consulta (não muda, envia nem apaga nada) e devolve um resultado em texto; depois você junta tudo na resposta. Não use para pedidos simples ou para partes que dependem umas das outras.",
  grupo: "agente",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador", "loja"],
  muda: false,
  schema: z.object({
    partes: z
      .array(
        z.object({
          titulo: z.string().max(80).describe("Nome curto da parte, ex.: 'Master Laudo'"),
          instrucao: z.string().max(4000).describe("Instrução completa e autossuficiente: o sub-agente não vê a conversa"),
          complexa: z.boolean().default(false).describe("true se exigir análise mais profunda (usa o modelo forte)"),
        }),
      )
      .min(2)
      .max(6),
  }),
  run: async (i, ctx) => {
    if (ctx.subagente) return "Sub-agentes não podem criar outros sub-agentes. Faça esta parte diretamente.";
    const { runSubagente } = await import("../orchestrator.js"); // import tardio: evita ciclo de módulos
    const inicio = Date.now();
    await ctx.notify(`Vou dividir em ${i.partes.length} partes e fazer ao mesmo tempo.`).catch(() => {});
    const resultados = await Promise.all(
      i.partes.map(async (p) => {
        try {
          return { titulo: p.titulo, ok: true, texto: await runSubagente(ctx, p.titulo, p.instrucao, p.complexa) };
        } catch (err) {
          if (ctx.signal.aborted) throw err;
          return { titulo: p.titulo, ok: false, texto: `Falhou: ${(err as Error).message}` };
        }
      }),
    );
    const s = Math.round((Date.now() - inicio) / 1000);
    return [
      `${resultados.length} partes concluídas em ${s}s (${resultados.filter((r) => !r.ok).length} com falha).`,
      ...resultados.map((r) => `<parte titulo="${r.titulo}" ok="${r.ok}">\n${r.texto}\n</parte>`),
    ].join("\n\n");
  },
});
