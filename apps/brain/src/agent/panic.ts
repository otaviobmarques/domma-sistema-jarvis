import { audit, db } from "../lib/db.js";
import { cancelarFila } from "../lib/devices.js";
import { invalidarUsuario } from "../lib/users.js";

/** Tarefas em execução por usuário, para o botão de pânico interromper na hora. */
const running = new Map<string, Set<AbortController>>();

export function track(userId: string): AbortController {
  const ac = new AbortController();
  let set = running.get(userId);
  if (!set) running.set(userId, (set = new Set()));
  set.add(ac);
  return ac;
}

export function untrack(userId: string, ac: AbortController) {
  running.get(userId)?.delete(ac);
}

export function runningCount(userId?: string) {
  if (userId) return running.get(userId)?.size ?? 0;
  let n = 0;
  for (const s of running.values()) n += s.size;
  return n;
}

/**
 * /parar: interrompe tudo do usuário (ou de todo o tenant, se for o dono com global=true),
 * cancela aprovações pendentes e tarefas na fila dos dispositivos.
 */
export async function panic(userId: string, opts: { global?: boolean; pausar?: boolean } = {}) {
  const sql = db();
  let users = [userId];
  if (opts.global) {
    const rows = await sql<{ id: string }[]>`select u2.id from users u1 join users u2 on u2.tenant_id = u1.tenant_id where u1.id = ${userId}`;
    users = rows.map((r) => r.id);
  }
  let aborted = 0;
  for (const u of users) {
    for (const ac of running.get(u) ?? []) {
      ac.abort(new Error("Interrompido pelo botão de pânico"));
      aborted++;
    }
    running.delete(u);
  }
  await sql`update approvals set status = 'recusada', respondido_em = now() where user_id in ${sql(users)} and status = 'pendente'`;
  await sql`update tasks set status = 'cancelada', fim = now() where user_id in ${sql(users)} and status in ('executando','aguardando_aprovacao')`;
  await sql`update task_queue set status = 'cancelada' where status in ('pendente','entregue','executando')
            and task_id in (select id from tasks where user_id in ${sql(users)})`;
  const devs = await sql<{ id: string }[]>`select id from devices where user_id in ${sql(users)} and ativo`;
  cancelarFila(devs.map((d) => d.id));
  if (opts.pausar) await sql`update users set pausado = true where id in ${sql(users)}`;
  invalidarUsuario();
  await audit(userId, "panico", opts.global ? "tenant" : "usuario", null, { aborted, pausar: !!opts.pausar });
  return aborted;
}
