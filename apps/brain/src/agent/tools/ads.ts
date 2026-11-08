import { z } from "zod";
import { config } from "../../lib/config.js";
import { audit } from "../../lib/db.js";
import { getIntegration, googleFor } from "../../lib/integrations.js";
import { defineTool, type User } from "../types.js";

// ------------------------------------------------------------------ Meta Ads
async function metaToken(user: User): Promise<string> {
  const integ = await getIntegration(user.tenant_id, "meta_ads", null);
  const token = (integ?.tokens.access_token as string | undefined) ?? config.meta.accessToken;
  if (!token) throw new Error("Meta Ads não configurado. Cadastre o token no painel (Integrações).");
  return token;
}

async function metaGet(user: User, path: string, params: Record<string, string>) {
  const url = new URL(`https://graph.facebook.com/${config.meta.apiVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", await metaToken(user));
  const res = await fetch(url);
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(`Meta API: ${body?.error?.message ?? res.status}`);
  return body;
}

const metaDisp = async (u: User): Promise<true | string> => {
  if (config.meta.accessToken) return true;
  const i = await getIntegration(u.tenant_id, "meta_ads", null);
  return i?.tokens.access_token ? true : "Meta Ads não configurado";
};

export const metaAdsContas = defineTool({
  name: "meta_ads_contas",
  description: "Lista as contas de anúncio da Meta (Facebook/Instagram) acessíveis, com id e nome.",
  grupo: "anuncios",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador"],
  muda: false,
  disponivel: metaDisp,
  schema: z.object({}),
  async run(_i, ctx) {
    const data = await metaGet(ctx.user, "me/adaccounts", { fields: "id,name,account_status,currency", limit: "200" });
    return (data.data as any[]).map((a) => `- ${a.id} | ${a.name} | status ${a.account_status} | ${a.currency}`).join("\n") || "Nenhuma conta.";
  },
});

export const metaAdsDesempenho = defineTool({
  name: "meta_ads_desempenho",
  description:
    "Relatório de desempenho de campanhas da Meta numa conta: gasto, impressões, cliques, CTR, CPC, conversões (leads/compras) e CPA. Período por date_preset (today, yesterday, last_7d, this_month...).",
  grupo: "anuncios",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador"],
  muda: false,
  disponivel: metaDisp,
  schema: z.object({
    conta_id: z.string().describe("act_XXXX"),
    periodo: z.string().default("last_7d"),
    nivel: z.enum(["campaign", "adset", "ad", "account"]).default("campaign"),
  }),
  async run({ conta_id, periodo, nivel }, ctx) {
    const id = conta_id.startsWith("act_") ? conta_id : `act_${conta_id}`;
    const data = await metaGet(ctx.user, `${id}/insights`, {
      level: nivel,
      date_preset: periodo,
      fields: "campaign_id,campaign_name,adset_name,spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type",
      limit: "200",
    });
    const rows = data.data as any[];
    if (!rows.length) return "Sem dados no período.";
    return rows
      .map((r) => {
        const conv = (r.actions ?? []).filter((a: any) => /lead|purchase|complete_registration|onsite_conversion.messaging/.test(a.action_type));
        const cpa = (r.cost_per_action_type ?? []).filter((a: any) => /lead|purchase|messaging/.test(a.action_type));
        return `- ${r.campaign_name ?? id}${r.adset_name ? ` / ${r.adset_name}` : ""} (id ${r.campaign_id ?? "-"}) | gasto R$ ${r.spend} | impr ${r.impressions} | cliques ${r.clicks} | CTR ${Number(r.ctr ?? 0).toFixed(2)}% | CPC ${r.cpc ?? "-"} | conv ${conv.map((a: any) => `${a.action_type}=${a.value}`).join(", ") || "0"} | CPA ${cpa.map((a: any) => `${a.action_type}=${Number(a.value).toFixed(2)}`).join(", ") || "-"}`;
      })
      .join("\n");
  },
});

export const metaAdsStatus = defineTool({
  name: "meta_ads_status",
  description: "Pausa ou ativa uma campanha/conjunto/anúncio da Meta. Exige PIN.",
  grupo: "anuncios",
  nivel: "pin",
  perfis: ["dono"],
  muda: true,
  disponivel: metaDisp,
  schema: z.object({ objeto_id: z.string(), nome: z.string().describe("Nome da campanha, para a confirmação"), status: z.enum(["PAUSED", "ACTIVE"]) }),
  resumo: (i) => `${i.status === "PAUSED" ? "Pausar" : "Ativar"} na Meta: ${i.nome} (${i.objeto_id})`,
  async run({ objeto_id, status }, ctx) {
    const url = `https://graph.facebook.com/${config.meta.apiVersion}/${objeto_id}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status, access_token: await metaToken(ctx.user) }),
    });
    const body = (await res.json()) as any;
    if (!res.ok) throw new Error(`Meta API: ${body?.error?.message ?? res.status}`);
    await audit(ctx.user.id, "meta_ads.status", objeto_id, null, { status });
    return `Status alterado para ${status}.`;
  },
});

