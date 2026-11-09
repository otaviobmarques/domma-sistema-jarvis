import { randomBytes } from "node:crypto";
import { safeEqual } from "./crypto.js";
import { audit, db } from "./db.js";
import { getIntegration, saveIntegration } from "./integrations.js";
import { log } from "./log.js";
import { configPlataforma, invalidarTenant, precoUsuario, tenantPlataforma, usuariosAtivos } from "./plataforma.js";

/**
 * Cobrança do Tavinho pelo Asaas: uma assinatura mensal por cliente, no valor
 * usuários ativos × preço por usuário. O cliente escolhe Pix, boleto ou cartão (billingType UNDEFINED).
 * A chave da API fica criptografada na integração "asaas" do tenant da plataforma.
 */

interface ChavesAsaas {
  apiKey: string;
  webhookToken: string;
  base: string;
  sandbox: boolean;
}

async function chaves(): Promise<ChavesAsaas | null> {
  const t = await tenantPlataforma();
  if (!t) return null;
  const i = await getIntegration(t, "asaas");
  if (!i?.tokens.api_key) return null;
  const sandbox = i.config.ambiente === "sandbox";
  const base = process.env.ASAAS_BASE_URL ?? (sandbox ? "https://api-sandbox.asaas.com/v3" : "https://api.asaas.com/v3");
  return { apiKey: i.tokens.api_key, webhookToken: i.tokens.webhook_token ?? "", base, sandbox };
}

export async function asaasConfigurado() {
  return !!(await chaves());
}

/** Cadastra (ou troca) a chave. Gera o token que o Asaas deve mandar no webhook. */
export async function salvarChaveAsaas(userId: string, apiKey: string, sandbox: boolean) {
  const t = await tenantPlataforma();
  if (!t) throw new Error("tenant da plataforma não encontrado");
  const atual = await getIntegration(t, "asaas");
  const webhookToken = atual?.tokens.webhook_token || randomBytes(24).toString("base64url");
  await saveIntegration({ tenantId: t, userId: null, tipo: "asaas", tokens: { api_key: apiKey, webhook_token: webhookToken }, config: { ambiente: sandbox ? "sandbox" : "producao" } });
  await audit(userId, "plataforma.asaas_chave", null, null, { sandbox });
  // confere a chave na hora
  const k = (await chaves())!;
  await chamar(k, "GET", "/myAccount/commercialInfo").catch(async () => chamar(k, "GET", "/customers?limit=1"));
  return { webhookToken };
}

export async function tokenWebhook() {
  return (await chaves())?.webhookToken ?? null;
}

