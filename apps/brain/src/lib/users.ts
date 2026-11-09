import type { User } from "../agent/types.js";
import { db } from "./db.js";

const COLS = `id, tenant_id, nome, perfil, whatsapp, email, pin_hash, autonomia, autonomia_total_ate,
  horario_silencio_inicio::text, horario_silencio_fim::text, preferencias, limite_mensal_usd, ativo, pausado`;

/** Variantes de um número brasileiro com e sem o nono dígito. */
export function phoneVariants(numero: string): string[] {
  const d = numero.replace(/\D/g, "");
  const out = new Set([d]);
  if (d.startsWith("55") && d.length === 13) out.add(d.slice(0, 4) + d.slice(5));
  if (d.startsWith("55") && d.length === 12) out.add(d.slice(0, 4) + "9" + d.slice(4));
  return [...out];
}

export async function userByWhatsApp(numero: string): Promise<User | null> {
  const sql = db();
  const rows = await sql.unsafe<User[]>(`select ${COLS} from users where whatsapp = any($1) and ativo limit 1`, [phoneVariants(numero)]);
  return rows[0] ?? null;
}

const cacheUser = new Map<string, { u: User; ate: number }>();

/** Versão com cache curto (5 s) para o caminho da voz. Mudanças feitas pelo cérebro invalidam na hora. */
export async function userByIdRapido(id: string): Promise<User | null> {
  const c = cacheUser.get(id);
  if (c && c.ate > Date.now()) return c.u;
  const u = await userById(id);
  if (u) cacheUser.set(id, { u, ate: Date.now() + 5_000 });
  return u;
}

export function invalidarUsuario(id?: string) {
  if (id) cacheUser.delete(id);
  else cacheUser.clear();
}

export async function userById(id: string): Promise<User | null> {
  const sql = db();
  const rows = await sql.unsafe<User[]>(`select ${COLS} from users where id = $1`, [id]);
  return rows[0] ?? null;
}

export async function owners(): Promise<User[]> {
  const sql = db();
  return sql.unsafe<User[]>(`select ${COLS} from users where perfil = 'dono' and ativo`);
}
