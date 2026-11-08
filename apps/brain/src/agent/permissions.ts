import type { NivelAprovacao, ToolDef, User } from "./types.js";

export type Decisao = { tipo: "negado"; motivo: string } | { tipo: "livre" } | { tipo: "aprovacao"; nivel: Exclude<NivelAprovacao, "livre"> };

const ordem: NivelAprovacao[] = ["livre", "confirmar", "pin", "pin_voz"];
const max = (a: NivelAprovacao, b: NivelAprovacao) => (ordem.indexOf(a) >= ordem.indexOf(b) ? a : b);

export function autonomiaEfetiva(user: User, agora = new Date()): number {
  if (user.autonomia === 4) {
    // Nível 4 só vale para o dono e desliga sozinho após o tempo definido.
    if (user.perfil !== "dono") return 3;
    if (!user.autonomia_total_ate || user.autonomia_total_ate < agora) return 3;
  }
  return user.autonomia;
}

/**
 * Decide o que fazer antes de executar uma ferramenta.
 * Combina: perfil (matriz da seção 10) + nível padrão da ferramenta (seção 9)
 * + nível de autonomia do usuário (seção 7.2).
 */
export function decidir(user: User, tool: ToolDef): Decisao {
  if (!tool.perfis.includes(user.perfil)) {
    return { tipo: "negado", motivo: `O perfil "${user.perfil}" não tem permissão para ${tool.name}.` };
  }
  let nivel = tool.nivel;
  const aut = autonomiaEfetiva(user);

  if (aut === 1 && tool.muda) nivel = max(nivel, "confirmar"); // Assistido: pergunta antes de qualquer mudança
  if (aut === 3 && nivel === "confirmar" && tool.grupo !== "comunicacao") nivel = "livre"; // Total: só pede em dinheiro, exclusão e mensagens para fora
  if (aut === 4 && (nivel === "confirmar" || nivel === "pin")) nivel = "livre"; // Total sem travas (pin_voz continua)

  return nivel === "livre" ? { tipo: "livre" } : { tipo: "aprovacao", nivel };
}
