import cron, { type ScheduledTask } from "node-cron";
import { runTask } from "./agent/orchestrator.js";
import { anthropic, costUsd } from "./agent/llm.js";
import { sendWhatsApp, whatsappStatus } from "./channels/whatsapp.js";
import { config } from "./lib/config.js";
import { db, json } from "./lib/db.js";
import { log } from "./lib/log.js";
import { inQuietHours, nowInTz } from "./lib/time.js";
import { userById } from "./lib/users.js";

const jobs = new Map<string, ScheduledTask>();
const systemJobs: ScheduledTask[] = [];

async function deliver(userId: string, texto: string, critica: boolean) {
  const user = await userById(userId);
  if (!user?.whatsapp) return;
  if (!critica && inQuietHours(user.horario_silencio_inicio, user.horario_silencio_fim)) {
    log.info({ userId }, "horário de silêncio: resultado salvo só no painel");
    return;
  }
  if (!whatsappStatus().conectado) {
    log.warn("WhatsApp desconectado: rotina não entregue");
    return;
  }
  await sendWhatsApp(user.whatsapp, texto);
}

export async function runRoutine(id: string) {
  const sql = db();
  const [r] = await sql<{ id: string; user_id: string; nome: string; instrucao: string; critica: boolean; canal_saida: string; ativa: boolean }[]>`
    select id, user_id, nome, instrucao, critica, canal_saida, ativa from routines where id = ${id}`;
  if (!r) return null;
  const user = await userById(r.user_id);
  if (!user || !user.ativo) return null;
  await sql`update routines set ultima_execucao = now() where id = ${id}`;
  const res = await runTask({
    user,
    canal: "rotina",
    novaConversa: true,
    texto: `[Rotina agendada "${r.nome}"] ${r.instrucao}\n\nEsta é uma execução automática: faça o trabalho e entregue o resultado final pronto para ler no WhatsApp. Destaque exceções e alertas no topo.`,
  });
  if (r.canal_saida === "whatsapp") await deliver(r.user_id, `🗓️ *${r.nome}*\n\n${res.resposta}`, r.critica);
  return res;
}

export async function reloadRoutines() {
  const sql = db();
  for (const j of jobs.values()) j.stop();
  jobs.clear();
  const rows = await sql<{ id: string; cron: string; nome: string }[]>`select id, cron, nome from routines where ativa and cron is not null`;
  for (const r of rows) {
    if (!cron.validate(r.cron)) {
      log.warn({ id: r.id, cron: r.cron }, "cron inválido ignorado");
      continue;
    }
    jobs.set(
      r.id,
      cron.schedule(r.cron, () => void runRoutine(r.id).catch((err) => log.error({ err, id: r.id }, "rotina falhou")), {
        timezone: config.timezone,
        name: r.nome,
      }),
    );
  }
  log.info({ total: jobs.size }, "rotinas carregadas");
}

/** Diário automático (seção 11.5): todo fim de dia, resumo do que foi feito/decidido/pendente. */
async function dailyJournal() {
  const sql = db();
  const hoje = nowInTz().date;
  const users = await sql<{ id: string; nome: string }[]>`
    select distinct u.id, u.nome from users u join tasks t on t.user_id = u.id
    where u.ativo and (t.inicio at time zone 'America/Sao_Paulo')::date = ${hoje}::date`;
  for (const u of users) {
    const tasks = await sql<{ pedido: string; resposta: string | null; status: string }[]>`
      select pedido, resposta, status from tasks
      where user_id = ${u.id} and (inicio at time zone 'America/Sao_Paulo')::date = ${hoje}::date and canal <> 'rotina'
      order by inicio limit 80`;
    if (!tasks.length) continue;
    const res = await anthropic.messages.create({
      model: config.modelFast,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system:
        'Gere o diário do dia de um executivo a partir das tarefas que ele pediu ao assistente. Responda APENAS um JSON: {"resumo": "texto curto por empresa", "decisoes": ["..."], "pendencias": ["..."]}.',
      messages: [{ role: "user", content: tasks.map((t) => `- [${t.status}] ${t.pedido}\n  → ${(t.resposta ?? "").slice(0, 400)}`).join("\n") }],
    });
    const txt = res.content.find((b) => b.type === "text")?.text ?? "{}";
    let parsed: { resumo?: string; decisoes?: string[]; pendencias?: string[] } = {};
    try {
      parsed = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
    } catch {
      parsed = { resumo: txt };
    }
    await sql`
      insert into daily_journal (user_id, data, resumo, decisoes, pendencias)
      values (${u.id}, ${hoje}, ${parsed.resumo ?? ""}, ${json(parsed.decisoes ?? [])}, ${json(parsed.pendencias ?? [])})
      on conflict (user_id, data) do update set resumo = excluded.resumo, decisoes = excluded.decisoes, pendencias = excluded.pendencias`;
    await sql`
      insert into memories (user_id, tenant_id, camada, tipo, conteudo, origem, confianca)
      select ${u.id}, tenant_id, 'episodio', 'episodio', ${`Diário de ${hoje}: ${parsed.resumo ?? ""} Pendências: ${(parsed.pendencias ?? []).join("; ")}`},
             ${json({ canal: "diario", quando: new Date().toISOString() })}, 0.9
      from users where id = ${u.id}`;
    log.info({ user: u.nome, custo: costUsd(config.modelFast, res.usage as any) }, "diário gerado");
  }
}

/** Manutenção semanal (seção 11.2): arquiva memórias substituídas antigas e expira aprovações. */
async function weeklyMaintenance() {
  const sql = db();
  await sql`delete from memories where substituida_por is not null and atualizado_em < now() - interval '180 days'`;
  await sql`update approvals set status = 'expirada' where status = 'pendente' and expira_em < now()`;
  await sql`update tasks set status = 'cancelada', fim = now() where status = 'aguardando_aprovacao' and inicio < now() - interval '1 day'`;
}

export async function startScheduler() {
  await reloadRoutines();
  systemJobs.push(
    cron.schedule("30 23 * * *", () => void dailyJournal().catch((err) => log.error({ err }, "diário falhou")), { timezone: config.timezone, name: "diario" }),
    cron.schedule("0 4 * * 0", () => void weeklyMaintenance().catch((err) => log.error({ err }, "manutenção falhou")), { timezone: config.timezone, name: "manutencao" }),
    cron.schedule("*/5 * * * *", () => void db()`update approvals set status = 'expirada' where status = 'pendente' and expira_em < now()`.catch(() => {}), { name: "expira" }),
  );
}

export function stopScheduler() {
  for (const j of jobs.values()) j.stop();
  for (const j of systemJobs) j.stop();
}
