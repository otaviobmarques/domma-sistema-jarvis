import { db } from "./db.js";

/**
 * Tavinho como produto (Fase 4): cada cliente é um tenant. A Domma é o tenant "plataforma"
 * (dono das chaves de IA/voz e do app do Google); os demais pagam por usuário ativo.
 */

export type StatusTenant = "teste" | "ativo" | "inadimplente" | "bloqueado" | "cancelado";

export interface Situacao {
  liberado: boolean;
  status: StatusTenant;
  plataforma: boolean;
  motivo?: string;
  /** dias que faltam do teste (status teste) */
  diasTeste?: number;
}

export interface ConfigPlataforma {
  preco_usuario: number;
  dias_teste: number;
  limite_ia_usuario_usd: number;
  tolerancia_dias: number;
}

const cache = new Map<string, { s: Situacao; ate: number }>();

export function invalidarTenant(tenantId?: string) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

export async function configPlataforma(): Promise<ConfigPlataforma> {
  const [c] = await db()<ConfigPlataforma[]>`select preco_usuario, dias_teste, limite_ia_usuario_usd, tolerancia_dias from plataforma_config limit 1`;
  return {
    preco_usuario: Number(c?.preco_usuario ?? 99),
    dias_teste: Number(c?.dias_teste ?? 14),
    limite_ia_usuario_usd: Number(c?.limite_ia_usuario_usd ?? 15),
    tolerancia_dias: Number(c?.tolerancia_dias ?? 5),
  };
}

/** O cliente pode usar o Tavinho agora? (cache de 30 s) */
export async function situacaoTenant(tenantId: string): Promise<Situacao> {
  const c = cache.get(tenantId);
  if (c && c.ate > Date.now()) return c.s;
  const s = await calcular(tenantId);
  cache.set(tenantId, { s, ate: Date.now() + 30_000 });
  return s;
}

async function calcular(tenantId: string): Promise<Situacao> {
  const [t] = await db()<{ status: StatusTenant; plataforma: boolean; teste_ate: Date | null; atraso_desde: Date | null }[]>`
    select status, plataforma, teste_ate, atraso_desde from tenants where id = ${tenantId}`;
  if (!t) return { liberado: false, status: "cancelado", plataforma: false, motivo: "Conta não encontrada." };
  if (t.plataforma) return { liberado: true, status: "ativo", plataforma: true };
  switch (t.status) {
    case "ativo":
      return { liberado: true, status: t.status, plataforma: false };
    case "teste": {
      const dias = t.teste_ate ? Math.ceil((t.teste_ate.getTime() - Date.now()) / 86_400_000) : 0;
      if (dias > 0) return { liberado: true, status: t.status, plataforma: false, diasTeste: dias };
      return { liberado: false, status: t.status, plataforma: false, diasTeste: 0, motivo: "O período de teste do Tavinho terminou. Para continuar, o responsável pela conta pode assinar no painel (Assinatura)." };
    }
    case "inadimplente": {
      const { tolerancia_dias } = await configPlataforma();
      const dias = t.atraso_desde ? (Date.now() - t.atraso_desde.getTime()) / 86_400_000 : 0;
      if (dias <= tolerancia_dias) return { liberado: true, status: t.status, plataforma: false, motivo: "Há uma fatura do Tavinho em atraso." };
      return { liberado: false, status: t.status, plataforma: false, motivo: "O Tavinho está suspenso por uma fatura em atraso. O responsável pela conta pode pagar pelo painel (Assinatura)." };
    }
    case "bloqueado":
      return { liberado: false, status: t.status, plataforma: false, motivo: "O Tavinho está suspenso nesta conta. Fale com o responsável pela assinatura." };
    default:
      return { liberado: false, status: t.status, plataforma: false, motivo: "A assinatura do Tavinho desta conta foi cancelada." };
  }
}

/** Franquia de IA do cliente no mês: usuários ativos × limite por usuário. */
const cacheFranquia = new Map<string, { r: { estourou: boolean; gasto: number; limite: number }; ate: number }>();

export async function franquiaEstourada(tenantId: string): Promise<{ estourou: boolean; gasto: number; limite: number }> {
  const c = cacheFranquia.get(tenantId);
  if (c && c.ate > Date.now()) return c.r;
  const r = await calcularFranquia(tenantId);
  cacheFranquia.set(tenantId, { r, ate: Date.now() + 60_000 }); // a voz não pode esperar essa soma a cada fala
  return r;
}

async function calcularFranquia(tenantId: string): Promise<{ estourou: boolean; gasto: number; limite: number }> {
  const s = await situacaoTenant(tenantId);
  if (s.plataforma) return { estourou: false, gasto: 0, limite: 0 };
  const { limite_ia_usuario_usd } = await configPlataforma();
  const [r] = await db()<{ gasto: string | null; usuarios: number }[]>`
    select (select sum(t.custo) from tasks t join users u on u.id = t.user_id
             where u.tenant_id = ${tenantId} and t.inicio >= date_trunc('month', now() at time zone 'America/Sao_Paulo')) as gasto,
           (select count(*)::int from users where tenant_id = ${tenantId} and ativo) as usuarios`;
  const gasto = Number(r?.gasto ?? 0);
  const limite = Math.max(1, r?.usuarios ?? 1) * limite_ia_usuario_usd;
  return { estourou: gasto >= limite, gasto, limite };
}

/** Usuários que contam na cobrança: ativos. */
export async function usuariosAtivos(tenantId: string): Promise<number> {
  const [r] = await db()<{ n: number }[]>`select count(*)::int as n from users where tenant_id = ${tenantId} and ativo`;
  return r?.n ?? 0;
}

export async function precoUsuario(tenantId: string): Promise<number> {
  const [t] = await db()<{ preco_usuario: string | null }[]>`select preco_usuario from tenants where id = ${tenantId}`;
  return t?.preco_usuario != null ? Number(t.preco_usuario) : (await configPlataforma()).preco_usuario;
}

export async function tenantPlataforma(): Promise<string | null> {
  const [t] = await db()<{ id: string }[]>`select id from tenants where plataforma limit 1`;
  return t?.id ?? null;
}