async function chamar<T = any>(k: ChavesAsaas, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${k.base}${path}`, {
    method,
    headers: { access_token: k.apiKey, "content-type": "application/json", "user-agent": "Tavinho/1.0 (Domma Tecnologia)" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const msg = data?.errors?.map((e: { description: string }) => e.description).join("; ") || `Asaas respondeu ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // data em São Paulo

/** Cria cliente + assinatura no Asaas para o tenant (no fim do teste, vence a 1ª fatura). */
export async function criarAssinatura(tenantId: string) {
  const k = await chaves();
  if (!k) return { ok: false as const, motivo: "Asaas não configurado" };
  const sql = db();
  const [t] = await sql<{ nome: string; documento: string | null; email_cobranca: string | null; telefone: string | null; asaas_cliente_id: string | null; asaas_assinatura_id: string | null; teste_ate: Date | null }[]>`
    select nome, documento, email_cobranca, telefone, asaas_cliente_id, asaas_assinatura_id, teste_ate from tenants where id = ${tenantId}`;
  if (!t) throw new Error("tenant não encontrado");
  if (t.asaas_assinatura_id) return { ok: true as const, assinatura: t.asaas_assinatura_id };
  let cliente = t.asaas_cliente_id;
  if (!cliente) {
    const c = await chamar<{ id: string }>(k, "POST", "/customers", {
      name: t.nome,
      cpfCnpj: t.documento ?? undefined,
      email: t.email_cobranca ?? undefined,
      mobilePhone: t.telefone ? t.telefone.replace(/^55/, "") : undefined,
      externalReference: tenantId,
    });
    cliente = c.id;
    await sql`update tenants set asaas_cliente_id = ${cliente} where id = ${tenantId}`;
  }
  const n = Math.max(1, await usuariosAtivos(tenantId));
  const preco = await precoUsuario(tenantId);
  const valor = Math.round(n * preco * 100) / 100;
  const venc = t.teste_ate && t.teste_ate.getTime() > Date.now() ? new Date(t.teste_ate.getTime() - 3 * 3600_000).toISOString().slice(0, 10) : hoje();
  const a = await chamar<{ id: string }>(k, "POST", "/subscriptions", {
    customer: cliente,
    billingType: "UNDEFINED",
    value: valor,
    nextDueDate: venc,
    cycle: "MONTHLY",
    description: `Tavinho by Domma Tecnologia — ${n} ${n === 1 ? "usuário" : "usuários"}`,
    externalReference: tenantId,
  });
  await sql`update tenants set asaas_assinatura_id = ${a.id}, usuarios_cobrados = ${n}, valor_mensal = ${valor} where id = ${tenantId}`;
  await audit(null, "assinatura.criar", tenantId, null, { usuarios: n, valor, vencimento: venc });
  log.info({ tenantId, valor }, "assinatura criada no Asaas");
  return { ok: true as const, assinatura: a.id };
}

/** Recalcula o valor (usuários ativos × preço) e atualiza a assinatura e as faturas em aberto. */
export async function sincronizarUsuarios(tenantId: string) {
  const sql = db();
  const [t] = await sql<{ plataforma: boolean; asaas_assinatura_id: string | null; usuarios_cobrados: number; valor_mensal: string | null; status: string }[]>`
    select plataforma, asaas_assinatura_id, usuarios_cobrados, valor_mensal, status from tenants where id = ${tenantId}`;
  if (!t || t.plataforma || t.status === "cancelado") return null;
  const n = Math.max(1, await usuariosAtivos(tenantId));
  const valor = Math.round(n * (await precoUsuario(tenantId)) * 100) / 100;
  if (n === t.usuarios_cobrados && Number(t.valor_mensal ?? 0) === valor) return { usuarios: n, valor, mudou: false };
  const k = await chaves();
  if (k && t.asaas_assinatura_id) {
    await chamar(k, "POST", `/subscriptions/${t.asaas_assinatura_id}`, {
      value: valor,
      updatePendingPayments: true,
      description: `Tavinho by Domma Tecnologia — ${n} ${n === 1 ? "usuário" : "usuários"}`,
    });
  }
  await sql`update tenants set usuarios_cobrados = ${n}, valor_mensal = ${valor} where id = ${tenantId}`;
  await audit(null, "assinatura.usuarios", tenantId, { usuarios: t.usuarios_cobrados }, { usuarios: n, valor });
  return { usuarios: n, valor, mudou: true };
}

export async function cancelarAssinatura(tenantId: string, userId: string | null) {
  const sql = db();
  const [t] = await sql<{ asaas_assinatura_id: string | null }[]>`select asaas_assinatura_id from tenants where id = ${tenantId}`;
  const k = await chaves();
  if (k && t?.asaas_assinatura_id) await chamar(k, "DELETE", `/subscriptions/${t.asaas_assinatura_id}`);
  await sql`update tenants set status = 'cancelado', asaas_assinatura_id = null where id = ${tenantId}`;
  invalidarTenant(tenantId);
  await audit(userId, "assinatura.cancelar", tenantId);
}

/** Busca as faturas da assinatura no Asaas e atualiza a tabela local. */
export async function atualizarCobrancas(tenantId: string) {
  const k = await chaves();
  const [t] = await db()<{ asaas_assinatura_id: string | null }[]>`select asaas_assinatura_id from tenants where id = ${tenantId}`;
  if (!k || !t?.asaas_assinatura_id) return 0;
  const r = await chamar<{ data: Pagamento[] }>(k, "GET", `/subscriptions/${t.asaas_assinatura_id}/payments?limit=24`);
  for (const p of r.data ?? []) await gravarCobranca(tenantId, p);
  return r.data?.length ?? 0;
}

interface Pagamento {
  id: string;
  value: number;
  status: string;
  billingType?: string;
  dueDate?: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  invoiceUrl?: string;
  description?: string;
  subscription?: string;
  externalReference?: string | null;
  customer?: string;
}

async function gravarCobranca(tenantId: string, p: Pagamento) {
  const pago = p.paymentDate ?? p.clientPaymentDate ?? null;
  await db()`
    insert into cobrancas (tenant_id, asaas_id, valor, status, forma, vencimento, pago_em, link, descricao)
    values (${tenantId}, ${p.id}, ${p.value}, ${p.status}, ${p.billingType ?? null}, ${p.dueDate ?? null}, ${pago}, ${p.invoiceUrl ?? null}, ${p.description ?? null})
    on conflict (asaas_id) do update set valor = excluded.valor, status = excluded.status, forma = excluded.forma,
      vencimento = excluded.vencimento, pago_em = excluded.pago_em, link = excluded.link, atualizado_em = now()`;
}

const PAGO = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"]);

/**
 * Webhook do Asaas. Confere o token, ignora eventos repetidos e atualiza o status do cliente:
 * pago → ativo; vencido → inadimplente (bloqueia após a tolerância); assinatura removida → cancelado.
 */
export async function webhookAsaas(token: string, evento: { id?: string; event?: string; payment?: Pagamento; subscription?: { id: string; externalReference?: string } }) {
  const esperado = await tokenWebhook();
  if (!esperado || !safeEqual(token, esperado)) return { status: 401 as const };
  const sql = db();
  const id = evento.id ?? `${evento.event}:${evento.payment?.id ?? evento.subscription?.id}:${evento.payment?.status ?? ""}`;
  const [novo] = await sql<{ id: string }[]>`insert into webhook_eventos (id, origem) values (${id}, 'asaas') on conflict do nothing returning id`;
  if (!novo) return { status: 200 as const, repetido: true };

  const assinatura = evento.payment?.subscription ?? evento.subscription?.id;
  const ref = evento.payment?.externalReference ?? evento.subscription?.externalReference;
  const [t] = await sql<{ id: string; status: string }[]>`
    select id, status from tenants
    where (${assinatura ?? null}::text is not null and asaas_assinatura_id = ${assinatura ?? null})
       or (${evento.payment?.customer ?? null}::text is not null and asaas_cliente_id = ${evento.payment?.customer ?? null})
       or (${ref ?? null}::text is not null and id::text = ${ref ?? null})
    limit 1`;
  if (!t) {
    log.warn({ event: evento.event }, "webhook do Asaas sem cliente correspondente");
    return { status: 200 as const };
  }
  if (evento.payment) await gravarCobranca(t.id, evento.payment);
  const ev = evento.event ?? "";
  if (PAGO.has(ev)) {
    await sql`update tenants set status = 'ativo', atraso_desde = null, bloqueado_em = null where id = ${t.id} and status <> 'cancelado'`;
  } else if (ev === "PAYMENT_OVERDUE") {
    await sql`update tenants set status = 'inadimplente', atraso_desde = coalesce(atraso_desde, now()) where id = ${t.id} and status in ('ativo','teste','inadimplente')`;
  } else if (ev === "SUBSCRIPTION_DELETED" || ev === "SUBSCRIPTION_INACTIVATED") {
    await sql`update tenants set status = 'cancelado', asaas_assinatura_id = null where id = ${t.id}`;
  } else if (ev === "PAYMENT_REFUNDED" || ev === "PAYMENT_CHARGEBACK_REQUESTED") {
    await sql`update tenants set status = 'inadimplente', atraso_desde = coalesce(atraso_desde, now()) where id = ${t.id} and status = 'ativo'`;
  }
  invalidarTenant(t.id);
  await audit(null, `asaas.${ev.toLowerCase()}`, t.id, { status: t.status }, { pagamento: evento.payment?.id, valor: evento.payment?.value });
  return { status: 200 as const };
}

/** Rotina diária: bloqueia quem passou da tolerância e sincroniza o número de usuários. */
export async function rotinaCobranca() {
  const sql = db();
  const { tolerancia_dias } = await configPlataforma();
  const bloq = await sql<{ id: string }[]>`
    update tenants set status = 'bloqueado', bloqueado_em = now()
    where not plataforma and (
      (status = 'inadimplente' and atraso_desde < now() - make_interval(days => ${tolerancia_dias}))
      or (status = 'teste' and teste_ate < now() - make_interval(days => ${tolerancia_dias}) and asaas_assinatura_id is null)
    )
    returning id`;
  for (const b of bloq) {
    invalidarTenant(b.id);
    await audit(null, "assinatura.bloquear", b.id);
  }
  const ativos = await sql<{ id: string }[]>`select id from tenants where not plataforma and status in ('teste','ativo','inadimplente')`;
  for (const a of ativos) await sincronizarUsuarios(a.id).catch((err) => log.warn({ err, tenant: a.id }, "sincronizar usuários"));
  return { bloqueados: bloq.length };
}
