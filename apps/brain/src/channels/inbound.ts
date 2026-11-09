import { handleApprovalReply } from "../agent/approvals.js";
import { runTask, type Anexo } from "../agent/orchestrator.js";
import { nomeAssistente } from "../agent/prompt.js";
import { panic, runningCount } from "../agent/panic.js";
import type { User } from "../agent/types.js";
import { audit, db } from "../lib/db.js";
import { log } from "../lib/log.js";
import { userByWhatsApp } from "../lib/users.js";
import { transcribe } from "./stt.js";
import { sendTyping, sendWhatsApp, type InboundMessage } from "./whatsapp.js";

/** Fila por usuário: mensagens do mesmo usuário são tratadas em ordem. */
const queues = new Map<string, Promise<void>>();

function enqueue(userId: string, job: () => Promise<void>) {
  const prev = queues.get(userId) ?? Promise.resolve();
  const next = prev.then(job, job).finally(() => {
    if (queues.get(userId) === next) queues.delete(userId);
  });
  queues.set(userId, next);
}

const AJUDA = `*Comandos rápidos*
/parar — interrompe tudo agora (botão de pânico)
/retomar — volta a aceitar ações depois de um /parar
/status — tarefas em andamento e pendências
/rotinas — suas rotinas agendadas
/esquece <assunto> — apaga da memória
/ajuda — esta lista

Fora isso, é só falar comigo por texto ou áudio.`;

async function command(user: User, texto: string, reply: (t: string) => Promise<void>): Promise<boolean> {
  const t = texto.trim();
  if (!t.startsWith("/")) return false;
  const [cmd, ...rest] = t.split(/\s+/);
  const arg = rest.join(" ");
  const sql = db();
  switch (cmd!.toLowerCase()) {
    case "/parar":
    case "/stop": {
      const n = await panic(user.id, { global: user.perfil === "dono" && arg === "tudo", pausar: true });
      await reply(`⛔ Parei tudo${n ? ` (${n} tarefa(s) interrompida(s))` : ""}. Pendências canceladas. Mande /retomar quando quiser voltar.`);
      return true;
    }
    case "/retomar": {
      await sql`update users set pausado = false where id = ${user.id}`;
      await audit(user.id, "retomar");
      await reply("▶️ Pronto, voltei a funcionar.");
      return true;
    }
    case "/status": {
      const tasks = await sql<{ pedido: string; status: string; inicio: Date }[]>`
        select pedido, status, inicio from tasks where user_id = ${user.id} and status in ('executando','aguardando_aprovacao') order by inicio desc limit 10`;
      const pend = await sql<{ resumo: string }[]>`select resumo from approvals where user_id = ${user.id} and status = 'pendente'`;
      await reply(
        [
          `*Status*${user.pausado ? " (⏸️ pausado)" : ""}`,
          `Em execução agora: ${runningCount(user.id)}`,
          tasks.length ? tasks.map((x) => `• ${x.status === "executando" ? "⏳" : "🔐"} ${x.pedido.slice(0, 80)}`).join("\n") : "Nenhuma tarefa em andamento.",
          pend.length ? `\nAguardando sua confirmação:\n${pend.map((p) => `• ${p.resumo.split("\n")[0]}`).join("\n")}` : "",
        ].join("\n"),
      );
      return true;
    }
    case "/rotinas": {
      const rows = await sql<{ nome: string; cron: string; ativa: boolean }[]>`select nome, cron, ativa from routines where user_id = ${user.id} order by criado_em`;
      await reply(rows.length ? `*Rotinas*\n${rows.map((r) => `${r.ativa ? "✅" : "⏸️"} ${r.nome} — ${r.cron}`).join("\n")}` : "Você ainda não tem rotinas. Ex.: \"todo dia às 8h me manda o resumo dos e-mails\".");
      return true;
    }
    case "/esquece":
    case "/esquecer": {
      if (!arg) {
        await reply("Diga o que esquecer: /esquece <assunto>");
        return true;
      }
      return false; // segue para o cérebro, que busca e apaga com memoria_esquecer
    }
    case "/ajuda":
    case "/help":
      await reply(AJUDA);
      return true;
    default:
      return false;
  }
}

export async function handleWhatsApp(m: InboundMessage) {
  const encontrado = await userByWhatsApp(m.numero);
  // pela API oficial, só atende quem é da empresa dona do número
  const user = encontrado && (!m.tenantId || encontrado.tenant_id === m.tenantId) ? encontrado : null;
  if (!user) {
    // Só obedece números autorizados. O resto é ignorado e registrado.
    await db()`insert into blocked_attempts (canal, remetente, conteudo) values ('whatsapp', ${m.numero}, ${m.texto.slice(0, 500)})`;
    log.info({ numero: m.numero }, "mensagem de número não cadastrado ignorada");
    return;
  }
  const reply = m.responder ?? ((t: string) => sendWhatsApp(m.jid, t));

  // /parar fura a fila: tem que agir na hora
  if (/^\/(parar|stop)\b/i.test(m.texto.trim())) {
    await command(user, m.texto, reply);
    return;
  }

  enqueue(user.id, async () => {
    const fresh = (await userByWhatsApp(m.numero)) ?? user;
    let texto = m.texto;
    const anexos: Anexo[] = [];

    if (m.audio) {
      try {
        texto = (await transcribe(m.audio.buffer, m.audio.mime, nomeAssistente(fresh))) + (texto ? `\n${texto}` : "");
        if (!texto.trim()) return void (await reply("Não consegui entender o áudio. Pode repetir?"));
      } catch (err) {
        return void (await reply(`🎙️ ${(err as Error).message}`));
      }
    }
    if (m.imagem) anexos.push({ tipo: "imagem", mime: m.imagem.mime, base64: m.imagem.buffer.toString("base64") });
    if (m.documento) {
      if (m.documento.mime === "application/pdf") anexos.push({ tipo: "pdf", base64: m.documento.buffer.toString("base64"), nome: m.documento.nome });
      else if (/^text\/|json|csv|xml/.test(m.documento.mime)) anexos.push({ tipo: "texto", nome: m.documento.nome, conteudo: m.documento.buffer.toString("utf8") });
      else texto += `\n(O usuário enviou o arquivo "${m.documento.nome}" do tipo ${m.documento.mime}, que ainda não sei ler.)`;
    }
    if (m.localizacao) texto += `\n(Localização enviada: ${m.localizacao.lat}, ${m.localizacao.lng}${m.localizacao.nome ? ` — ${m.localizacao.nome}` : ""})`;
    if (!texto.trim() && !anexos.length) return;

    if (await command(fresh, texto, reply)) return;

    const approvalReply = await handleApprovalReply(fresh, texto, "whatsapp");
    if (approvalReply) return void (await reply(approvalReply));

    await (m.digitando ? m.digitando() : sendTyping(m.jid)).catch(() => {});
    // Se a tarefa demorar, responde "Entendi, fazendo..." em até ~2 s
    let done = false;
    let sentAck = false;
    const ack = setTimeout(() => {
      if (!done) {
        sentAck = true;
        void reply("Entendi, fazendo... ⏳").catch(() => {});
      }
    }, 2500);
    try {
      const r = await runTask({
        user: fresh,
        canal: "whatsapp",
        texto: m.audio ? `🎙️ (áudio transcrito) ${texto}` : texto,
        anexos,
        notify: async (t) => {
          if (!sentAck && t.length < 400) {
            sentAck = true;
            await reply(t);
          }
        },
      });
      done = true;
      await reply(r.resposta);
    } finally {
      done = true;
      clearTimeout(ack);
    }
  });
}
