import "server-only";
import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __jarvisSql: postgres.Sql<{}> | undefined;
}

/** Conexão do painel ao banco (mesmo usuário restrito do cérebro). Só no servidor. */
export const sql: postgres.Sql<{}> =
  globalThis.__jarvisSql ??
  (globalThis.__jarvisSql = postgres((process.env.DATABASE_URL ?? "").split(",")[0]!, {
    max: 5,
    idle_timeout: 30,
    prepare: false,
    onnotice: () => {},
  }));
