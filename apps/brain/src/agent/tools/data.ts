import postgres from "postgres";
import { z } from "zod";
import { db, json } from "../../lib/db.js";
import { decrypt } from "../../lib/crypto.js";
import { defineTool, type User } from "../types.js";

/**
 * Fontes de dados externas (Domma Chat, CRM, Master Laudo, RedBox...) cadastradas
 * no painel como integração tipo "postgres": tokens = {url}, config = {nome, descricao}.
 * Sempre em transação READ ONLY com timeout — o Tavinho consulta, não altera.
 */
const pools = new Map<string, postgres.Sql<{}>>();

async function fontes(user: User) {
  const sql = db();
  return sql<{ id: string; config: { nome: string; descricao?: string } }[]>`
    select id, config from integrations where tenant_id = ${user.tenant_id} and tipo = 'postgres' and status = 'ativa' order by config->>'nome'`;
}

async function pool(user: User, nome: string) {
  const list = await fontes(user);
  const f = list.find((x) => x.config.nome.toLowerCase() === nome.toLowerCase());
  if (!f) throw new Error(`Fonte "${nome}" não cadastrada. Fontes: ${list.map((x) => x.config.nome).join(", ") || "nenhuma"}`);
  let p = pools.get(f.id);
  if (!p) {
    const rows = await db()<{ tokens_criptografados: string }[]>`select tokens_criptografados from integrations where id = ${f.id}`;
    const url = (JSON.parse(decrypt(rows[0]!.tokens_criptografados)) as { url: string }).url;
    p = postgres(url, { max: 3, idle_timeout: 60, connect_timeout: 10, prepare: false, onnotice: () => {} });
    pools.set(f.id, p);
  }
  return p;
}

export const dadosFontes = defineTool({
  name: "dados_fontes",
  description: "Lista as fontes de dados (bancos dos sistemas da empresa) que o Tavinho pode consultar.",
  grupo: "dados",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador"],
  muda: false,
  schema: z.object({}),
  async run(_i, ctx) {
    const list = await fontes(ctx.user);
    return list.length ? list.map((f) => `- ${f.config.nome}: ${f.config.descricao ?? ""}`).join("\n") : "Nenhuma fonte cadastrada. Cadastre no painel em Integrações.";
  },
});

export const dadosEsquema = defineTool({
  name: "dados_esquema",
  description: "Mostra tabelas e colunas de uma fonte de dados (para montar a consulta certa).",
  grupo: "dados",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador"],
  muda: false,
  schema: z.object({ fonte: z.string(), tabela: z.string().optional() }),
  async run({ fonte, tabela }, ctx) {
    const p = await pool(ctx.user, fonte);
    const rows = await p<{ table_name: string; column_name: string; data_type: string }[]>`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = 'public' ${tabela ? p`and table_name = ${tabela}` : p``}
      order by table_name, ordinal_position limit 800`;
    const by = new Map<string, string[]>();
    for (const r of rows) by.set(r.table_name, [...(by.get(r.table_name) ?? []), `${r.column_name}:${r.data_type}`]);
    return [...by].map(([t, cols]) => `${t}(${cols.join(", ")})`).join("\n") || "Nada encontrado.";
  },
});

export const dadosConsultar = defineTool({
  name: "dados_consultar",
  description: "Executa uma consulta SQL SOMENTE LEITURA (SELECT) numa fonte de dados. Limite de 200 linhas e 15 s. Use dados_esquema antes.",
  grupo: "dados",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador"],
  muda: false,
  schema: z.object({ fonte: z.string(), sql: z.string().describe("Uma única instrução SELECT/WITH") }),
  async run({ fonte, sql: query }, ctx) {
    const q = query.trim().replace(/;+\s*$/, "");
    if (!/^(select|with)\b/i.test(q) || q.includes(";")) return "Apenas uma instrução SELECT/WITH é permitida.";
    const p = await pool(ctx.user, fonte);
    const rows = await p.begin("read only", async (tx) => {
      await tx`set local statement_timeout = '15s'`;
      return tx.unsafe(`select * from (${q}) as _q limit 200`);
    });
    await db()`insert into audit_log (user_id, acao, alvo, depois) values (${ctx.user.id}, 'dados.consultar', ${fonte}, ${json({ sql: q, linhas: rows.length })})`;
    const out = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    return out.length > 20000 ? out.slice(0, 20000) + "\n…(truncado)" : out;
  },
});
