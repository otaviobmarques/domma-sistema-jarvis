import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../lib/config.js";
import { db, json } from "../lib/db.js";
import { log } from "../lib/log.js";
import { anthropic, costUsd } from "./llm.js";
import type { User } from "./types.js";

/**
 * Skills que aprendem (Fase 4).
 * - aprender: depois de uma tarefa de várias etapas bem-sucedida, o modelo rápido escreve um
 *   procedimento genérico e reutilizável (ou melhora um que já existe).
 * - buscar: pedidos parecidos recebem o procedimento no contexto, para ir direto ao caminho certo.
 * - avaliar: cada uso conta acerto/erro; skill que falha muito vai para revisão e sai de uso.
 */

export interface SkillAchada {
  id: string;
  nome: string;
  descricao: string | null;
  passos_json: { ferramenta: string | null; instrucao: string }[];
  ferramentas: string[];
}

/** Ferramentas que não contam como "etapa" de um procedimento. */
const IGNORAR = new Set(["memoria_buscar", "memoria_salvar", "memoria_esquecer"]);

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export async function buscarSkills(user: User, pedido: string, limite = 3): Promise<SkillAchada[]> {
  if (pedido.trim().length < 8) return [];
  const p = normalizar(pedido).slice(0, 400);
  return db()<SkillAchada[]>`
    select id, nome, descricao, passos_json, ferramentas from (
      select *, greatest(similarity(busca, ${p}), word_similarity(${p}, busca)) as score
      from skills
      where tenant_id = ${user.tenant_id} and (user_id = ${user.id} or user_id is null) and status = 'ativa'
    ) s
    where score > 0.32
    order by score desc, usos desc
    limit ${limite}`;
}

export function skillsNoContexto(skills: SkillAchada[]): string {
  if (!skills.length) return "";
  return [
    "Procedimentos que já funcionaram para pedidos parecidos (skills aprendidas). Use se servirem; adapte ao pedido atual e ignore se não se aplicarem:",
    ...skills.map(
      (s) =>
        `### ${s.nome}\n${s.descricao ?? ""}\n${s.passos_json.map((p, i) => `${i + 1}. ${p.ferramenta ? `[${p.ferramenta}] ` : ""}${p.instrucao}`).join("\n")}`,
    ),
  ].join("\n\n");
}

/** Conta uso e sucesso das skills que estavam no contexto e foram de fato seguidas. */
export async function registrarUso(taskId: string, ofertadas: SkillAchada[], sucesso: boolean) {
  if (!ofertadas.length) return;
  const sql = db();
  const usadas = new Set(
    (await sql<{ ferramenta: string }[]>`select ferramenta from task_steps where task_id = ${taskId}`).map((r) => r.ferramenta),
  );
  for (const s of ofertadas) {
    const etapas = s.ferramentas.filter((f) => !IGNORAR.has(f));
    const seguidas = etapas.filter((f) => usadas.has(f)).length;
    if (!etapas.length || seguidas / etapas.length < 0.5) continue;
    await avaliar(s.id, sucesso);
  }
}

/** Média móvel do sucesso. Com 3+ usos e menos de 60% de acerto, a skill vai para revisão. */
export async function avaliar(skillId: string, sucesso: boolean) {
  await db()`
    update skills set
      usos = usos + 1,
      ultimo_uso = now(),
      taxa_sucesso = taxa_sucesso * 0.7 + ${sucesso ? 1 : 0} * 0.3,
      status = case when usos + 1 >= 3 and taxa_sucesso * 0.7 + ${sucesso ? 1 : 0} * 0.3 < 0.6 then 'precisa_revisao' else status end
    where id = ${skillId}`;
}

/** 👎 numa tarefa: as skills oferecidas nela contam como falha. */
export async function feedbackNegativo(taskId: string) {
  const [t] = await db()<{ skills_ofertadas: string[] }[]>`select skills_ofertadas from tasks where id = ${taskId}`;
  for (const id of t?.skills_ofertadas ?? []) await avaliar(id, false);
}

const Aprendizado = z.object({
  acao: z.enum(["nenhuma", "nova", "melhorar"]).describe("nenhuma = tarefa pontual, não vale guardar"),
  melhorar_id: z.string().nullable().describe("id da skill existente, quando acao = melhorar"),
  nome: z.string().describe("Título curto no infinitivo, ex.: 'Montar relatório semanal de campanhas'"),
  descricao: z.string().describe("Quando usar, em uma frase"),
  gatilhos: z.array(z.string()).describe("3 a 5 jeitos diferentes de o usuário pedir isso"),
  passos: z.array(z.object({ ferramenta: z.string().nullable(), instrucao: z.string() })).describe("Etapas genéricas, na ordem"),
});

