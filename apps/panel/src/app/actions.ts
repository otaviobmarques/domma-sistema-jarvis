"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { brain } from "@/lib/brain";
import { sql } from "@/lib/db";

type Result = { ok: boolean; msg?: string };
const fail = (e: unknown): Result => ({ ok: false, msg: (e as Error).message });

// ------------------------------------------------------------------ conversa
export async function chat(texto: string): Promise<{ resposta: string }> {
  const u = await requireUser();
  try {
    const r = await brain<{ resposta: string }>("/api/chat", u.id, { body: { texto } });
    revalidatePath("/");
    return r;
  } catch (e) {
    return { resposta: `⚠️ ${(e as Error).message}` };
  }
}

const ROTULO: Record<string, string> = {
  memoria_buscar: "consultando a memória",
  memoria_salvar: "guardando na memória",
  gmail_buscar: "buscando e-mails",
  gmail_contar: "contando e-mails",
  gmail_ler: "lendo um e-mail",
  gmail_rascunho: "escrevendo rascunho",
  agenda_listar: "olhando a agenda",
  agenda_horario_livre: "procurando horário livre",
  drive_buscar: "procurando no Drive",
  meta_ads_desempenho: "puxando dados da Meta Ads",
  google_ads_desempenho: "puxando dados do Google Ads",
  dados_consultar: "consultando o sistema",
  dados_esquema: "entendendo o banco de dados",
};

/** Passos da tarefa em andamento no painel (para mostrar progresso ao vivo no chat). */
export async function progresso(): Promise<string[]> {
  const u = await requireUser();
  const rows = await sql<{ ferramenta: string; erro: string | null }[]>`
    select s.ferramenta, s.erro from task_steps s
    where s.task_id = (select id from tasks where user_id = ${u.id} and canal = 'painel' and status = 'executando' order by inicio desc limit 1)
    order by s.criado_em`;
  return rows.map((r) => `${r.erro ? "⚠️" : "✓"} ${ROTULO[r.ferramenta] ?? r.ferramenta.replace(/_/g, " ")}`);
}

export async function transcrever(audioBase64: string, mime: string): Promise<{ texto?: string; erro?: string }> {
  const u = await requireUser();
  try {
    return await brain<{ texto: string }>("/api/transcribe", u.id, { body: { audio: audioBase64, mime } });
  } catch (e) {
    return { erro: (e as Error).message };
  }
}

// ------------------------------------------------------------------ aprovações e pânico
export async function aprovar(id: string, pin?: string): Promise<Result> {
  const u = await requireUser();
  try {
    const r = await brain<{ resposta: string }>(`/api/approvals/${id}/approve`, u.id, { body: { pin } });
    revalidatePath("/");
    return { ok: true, msg: r.resposta };
  } catch (e) {
    return fail(e);
  }
}

export async function recusar(id: string): Promise<Result> {
  const u = await requireUser();
  await brain(`/api/approvals/${id}/reject`, u.id, { method: "POST" });
  revalidatePath("/");
  return { ok: true };
}

export async function panico(global: boolean): Promise<Result> {
  const u = await requireUser();
  try {
    const r = await brain<{ interrompidas: number }>("/api/panic", u.id, { body: { global, pausar: true } });
    revalidatePath("/", "layout");
    return { ok: true, msg: `Parado. ${r.interrompidas} tarefa(s) interrompida(s).` };
  } catch (e) {
    return fail(e);
  }
}

