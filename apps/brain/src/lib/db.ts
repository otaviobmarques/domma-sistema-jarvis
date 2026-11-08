import postgres from "postgres";
import { config } from "./config.js";
import { log } from "./log.js";

export type Sql = postgres.Sql<{}>;

let instance: Sql | null = null;

/** Conecta testando cada URL (o host do pooler do Supabase varia por região/geração). */
export async function connectDb(): Promise<Sql> {
  let lastErr: unknown;
  for (const url of config.databaseUrls) {
    const host = new URL(url).host;
    const conn = postgres(url, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
      prepare: false, // compatível com o pooler em modo transação
      onnotice: () => {},
    });
    try {
      await conn`select 1`;
      log.info({ host }, "banco conectado");
      instance = conn;
      return conn;
    } catch (err) {
      lastErr = err;
      log.warn({ host, err: String(err) }, "falha ao conectar, tentando próxima URL");
      await conn.end({ timeout: 1 }).catch(() => {});
    }
  }
  throw lastErr ?? new Error("Nenhuma DATABASE_URL configurada");
}

export function db(): Sql {
  if (!instance) throw new Error("Banco não conectado");
  return instance;
}

export function json(v: unknown) {
  return db().json((v ?? null) as postgres.JSONValue);
}

export async function audit(
  userId: string | null,
  acao: string,
  alvo?: string | null,
  antes?: unknown,
  depois?: unknown,
  dispositivo = "nuvem",
) {
  const sql = db();
  await sql`insert into audit_log (user_id, acao, alvo, antes, depois, dispositivo)
            values (${userId}, ${acao}, ${alvo ?? null}, ${json(antes)}, ${json(depois)}, ${dispositivo})`;
}