/**
 * Depois de uma tarefa concluída: se ela teve 2+ etapas com ferramentas e nenhuma falhou,
 * tenta transformar o caminho em uma skill reutilizável.
 */
export async function aprenderSkill(user: User, taskId: string, pedido: string, resposta: string) {
  const sql = db();
  const passos = (
    await sql<{ ferramenta: string; entrada: unknown; erro: string | null; saida: string | null }[]>`
      select ferramenta, entrada, erro, left(saida, 300) as saida from task_steps where task_id = ${taskId} order by criado_em`
  ).filter((p) => !IGNORAR.has(p.ferramenta));
  if (passos.length < 2) return null;
  if (passos.some((p) => p.erro || p.saida === "AGUARDANDO_CONFIRMACAO")) return null;

  const parecidas = await sql<{ id: string; nome: string; descricao: string | null; passos_json: unknown }[]>`
    select id, nome, descricao, passos_json from skills
    where tenant_id = ${user.tenant_id} and (user_id = ${user.id} or user_id is null)
    order by greatest(similarity(busca, ${normalizar(pedido).slice(0, 400)}), word_similarity(${normalizar(pedido).slice(0, 400)}, busca)) desc
    limit 3`;

  const res = await anthropic.messages.parse({
    model: config.modelFast,
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(Aprendizado) },
    system: `Você transforma tarefas bem-sucedidas de um assistente executivo em procedimentos reutilizáveis (skills).
Guarde só o que tende a se repetir (relatórios, rotinas de trabalho, sequências de consultas, fluxos em apps). Tarefas pontuais ou triviais → acao "nenhuma".
Escreva o procedimento de forma GENÉRICA: troque valores específicos (datas, nomes, números, textos de e-mail) por descrições ("o período pedido", "o contato informado").
Nunca inclua senhas, tokens, PINs, dados pessoais sensíveis ou conteúdo de mensagens.
Se uma skill existente cobre o mesmo pedido, use acao "melhorar" com o id dela e escreva a versão melhorada completa.
Use só nomes de ferramentas que aparecem nas etapas.`,
    messages: [
      {
        role: "user",
        content: `Skills existentes parecidas:\n${parecidas.map((s) => `- id ${s.id}: ${s.nome} — ${s.descricao ?? ""}`).join("\n") || "(nenhuma)"}

<tarefa>
PEDIDO: ${pedido.slice(0, 2000)}
ETAPAS:
${passos.map((p, i) => `${i + 1}. ${p.ferramenta} ${JSON.stringify(p.entrada).slice(0, 300)}`).join("\n")}
RESPOSTA FINAL: ${resposta.slice(0, 1500)}
</tarefa>`,
      },
    ],
  });
  await sql`update tasks set custo = custo + ${costUsd(config.modelFast, res.usage as any)} where id = ${taskId}`;

  const a = res.parsed_output;
  if (!a || a.acao === "nenhuma" || a.passos.length < 2) return null;
  const ferramentas = [...new Set(a.passos.map((p) => p.ferramenta).filter((f): f is string => !!f && passos.some((s) => s.ferramenta === f)))];
  const busca = normalizar([a.nome, a.descricao, ...a.gatilhos].join(" | "));
  const passosLimpos = a.passos.slice(0, 15).map((p) => ({ ferramenta: p.ferramenta && ferramentas.includes(p.ferramenta) ? p.ferramenta : null, instrucao: p.instrucao.slice(0, 400) }));

  if (a.acao === "melhorar" && a.melhorar_id && parecidas.some((s) => s.id === a.melhorar_id)) {
    await sql`
      update skills set nome = ${a.nome.slice(0, 120)}, descricao = ${a.descricao.slice(0, 400)}, gatilhos = ${a.gatilhos.slice(0, 6)},
        passos_json = ${json(passosLimpos)}, ferramentas = ${ferramentas}, busca = ${busca}, versao = versao + 1,
        status = 'ativa', origem_task_id = ${taskId}, atualizado_em = now()
      where id = ${a.melhorar_id}`;
    log.info({ skill: a.nome, taskId }, "skill melhorada");
    return a.melhorar_id;
  }
  const [nova] = await sql<{ id: string }[]>`
    insert into skills (tenant_id, user_id, nome, descricao, gatilhos, passos_json, ferramentas, busca, origem_task_id, usos)
    values (${user.tenant_id}, ${user.id}, ${a.nome.slice(0, 120)}, ${a.descricao.slice(0, 400)}, ${a.gatilhos.slice(0, 6)},
            ${json(passosLimpos)}, ${ferramentas}, ${busca}, ${taskId}, 1)
    on conflict do nothing
    returning id`;
  if (nova) log.info({ skill: a.nome, taskId }, "skill aprendida");
  return nova?.id ?? null;
}