export const metaAdsOrcamento = defineTool({
  name: "meta_ads_orcamento",
  description: "Altera o orçamento diário de uma campanha ou conjunto da Meta (valor em reais). Exige PIN.",
  grupo: "anuncios",
  nivel: "pin",
  perfis: ["dono"],
  muda: true,
  disponivel: metaDisp,
  schema: z.object({ objeto_id: z.string(), nome: z.string(), orcamento_diario_reais: z.number().positive() }),
  resumo: (i) => `Mudar orçamento diário de "${i.nome}" para R$ ${i.orcamento_diario_reais.toFixed(2)}`,
  async run({ objeto_id, orcamento_diario_reais }, ctx) {
    const res = await fetch(`https://graph.facebook.com/${config.meta.apiVersion}/${objeto_id}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ daily_budget: String(Math.round(orcamento_diario_reais * 100)), access_token: await metaToken(ctx.user) }),
    });
    const body = (await res.json()) as any;
    if (!res.ok) throw new Error(`Meta API: ${body?.error?.message ?? res.status}`);
    await audit(ctx.user.id, "meta_ads.orcamento", objeto_id, null, { orcamento_diario_reais });
    return "Orçamento alterado.";
  },
});

// ------------------------------------------------------------------ Google Ads
const gadsDisp = async (u: User): Promise<true | string> => {
  if (!config.google.adsDeveloperToken) return "Google Ads sem developer token (GOOGLE_ADS_DEVELOPER_TOKEN)";
  const i = await getIntegration(u.tenant_id, "google", u.id);
  return i?.tokens.refresh_token ? true : "Conta Google não conectada no painel";
};

async function gadsQuery(user: User, customerId: string, query: string) {
  const auth = await googleFor(user.tenant_id, user.id);
  const { token } = await auth.getAccessToken();
  const cid = customerId.replace(/-/g, "");
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "developer-token": config.google.adsDeveloperToken,
    "content-type": "application/json",
  };
  if (config.google.adsLoginCustomerId) headers["login-customer-id"] = config.google.adsLoginCustomerId.replace(/-/g, "");
  const res = await fetch(`https://googleads.googleapis.com/v21/customers/${cid}/googleAds:search`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(`Google Ads: ${JSON.stringify(body?.error?.details ?? body?.error?.message ?? res.status).slice(0, 500)}`);
  return (body.results ?? []) as any[];
}

export const googleAdsDesempenho = defineTool({
  name: "google_ads_desempenho",
  description: "Desempenho de campanhas do Google Ads de um cliente (customer id): custo, cliques, impressões, conversões, CPA. Período em GAQL (TODAY, YESTERDAY, LAST_7_DAYS, THIS_MONTH...).",
  grupo: "anuncios",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador"],
  muda: false,
  disponivel: gadsDisp,
  schema: z.object({ customer_id: z.string(), periodo: z.string().default("LAST_7_DAYS") }),
  async run({ customer_id, periodo }, ctx) {
    const rows = await gadsQuery(
      ctx.user,
      customer_id,
      `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.cost_per_conversion
       FROM campaign WHERE segments.date DURING ${periodo.replace(/[^A-Z_0-9]/g, "")} ORDER BY metrics.cost_micros DESC LIMIT 100`,
    );
    if (!rows.length) return "Sem dados.";
    return rows
      .map((r) => `- ${r.campaign.name} (id ${r.campaign.id}, ${r.campaign.status}) | custo R$ ${(Number(r.metrics.costMicros ?? 0) / 1e6).toFixed(2)} | cliques ${r.metrics.clicks ?? 0} | impr ${r.metrics.impressions ?? 0} | conv ${Number(r.metrics.conversions ?? 0).toFixed(1)} | CPA ${r.metrics.costPerConversion ? (Number(r.metrics.costPerConversion) / 1e6).toFixed(2) : "-"}`)
      .join("\n");
  },
});

export const googleAdsContas = defineTool({
  name: "google_ads_contas",
  description: "Lista as contas (customer ids) do Google Ads acessíveis.",
  grupo: "anuncios",
  nivel: "livre",
  perfis: ["dono", "gestor", "operador"],
  muda: false,
  disponivel: gadsDisp,
  schema: z.object({}),
  async run(_i, ctx) {
    const auth = await googleFor(ctx.user.tenant_id, ctx.user.id);
    const { token } = await auth.getAccessToken();
    const res = await fetch("https://googleads.googleapis.com/v21/customers:listAccessibleCustomers", {
      headers: { authorization: `Bearer ${token}`, "developer-token": config.google.adsDeveloperToken },
    });
    const body = (await res.json()) as any;
    if (!res.ok) throw new Error(`Google Ads: ${body?.error?.message ?? res.status}`);
    return (body.resourceNames ?? []).join("\n") || "Nenhuma conta.";
  },
});