export async function retomar(global: boolean): Promise<Result> {
  const u = await requireUser();
  await brain("/api/resume", u.id, { body: { global } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function feedback(taskId: string, valor: 1 | -1) {
  const u = await requireUser();
  await sql`update tasks set feedback = ${valor} where id = ${taskId} and user_id = ${u.id}`;
  revalidatePath("/tarefas");
}

// ------------------------------------------------------------------ memória
export async function memoriaSalvar(form: FormData) {
  const u = await requireUser(["dono", "gestor"]);
  const id = String(form.get("id") ?? "");
  const conteudo = String(form.get("conteudo") ?? "").trim();
  const tipo = String(form.get("tipo") ?? "fato");
  const escopo = String(form.get("escopo") ?? "pessoal");
  if (!conteudo) return;
  if (id) {
    await sql`update memories set conteudo = ${conteudo}, tipo = ${tipo}, escopo = ${escopo}, atualizado_em = now(), confianca = 1
              where id = ${id} and tenant_id = ${u.tenant_id} and (user_id = ${u.id} or ${u.perfil} = 'dono')`;
  } else {
    await sql`insert into memories (user_id, tenant_id, conteudo, tipo, escopo, confianca, origem)
              values (${u.id}, ${u.tenant_id}, ${conteudo}, ${tipo}, ${escopo}, 1, ${sql.json({ canal: "painel", quem: u.nome })})`;
  }
  await sql`insert into audit_log (user_id, acao, alvo, depois) values (${u.id}, ${id ? "memoria.editar" : "memoria.criar"}, ${id || null}, ${sql.json({ conteudo })})`;
  revalidatePath("/memoria");
}

export async function memoriaApagar(id: string) {
  const u = await requireUser(["dono", "gestor"]);
  const del = await sql`delete from memories where id = ${id} and tenant_id = ${u.tenant_id} and (user_id = ${u.id} or ${u.perfil} = 'dono') returning conteudo`;
  if (del.length) await sql`insert into audit_log (user_id, acao, alvo, antes) values (${u.id}, 'memoria.apagar', ${id}, ${sql.json(del[0] as any)})`;
  revalidatePath("/memoria");
}

// ------------------------------------------------------------------ rotinas
export async function rotinaSalvar(form: FormData) {
  const u = await requireUser(["dono", "gestor"]);
  const nome = String(form.get("nome") ?? "").trim();
  const cron = String(form.get("cron") ?? "").trim();
  const instrucao = String(form.get("instrucao") ?? "").trim();
  const critica = form.get("critica") === "on";
  if (!nome || !cron || !instrucao) return;
  if (cron.split(/\s+/).length !== 5) return;
  await sql`insert into routines (user_id, nome, cron, instrucao, critica) values (${u.id}, ${nome}, ${cron}, ${instrucao}, ${critica})`;
  await brain("/api/routines/reload", u.id, { method: "POST" });
  revalidatePath("/rotinas");
}

export async function rotinaAlternar(id: string, ativa: boolean) {
  const u = await requireUser(["dono", "gestor"]);
  await sql`update routines set ativa = ${ativa} where id = ${id} and user_id = ${u.id}`;
  await brain("/api/routines/reload", u.id, { method: "POST" });
  revalidatePath("/rotinas");
}

export async function rotinaApagar(id: string) {
  const u = await requireUser(["dono", "gestor"]);
  await sql`delete from routines where id = ${id} and user_id = ${u.id}`;
  await brain("/api/routines/reload", u.id, { method: "POST" });
  revalidatePath("/rotinas");
}

export async function rotinaRodar(id: string): Promise<Result> {
  const u = await requireUser(["dono", "gestor"]);
  try {
    const r = await brain<{ resposta: string | null }>(`/api/routines/${id}/run`, u.id, { method: "POST" });
    revalidatePath("/rotinas");
    return { ok: true, msg: r.resposta ?? "Executada." };
  } catch (e) {
    return fail(e);
  }
}

export async function skillStatus(id: string, status: string) {
  const u = await requireUser(["dono", "gestor"]);
  await sql`update skills set status = ${status} where id = ${id} and tenant_id = ${u.tenant_id}`;
  revalidatePath("/rotinas");
}

// ------------------------------------------------------------------ usuários
const digits = (s: string) => s.replace(/\D/g, "");

export async function usuarioSalvar(form: FormData): Promise<Result> {
  const u = await requireUser(["dono"]);
  const id = String(form.get("id") ?? "");
  const nome = String(form.get("nome") ?? "").trim();
  const perfil = String(form.get("perfil") ?? "operador");
  const whatsapp = digits(String(form.get("whatsapp") ?? "")) || null;
  const email = String(form.get("email") ?? "").trim() || null;
  const empresas = form.getAll("empresas").map(String);
  if (!nome || !["dono", "gestor", "operador", "loja"].includes(perfil)) return { ok: false, msg: "Dados inválidos" };
  if (whatsapp && !/^\d{12,13}$/.test(whatsapp)) return { ok: false, msg: "WhatsApp deve ter DDI+DDD+número, ex.: 5531999998888" };
  try {
    let userId = id;
    if (id) {
      await sql`update users set nome = ${nome}, perfil = ${perfil}, whatsapp = ${whatsapp}, email = ${email} where id = ${id} and tenant_id = ${u.tenant_id}`;
    } else {
      const [r] = await sql<{ id: string }[]>`insert into users (tenant_id, nome, perfil, whatsapp, email) values (${u.tenant_id}, ${nome}, ${perfil}, ${whatsapp}, ${email}) returning id`;
      userId = r!.id;
    }
    await sql`delete from user_companies where user_id = ${userId}`;
    for (const c of empresas) await sql`insert into user_companies (user_id, company_id) values (${userId}, ${c}) on conflict do nothing`;
    await sql`insert into audit_log (user_id, acao, alvo, depois) values (${u.id}, ${id ? "usuario.editar" : "usuario.criar"}, ${userId}, ${sql.json({ nome, perfil, whatsapp, empresas })})`;
    revalidatePath("/usuarios");
    return { ok: true, msg: "Salvo." };
  } catch (e) {
    return fail(e);
  }
}

export async function usuarioAtivo(id: string, ativo: boolean) {
  const u = await requireUser(["dono"]);
  if (id === u.id) return;
  await sql`update users set ativo = ${ativo} where id = ${id} and tenant_id = ${u.tenant_id}`;
  await sql`insert into audit_log (user_id, acao, alvo) values (${u.id}, ${ativo ? "usuario.ativar" : "usuario.desativar"}, ${id})`;
  revalidatePath("/usuarios");
}

export async function definirPin(userId: string, pin: string): Promise<Result> {
  const u = await requireUser();
  try {
    await brain(`/api/users/${userId || u.id}/pin`, u.id, { body: { pin } });
    revalidatePath("/configuracoes");
    return { ok: true, msg: "PIN definido." };
  } catch (e) {
    return fail(e);
  }
}

export async function salvarConta(form: FormData): Promise<Result> {
  const u = await requireUser();
  const autonomia = Number(form.get("autonomia") ?? 2);
  const horas = Number(form.get("horas_total") ?? 2);
  const inicio = String(form.get("silencio_inicio") ?? "22:00");
  const fim = String(form.get("silencio_fim") ?? "07:00");
  const whatsapp = digits(String(form.get("whatsapp") ?? "")) || null;
  if (autonomia === 4 && u.perfil !== "dono") return { ok: false, msg: "Só o dono pode ligar o nível 4." };
  if (whatsapp && !/^\d{12,13}$/.test(whatsapp)) return { ok: false, msg: "WhatsApp deve ter DDI+DDD+número, ex.: 5531999998888" };
  try {
    await sql`
      update users set autonomia = ${autonomia},
        autonomia_total_ate = ${autonomia === 4 ? new Date(Date.now() + Math.min(Math.max(horas, 0.25), 12) * 3600_000) : null},
        horario_silencio_inicio = ${inicio}, horario_silencio_fim = ${fim}, whatsapp = ${whatsapp}
      where id = ${u.id}`;
    await sql`insert into audit_log (user_id, acao, depois) values (${u.id}, 'conta.salvar', ${sql.json({ autonomia, inicio, fim, whatsapp })})`;
    revalidatePath("/", "layout");
    return { ok: true, msg: "Salvo." };
  } catch (e) {
    return fail(e);
  }
}

export async function limiteMensal(userId: string, valor: number) {
  const u = await requireUser(["dono"]);
  await sql`update users set limite_mensal_usd = ${valor} where id = ${userId} and tenant_id = ${u.tenant_id}`;
  revalidatePath("/custos");
}

// ------------------------------------------------------------------ integrações
export async function googleLink(): Promise<string> {
  const u = await requireUser(["dono", "gestor", "operador"]);
  const { url } = await brain<{ url: string }>("/api/oauth/google/link", u.id);
  return url;
}

export async function salvarMeta(token: string): Promise<Result> {
  const u = await requireUser(["dono"]);
  try {
    await brain("/api/integrations/meta", u.id, { body: { token } });
    revalidatePath("/integracoes");
    return { ok: true, msg: "Token salvo." };
  } catch (e) {
    return fail(e);
  }
}

export async function salvarChave(tipo: "anthropic" | "stt", key: string): Promise<Result> {
  const u = await requireUser(["dono"]);
  try {
    await brain("/api/integrations/key", u.id, { body: { tipo, key } });
    revalidatePath("/integracoes");
    return { ok: true, msg: "Chave salva e ativada." };
  } catch (e) {
    return fail(e);
  }
}

export async function salvarGoogleOAuth(client_id: string, client_secret: string): Promise<Result> {
  const u = await requireUser(["dono"]);
  try {
    await brain("/api/integrations/google-oauth", u.id, { body: { client_id, client_secret } });
    revalidatePath("/integracoes");
    return { ok: true, msg: "Credenciais salvas. Agora clique em Conectar conta Google." };
  } catch (e) {
    return fail(e);
  }
}

export async function adicionarFonte(nome: string, descricao: string, url: string): Promise<Result> {
  const u = await requireUser(["dono"]);
  try {
    await brain("/api/integrations/postgres", u.id, { body: { nome, descricao, url } });
    revalidatePath("/integracoes");
    return { ok: true, msg: "Fonte conectada." };
  } catch (e) {
    return fail(e);
  }
}

export async function removerIntegracao(id: string) {
  const u = await requireUser(["dono"]);
  await sql`delete from integrations where id = ${id} and tenant_id = ${u.tenant_id}`;
  await sql`insert into audit_log (user_id, acao, alvo) values (${u.id}, 'integracao.remover', ${id})`;
  revalidatePath("/integracoes");
}

export async function whatsappStatus() {
  const u = await requireUser(["dono"]);
  try {
    return await brain<{ conectado: boolean; qr: string | null; numero: string | null }>("/api/whatsapp", u.id);
  } catch (e) {
    return { conectado: false, qr: null, numero: null, erro: (e as Error).message };
  }
}

export async function whatsappLogout(): Promise<Result> {
  const u = await requireUser(["dono"]);
  await brain("/api/whatsapp/logout", u.id, { method: "POST" });
  return { ok: true };
}

export async function whatsappTeste(): Promise<Result> {
  const u = await requireUser();
  try {
    await brain("/api/whatsapp/test", u.id, { method: "POST" });
    return { ok: true, msg: "Mensagem de teste enviada." };
  } catch (e) {
    return fail(e);
  }
}
