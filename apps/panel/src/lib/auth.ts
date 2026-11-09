import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql } from "./db";
import { supabaseServer } from "./supabase";

export type Perfil = "dono" | "gestor" | "operador" | "loja";
export interface PanelUser {
  id: string;
  tenant_id: string;
  nome: string;
  perfil: Perfil;
  email: string | null;
  whatsapp: string | null;
  autonomia: number;
  pausado: boolean;
  tem_pin: boolean;
  /** tenant da Domma (administra os clientes do Tavinho) */
  plataforma: boolean;
  tenant_status: "teste" | "ativo" | "inadimplente" | "bloqueado" | "cancelado";
  teste_ate: Date | null;
}

export const currentUser = cache(async (): Promise<PanelUser | null> => {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const rows = await sql<PanelUser[]>`
    select u.id, u.tenant_id, u.nome, u.perfil, u.email, u.whatsapp, u.autonomia, u.pausado, u.pin_hash is not null as tem_pin,
           t.plataforma, t.status as tenant_status, t.teste_ate
    from users u join tenants t on t.id = u.tenant_id
    where u.auth_user_id = ${data.user.id} and u.ativo`;
  return rows[0] ?? null;
});

export async function requireUser(perfis?: Perfil[]): Promise<PanelUser> {
  const u = await currentUser();
  if (!u) {
    // logado no Supabase mas sem cadastro ativo no Tavinho → avisa no login
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    if (data.user) redirect("/login?erro=2");
    redirect("/login");
  }
  if (perfis && !perfis.includes(u.perfil)) redirect("/?erro=sem-permissao");
  return u;
}
