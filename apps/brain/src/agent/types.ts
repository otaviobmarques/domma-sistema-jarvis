import type { z } from "zod";

export type Perfil = "dono" | "gestor" | "operador" | "loja";
export type Canal = "voz" | "whatsapp" | "app" | "painel" | "rotina";

/** Nível de aprovação exigido por uma ferramenta (seção 9 e 10 do documento). */
export type NivelAprovacao = "livre" | "confirmar" | "pin" | "pin_voz";

export interface User {
  id: string;
  tenant_id: string;
  nome: string;
  perfil: Perfil;
  whatsapp: string | null;
  email: string | null;
  pin_hash: string | null;
  autonomia: number;
  autonomia_total_ate: Date | null;
  horario_silencio_inicio: string | null;
  horario_silencio_fim: string | null;
  preferencias: Record<string, unknown>;
  limite_mensal_usd: string | null;
  ativo: boolean;
  pausado: boolean;
}

export interface ToolContext {
  user: User;
  taskId: string;
  canal: Canal;
  signal: AbortSignal;
  /** Envia uma mensagem intermediária ao usuário (ex.: "Entendi, fazendo..."). */
  notify: (text: string) => Promise<void>;
}

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Grupo para o painel e para a matriz de permissões. */
  grupo: string;
  /** Nível padrão de aprovação. */
  nivel: NivelAprovacao;
  /** Perfis que podem usar a ferramenta. */
  perfis: Perfil[];
  /** true se a ferramenta muda algo (usado pelos níveis de autonomia). */
  muda: boolean;
  /** Resumo legível do que será feito, mostrado no pedido de confirmação. */
  resumo?: (input: z.infer<S>) => string;
  /** Disponível? (ex.: integração configurada). Se retornar string, é o motivo da indisponibilidade. */
  disponivel?: (user: User) => Promise<true | string>;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<string>;
}

export function defineTool<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}
