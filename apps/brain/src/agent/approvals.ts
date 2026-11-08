import { audit, db, json } from "../lib/db.js";
import { verifyPin } from "../lib/crypto.js";
import { log } from "../lib/log.js";
import { track, untrack } from "./panic.js";
import { TOOLS_BY_NAME } from "./tools/index.js";
import type { Canal, User } from "./types.js";

type Nivel = "confirmar" | "pin" | "pin_voz";

export async function createApproval(a: {
  user: User;
  taskId: string;
  stepId: string;
  nivel: Nivel;
  ferramenta: string;
  entrada: unknown;
  resumo: string;
}) {
  const sql = db();
  // Uma pendência por vez por usuário: novas substituem as antigas.
  await sql`update approvals set status = 'expirada' where user_id = ${a.user.id} and status = 'pendente'`;
  const [r] = await sql<{ id: string }[]>`
    insert into approvals (task_id, task_step_id, user_id, nivel, ferramenta, entrada, resumo)
    values (${a.taskId}, ${a.stepId}, ${a.user.id}, ${a.nivel}, ${a.ferramenta}, ${json(a.entrada)}, ${a.resumo})
    returning id`;
  return r!.id;
}

export function approvalInstructions(nivel: Nivel, resumo: string): string {
  const head = `🔐 *Confirmação necessária*\n${resumo}`;
  if (nivel === "confirmar") return `${head}\n\nResponda *SIM* para confirmar ou *NÃO* para cancelar.`;
  if (nivel === "pin") return `${head}\n\nResponda com seu *PIN de 6 dígitos* para confirmar, ou *NÃO* para cancelar.`;
  return `${head}\n\nEsta ação exige *PIN + voz*. Por enquanto, confirme pelo painel com o PIN (verificação de voz chega com o app de PC).`;
}

const SIM = /^(sim|s|confirmo|confirmar|confirma|pode|pode sim|ok|manda|envia|isso|yes|👍)[.! ]*$/i;
const NAO = /^(n[aã]o|n|cancela|cancelar|para|negativo|no|👎)[.! ]*$/i;

export async function pendingApproval(userId: string) {
  const sql = db();
  const [a] = await sql<{ id: string; nivel: Nivel; ferramenta: string; entrada: unknown; resumo: string; task_id: string; expira_em: Date }[]>`
    select id, nivel, ferramenta, entrada, resumo, task_id, expira_em from approvals
    where user_id = ${userId} and status = 'pendente' order by criado_em desc limit 1`;
  if (!a) return null;
  if (a.expira_em < new Date()) {
    await sql`update approvals set status = 'expirada' where id = ${a.id}`;
    return null;
  }
  return a;
}

/**
 * Se a mensagem do usuário for uma resposta a uma aprovação pendente, trata e devolve o texto de resposta.
 * Caso contrário devolve null e a mensagem segue para o cérebro.
 */
export async function handleApprovalReply(user: User, texto: string, canal: Canal): Promise<string | null> {
  const a = await pendingApproval(user.id);
  if (!a) return null;
  const t = texto.trim();
  const pin = t.replace(/\s/g, "").match(/^\d{6}$/)?.[0];

  if (NAO.test(t)) {
    await decide(a.id, user, false, canal);
    return "❌ Cancelado. Nada foi feito.";
  }
  if (a.nivel === "confirmar" && (SIM.test(t) || pin)) return execute(a.id, user, canal);
  if (a.nivel === "pin") {
    if (!pin) return SIM.test(t) ? "Esta ação exige o PIN de 6 dígitos. Envie o PIN ou *NÃO* para cancelar." : null;
    if (!user.pin_hash) return "Você ainda não cadastrou um PIN. Cadastre no painel (Usuários) e tente de novo.";
    if (!verifyPin(pin, user.pin_hash)) {
      await audit(user.id, "aprovacao.pin_incorreto", a.id);
      return "PIN incorreto. Tente de novo ou responda *NÃO* para cancelar.";
    }
    return execute(a.id, user, canal);
  }
  if (a.nivel === "pin_voz") return "Esta ação exige PIN + voz. Confirme pelo painel.";
  return null;
}

async function decide(id: string, user: User, aprovada: boolean, canal: Canal) {
  const sql = db();
  await sql`update approvals set status = ${aprovada ? "aprovada" : "recusada"}, respondido_em = now() where id = ${id}`;
  if (!aprovada) {
    await sql`update tasks set status = 'cancelada', fim = now() where id = (select task_id from approvals where id = ${id}) and status = 'aguardando_aprovacao'`;
  }
  await audit(user.id, aprovada ? "aprovacao.aprovada" : "aprovacao.recusada", id, null, { canal });
}

/** Executa a ação aprovada exatamente como foi mostrada ao usuário (sem passar de novo pelo modelo). */
export async function execute(id: string, user: User, canal: Canal): Promise<string> {
  const sql = db();
  const [a] = await sql<{ ferramenta: string; entrada: unknown; task_id: string; task_step_id: string | null; status: string }[]>`
    select ferramenta, entrada, task_id, task_step_id, status from approvals where id = ${id} and user_id = ${user.id}`;
  if (!a || a.status !== "pendente") return "Essa confirmação não está mais pendente.";
  await decide(id, user, true, canal);

  const tool = TOOLS_BY_NAME.get(a.ferramenta);
  if (!tool) return "Ferramenta não encontrada.";
  const parsed = tool.schema.safeParse(a.entrada);
  if (!parsed.success) return "Dados da ação inválidos.";

  const ac = track(user.id);
  const started = Date.now();
  try {
    const out = await tool.run(parsed.data, { user, taskId: a.task_id, canal, signal: ac.signal, notify: async () => {} });
    await sql`update approvals set status = 'executada', resultado = ${out} where id = ${id}`;
    await sql`insert into task_steps (task_id, ferramenta, entrada, saida, duracao_ms) values (${a.task_id}, ${a.ferramenta + " (aprovado)"}, ${json(a.entrada)}, ${out}, ${Date.now() - started})`;
    await sql`update tasks set status = 'concluida', fim = now() where id = ${a.task_id}`;
    await audit(user.id, `acao.${a.ferramenta}`, id, null, a.entrada);
    return `✅ ${out}`;
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err, id }, "falha ao executar ação aprovada");
    await sql`update approvals set status = 'erro', resultado = ${msg} where id = ${id}`;
    await sql`update tasks set status = 'erro', fim = now() where id = ${a.task_id}`;
    return `⚠️ Não consegui executar: ${msg}`;
  } finally {
    untrack(user.id, ac);
  }
}

export async function reject(id: string, user: User, canal: Canal) {
  await decide(id, user, false, canal);
}
