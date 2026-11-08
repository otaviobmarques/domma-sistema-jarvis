import { google } from "googleapis";
import { config } from "./config.js";
import { db, json } from "./db.js";
import { decrypt, encrypt } from "./crypto.js";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/adwords",
  "openid",
  "email",
];

export async function getIntegration(tenantId: string, tipo: string, userId: string | null = null) {
  const sql = db();
  const rows = await sql<{ id: string; tokens_criptografados: string | null; config: Record<string, unknown>; status: string }[]>`
    select id, tokens_criptografados, config, status from integrations
    where tenant_id = ${tenantId} and tipo = ${tipo}
      and (user_id = ${userId} or (${userId}::uuid is null and user_id is null) or user_id is null)
      and status = 'ativa'
    order by (user_id is not null) desc
    limit 1`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    config: row.config,
    tokens: row.tokens_criptografados ? (JSON.parse(decrypt(row.tokens_criptografados)) as Record<string, any>) : {},
  };
}

export async function saveIntegration(opts: {
  tenantId: string;
  userId: string | null;
  tipo: string;
  tokens?: Record<string, unknown>;
  config?: Record<string, unknown>;
  escopos?: string[];
}) {
  const sql = db();
  const enc = opts.tokens ? encrypt(JSON.stringify(opts.tokens)) : null;
  const existing = await sql<{ id: string }[]>`
    select id from integrations where tenant_id = ${opts.tenantId} and tipo = ${opts.tipo}
      and coalesce(user_id, '00000000-0000-0000-0000-000000000000') = coalesce(${opts.userId}::uuid, '00000000-0000-0000-0000-000000000000')
      and company_id is null`;
  if (existing[0]) {
    await sql`update integrations set
        tokens_criptografados = coalesce(${enc}, tokens_criptografados),
        config = config || ${json(opts.config ?? {})},
        escopos = ${opts.escopos ?? []},
        status = 'ativa', atualizado_em = now()
      where id = ${existing[0].id}`;
    return existing[0].id;
  }
  const [row] = await sql<{ id: string }[]>`
    insert into integrations (tenant_id, user_id, tipo, tokens_criptografados, config, escopos)
    values (${opts.tenantId}, ${opts.userId}, ${opts.tipo}, ${enc}, ${json(opts.config ?? {})}, ${opts.escopos ?? []})
    returning id`;
  return row!.id;
}

export function googleOAuthClient() {
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, `${config.publicUrl}/oauth/google/callback`);
}

/** Cliente Google autenticado com o token do usuário (renova e salva automaticamente). */
export async function googleFor(tenantId: string, userId: string) {
  if (!config.google.clientId) throw new Error("Google não configurado (GOOGLE_CLIENT_ID/SECRET).");
  const integ = await getIntegration(tenantId, "google", userId);
  if (!integ?.tokens.refresh_token) throw new Error(`Conta Google não conectada. Conecte em ${config.panelUrl}/integracoes`);
  const auth = googleOAuthClient();
  auth.setCredentials(integ.tokens);
  auth.on("tokens", (t) => {
    void saveIntegration({ tenantId, userId, tipo: "google", tokens: { ...integ.tokens, ...t } });
  });
  return auth;
}

export async function googleDisponivel(tenantId: string, userId: string): Promise<true | string> {
  if (!config.google.clientId) return "Google não configurado no servidor";
  const integ = await getIntegration(tenantId, "google", userId);
  return integ?.tokens.refresh_token ? true : "Conta Google não conectada no painel";
}
