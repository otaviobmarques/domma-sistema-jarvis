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
}

export const currentUser = cache(async (): Promise<PanelUser | null> => {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const rows = await sql<PanelUser[]>`
    select id, tenant_id, nome, perfil, email, whatsapp, autonomia, pausado, pin_hash is not null as tem_pin
    from users where auth_user_id = ${data.user.id} and ativo`;
  return rows[0] ?? null;
});

export async function requireUser(perfis?: Perfil[]): Promise<PanelUser> {
  const u = await currentUser();
  if (!u) {
    // logado no Supabase mas sem cadastro ativo no Jarvis → avisa no login
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();
    if (data.user) redirect("/login?erro=2");
    redirect("/login");
  }
  if (perfis && !perfis.includes(u.perfil)) redirect("/?erro=sem-permissao");
  return u;
}
