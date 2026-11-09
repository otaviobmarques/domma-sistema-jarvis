import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../lib/config.js";
import { franquiaEstourada, situacaoTenant } from "../lib/plataforma.js";
import { db, json } from "../lib/db.js";
import { log } from "../lib/log.js";
import { createApproval, approvalInstructions } from "./approvals.js";
import { costUsd, createMessage, rotear, streamMessage } from "./llm.js";
import { extractMemories } from "./memoryExtract.js";
import { track, untrack } from "./panic.js";
import { decidir } from "./permissions.js";
import { aprenderSkill, buscarSkills, registrarUso, skillsNoContexto } from "./skills.js";
import { dynamicContext, STABLE_SYSTEM } from "./prompt.js";
import { ALL_TOOLS, TOOLS_BY_NAME } from "./tools/index.js";
import type { Canal, ToolContext, ToolDef, User } from "./types.js";

export type Anexo =
  | { tipo: "imagem"; mime: string; base64: string }
  | { tipo: "pdf"; base64: string; nome?: string }
  | { tipo: "texto"; nome?: string; conteudo: string };

export interface RunInput {
  user: User;
  canal: Canal;
  texto: string;
  anexos?: Anexo[];
  /** Mensagem intermediária (ex.: "Entendi, fazendo...") */
  notify?: (t: string) => Promise<void>;
  /** Para rotinas: não reaproveita a conversa anterior */
  novaConversa?: boolean;
  /** App de PC que fez o pedido */
  deviceId?: string | null;
  /** Streaming: recebe o texto da resposta enquanto é gerado (voz começa a falar antes). */
  onTexto?: (delta: string) => void;
}

export interface RunResult {
  taskId: string;
  resposta: string;
  aguardandoAprovacao: boolean;
  custoUsd: number;
}

const HISTORY_LIMIT = 24;
const CONVERSATION_GAP_HOURS = 6;

const toolSchemaCache = new Map<string, Anthropic.Beta.BetaTool["input_schema"]>();
function inputSchema(t: ToolDef): Anthropic.Beta.BetaTool["input_schema"] {
  let s = toolSchemaCache.get(t.name);
  if (!s) {
    const js = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    delete js.$schema;
    s = js as Anthropic.Beta.BetaTool["input_schema"];
    toolSchemaCache.set(t.name, s);
  }
  return s;
}

const cacheConversa = new Map<string, { id: string; em: number }>();

async function getConversation(user: User, canal: Canal, nova: boolean) {
  const chave = `${user.id}:${canal}`;
  const c = cacheConversa.get(chave);
  if (!nova && c && Date.now() - c.em < CONVERSATION_GAP_HOURS * 3600_000) {
    c.em = Date.now();
    return c.id;
  }
  const id = await getConversationBanco(user, canal, nova);
  if (!nova) cacheConversa.set(chave, { id, em: Date.now() });
  return id;
}

async function getConversationBanco(user: User, canal: Canal, nova: boolean) {
  const sql = db();
  if (!nova) {
    const [c] = await sql<{ id: string }[]>`
      select id from conversations
      where user_id = ${user.id} and canal = ${canal} and not encerrada
        and ultima_msg_em > now() - make_interval(hours => ${CONVERSATION_GAP_HOURS})
      order by ultima_msg_em desc limit 1`;
    if (c) return c.id;
  }
  const [c] = await sql<{ id: string }[]>`insert into conversations (user_id, canal) values (${user.id}, ${canal}) returning id`;
  return c!.id;
}

async function history(conversationId: string): Promise<Anthropic.Beta.BetaMessageParam[]> {
  const sql = db();
  const rows = await sql<{ autor: "user" | "assistant"; conteudo: string }[]>`
    select autor, conteudo from (
      select autor, conteudo, criado_em from messages
      where conversation_id = ${conversationId} and autor in ('user','assistant')
      order by criado_em desc limit ${HISTORY_LIMIT}
    ) t order by criado_em`;
  const msgs: Anthropic.Beta.BetaMessageParam[] = [];
  for (const r of rows) {
    const last = msgs[msgs.length - 1];
    if (last && last.role === r.autor) last.content = `${last.content as string}\n\n${r.conteudo}`;
    else msgs.push({ role: r.autor, content: r.conteudo });
  }
  while (msgs[0]?.role === "assistant") msgs.shift();
  return msgs;
}

function userContent(texto: string, anexos: Anexo[] = []): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const a of anexos) {
    if (a.tipo === "imagem") {
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mime as "image/jpeg", data: a.base64 } });
    } else if (a.tipo === "pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 }, title: a.nome });
    } else {
      blocks.push({ type: "text", text: `<anexo nome="${a.nome ?? "arquivo"}">\n${a.conteudo.slice(0, 50000)}\n</anexo>` });
    }
  }
  blocks.push({ type: "text", text: texto || "(sem texto)" });
  return blocks;
}

export async function monthlySpendUsd(userId: string): Promise<number> {
  const sql = db();
  const [r] = await sql<{ total: string | null }[]>`
    select sum(custo) as total from tasks where user_id = ${userId} and inicio >= date_trunc('month', now() at time zone 'America/Sao_Paulo')`;
  return Number(r?.total ?? 0);
}

export async function runTask(input: RunInput): Promise<RunResult> {
  const { user, canal } = input;
  const sql = db();

  if (user.pausado) {
    return { taskId: "", resposta: "⏸️ O Tavinho está pausado para você (botão de pânico). Reative pelo painel ou mande /retomar.", aguardandoAprovacao: false, custoUsd: 0 };
  }
  // Assinatura do cliente (teste, atraso, bloqueio) e franquia de IA do mês
  const sit = await situacaoTenant(user.tenant_id);
  if (!sit.liberado) return { taskId: "", resposta: `⚠️ ${sit.motivo}`, aguardandoAprovacao: false, custoUsd: 0 };
  if (!sit.plataforma) {
    const f = await franquiaEstourada(user.tenant_id);
    if (f.estourou) {
      return { taskId: "", resposta: "⚠️ A franquia de uso de IA da sua empresa neste mês acabou. O responsável pela conta pode falar com a Domma para ampliar.", aguardandoAprovacao: false, custoUsd: 0 };
    }
  }
  const limite = Number(user.limite_mensal_usd ?? 0);
  if (limite > 0 && (await monthlySpendUsd(user.id)) >= limite) {
    return { taskId: "", resposta: `⚠️ Limite mensal de gastos com IA atingido (US$ ${limite.toFixed(2)}). Ajuste no painel para continuar.`, aguardandoAprovacao: false, custoUsd: 0 };
  }

  const tInicio = Date.now();
  // Tudo o que não depende entre si roda em paralelo (o banco está em outra região: cada ida conta).
  const ctxPromise = dynamicContext(user, canal, input.texto);
  const skillsPromise = buscarSkills(user, input.texto).catch((err) => {
    log.warn({ err }, "busca de skills falhou");
    return [];
  });
  const rotaPromise = rotear(input.texto, (input.anexos?.length ?? 0) > 0, canal === "voz");
  const conversationId = await getConversation(user, canal, !!input.novaConversa);
  const anexosMeta = (input.anexos ?? []).map((a) => ({ tipo: a.tipo, nome: "nome" in a ? a.nome : undefined }));
  const [hist, rota] = await Promise.all([history(conversationId), rotaPromise]);
  const taskId = randomUUID();
  // Os registros são gravados enquanto o modelo já está respondendo; esperamos antes de rodar ferramentas.
  const registros = Promise.all([
    sql`insert into messages (conversation_id, autor, conteudo, anexos) values (${conversationId}, 'user', ${input.texto}, ${json(anexosMeta)})`,
    sql`insert into tasks (id, user_id, conversation_id, canal, pedido, modelo, executor)
        values (${taskId}, ${user.id}, ${conversationId}, ${canal}, ${input.texto}, ${rota.model}, 'nuvem')`,
  ]);
  registros.catch(() => {});

  const ac = track(user.id);
  let custo = 0;
  let tokIn = 0;
  let tokOut = 0;
  const contexto = await ctxPromise;
  const ctx: ToolContext = {
    user,
    taskId,
    canal,
    signal: ac.signal,
    notify: input.notify ?? (async () => {}),
    deviceId: input.deviceId ?? null,
    contexto,
    addCusto: (usd, i, o) => {
      custo += usd;
      tokIn += i;
      tokOut += o;
    },
  };

  // Ferramentas que o perfil pode usar (as negadas nem aparecem para o modelo)
  const tools = ALL_TOOLS.filter((t) => t.perfis.includes(user.perfil));
  const apiTools: Anthropic.Beta.BetaToolUnion[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: inputSchema(t),
  }));
  apiTools.push(
    rota.model.includes("haiku")
      ? { type: "web_search_20250305", name: "web_search", max_uses: 5 }
      : { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  );

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: STABLE_SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: contexto },
  ];
  const skills = await skillsPromise;
  if (skills.length) system.push({ type: "text", text: skillsNoContexto(skills) });
  const messages: Anthropic.Beta.BetaMessageParam[] = [...hist, { role: "user", content: userContent(input.texto, input.anexos) }];

  let resposta = "";
  let pendente: { id: string; nivel: "confirmar" | "pin" | "pin_voz"; resumo: string } | null = null;
  let status: "concluida" | "erro" | "cancelada" | "aguardando_aprovacao" = "concluida";
  const t0 = Date.now();
  const chamadas: { modelo: string; ms: number; primeiro_ms?: number | null; entrada: number; cache: number; saida: number }[] = [];

  try {
    for (let step = 0; step < config.maxAgentSteps; step++) {
      const tc = Date.now();
      const params = {
        model: rota.model,
        max_tokens: canal === "voz" ? 2000 : 16000,
        output_config: { effort: rota.effort },
        // conversa por voz no modelo rápido: sem raciocínio estendido, para a primeira palavra sair logo
        ...(canal === "voz" && rota.model === config.modelFast ? { thinking: { type: "disabled" as const } } : {}),
        system,
        tools: apiTools,
        messages,
      };
      let primeiroMs: number | null = null;
      const res = input.onTexto
        ? await streamMessage(
            params,
            (d) => {
              primeiroMs ??= Date.now() - tc;
              input.onTexto!(d);
            },
            ac.signal,
          )
        : await createMessage(params, ac.signal);
      chamadas.push({
        modelo: res.model,
        ms: Date.now() - tc,
        primeiro_ms: primeiroMs,
        entrada: res.usage.input_tokens ?? 0,
        cache: res.usage.cache_read_input_tokens ?? 0,
        saida: res.usage.output_tokens ?? 0,
      });
      custo += costUsd(res.model, res.usage);
      tokIn += (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
      tokOut += res.usage.output_tokens ?? 0;

      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();

      if (res.stop_reason === "refusal") {
        resposta = text || "Não posso ajudar com esse pedido.";
        break;
      }
      if (res.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
        resposta = text;
        if (res.stop_reason === "max_tokens") resposta += "\n\n(resposta cortada por tamanho)";
        break;
      }
      if (text && step === 0) void ctx.notify(text).catch(() => {});
      if (text && input.onTexto) input.onTexto("\n");

      messages.push({ role: "assistant", content: res.content });
      await registros;
      const results = await Promise.all(
        toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const out = await executeTool(tu, ctx, (p) => (pendente ??= p));
          return { type: "tool_result", tool_use_id: tu.id, content: out.content, is_error: out.isError || undefined };
        }),
      );
      messages.push({ role: "user", content: results });
      if (step === config.maxAgentSteps - 1) resposta = text || "Atingi o limite de passos para esta tarefa. Me diga como prefere seguir.";
    }
  } catch (err) {
    if (ac.signal.aborted) {
      status = "cancelada";
      resposta = "⛔ Tarefa interrompida.";
    } else {
      status = "erro";
      log.error({ err, taskId }, "erro na tarefa");
      resposta =
        err instanceof Anthropic.RateLimitError
          ? "Estou recebendo pedidos demais agora. Tente de novo em um minuto."
          : err instanceof Anthropic.AuthenticationError
            ? "A chave da API de IA não está configurada ou é inválida (ANTHROPIC_API_KEY)."
            : `Tive um erro ao executar: ${(err as Error).message}`;
    }
  } finally {
    untrack(user.id, ac);
  }

  // `pendente` é atribuído dentro de um callback; o TS não enxerga isso no fluxo
  const pend = pendente as { id: string; nivel: "confirmar" | "pin" | "pin_voz"; resumo: string } | null;
  if (pend && status === "concluida") {
    status = "aguardando_aprovacao";
    resposta = `${resposta || "Preciso da sua confirmação."}\n\n${approvalInstructions(pend.nivel, pend.resumo)}`;
  }
  if (!resposta) resposta = "Feito.";

  await registros.catch(() => {});
  await sql`
    update tasks set status = ${status}, resposta = ${resposta}, fim = ${status === "aguardando_aprovacao" ? null : new Date()},
      tokens_entrada = ${tokIn}, tokens_saida = ${tokOut}, custo = ${custo},
      plano_json = ${json({ rota, preparo_ms: t0 - tInicio, total_ms: Date.now() - t0, chamadas })},
      skills_ofertadas = ${skills.map((k) => k.id)}
    where id = ${taskId}`;
  await sql`insert into messages (conversation_id, autor, conteudo, tokens, custo) values (${conversationId}, 'assistant', ${resposta}, ${tokIn + tokOut}, ${custo})`;
  await sql`update conversations set ultima_msg_em = now() where id = ${conversationId}`;

  if (status === "concluida" || status === "aguardando_aprovacao") {
    void extractMemories(user, canal, taskId, input.texto, resposta).catch((err) => log.warn({ err }, "extração de memória falhou"));
  }
  // Skills: mede as que foram seguidas e tenta aprender uma nova com esta tarefa
  if (status === "concluida" || status === "erro") {
    void (async () => {
      await registrarUso(taskId, skills, status === "concluida");
      if (status === "concluida") await aprenderSkill(user, taskId, input.texto, resposta);
    })().catch((err) => log.warn({ err }, "skills: aprendizado falhou"));
  }
  return { taskId, resposta, aguardandoAprovacao: status === "aguardando_aprovacao", custoUsd: custo };
}

async function executeTool(
  tu: Anthropic.Beta.BetaToolUseBlock,
  ctx: ToolContext,
  onPending: (p: { id: string; nivel: "confirmar" | "pin" | "pin_voz"; resumo: string }) => void,
): Promise<{ content: string | Anthropic.Beta.BetaToolResultBlockParam["content"]; isError: boolean }> {
  const sql = db();
  const tool = TOOLS_BY_NAME.get(tu.name);
  const started = Date.now();
  const record = async (saida: string, erro?: string) => {
    const [s] = await sql<{ id: string }[]>`
      insert into task_steps (task_id, ferramenta, entrada, saida, duracao_ms, erro)
      values (${ctx.taskId}, ${tu.name}, ${json(tu.input)}, ${saida.slice(0, 20000)}, ${Date.now() - started}, ${erro ?? null}) returning id`;
    return s!.id;
  };

  if (!tool) {
    await record("", "ferramenta desconhecida");
    return { content: `Ferramenta desconhecida: ${tu.name}`, isError: true };
  }
  const parsed = tool.schema.safeParse(tu.input);
  if (!parsed.success) {
    await record("", "entrada inválida");
    return { content: `Entrada inválida: ${parsed.error.message}`, isError: true };
  }
  if (tool.disponivel) {
    const ok = await tool.disponivel(ctx.user);
    if (ok !== true) {
      await record("", ok);
      return { content: `Indisponível: ${ok}. Diga ao usuário o que falta configurar.`, isError: true };
    }
  }
  const decisao = decidir(ctx.user, tool);
  if (decisao.tipo === "negado") {
    await record("", decisao.motivo);
    return { content: decisao.motivo, isError: true };
  }
  if (decisao.tipo === "aprovacao") {
    const resumo = tool.resumo ? tool.resumo(parsed.data) : `${tool.name}: ${JSON.stringify(parsed.data).slice(0, 500)}`;
    const stepId = await record("AGUARDANDO_CONFIRMACAO");
    const id = await createApproval({ user: ctx.user, taskId: ctx.taskId, stepId, nivel: decisao.nivel, ferramenta: tool.name, entrada: parsed.data, resumo });
    onPending({ id, nivel: decisao.nivel, resumo });
    return {
      content: `AGUARDANDO_CONFIRMACAO (nível ${decisao.nivel}). A ação NÃO foi executada ainda. Resumo mostrado ao usuário: ${resumo}`,
      isError: false,
    };
  }
  try {
    const out = await tool.run(parsed.data, ctx);
    if (typeof out === "string") {
      await record(out);
      return { content: out, isError: false };
    }
    await record(out.texto + (out.imagem ? " [imagem]" : ""));
    return {
      content: out.imagem
        ? [
            { type: "text", text: out.texto },
            { type: "image", source: { type: "base64", media_type: out.imagem.media_type, data: out.imagem.data } },
          ]
        : out.texto,
      isError: false,
    };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await record("", msg);
    return { content: `Erro: ${msg}`, isError: true };
  }
}

// ------------------------------------------------------------------ sub-agentes (Fase 4)
const SUB_MAX_PASSOS = 12;

/**
 * Executa uma parte de um pedido grande, em paralelo com as outras, só com ferramentas de leitura
 * (nada que mude, envie ou apague). Devolve o resultado em texto para o agente principal juntar.
 */
export async function runSubagente(ctx: ToolContext, titulo: string, instrucao: string, complexa: boolean): Promise<string> {
  const tools = ALL_TOOLS.filter((t) => t.perfis.includes(ctx.user.perfil) && !t.muda && t.nivel === "livre" && t.name !== "subagentes");
  const model = complexa ? config.modelStrong : config.modelFast;
  const apiTools: Anthropic.Beta.BetaToolUnion[] = tools.map((t) => ({ name: t.name, description: t.description, input_schema: inputSchema(t) }));
  apiTools.push(model.includes("haiku") ? { type: "web_search_20250305", name: "web_search", max_uses: 5 } : { type: "web_search_20260209", name: "web_search", max_uses: 5 });
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: STABLE_SYSTEM, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `${ctx.contexto ?? ""}

Você está agindo como SUB-AGENTE: executa só a parte "${titulo}" de um pedido maior, em paralelo com outras partes.
- Você só tem ferramentas de leitura. Não tente mudar, enviar ou apagar nada.
- Não converse nem faça perguntas: faça o que der e devolva o resultado.
- Resposta final: objetiva, com os números, nomes e fontes encontrados, e diga claramente o que não conseguiu obter.`,
    },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: instrucao }];
  const subCtx: ToolContext = { ...ctx, subagente: true };
  for (let passo = 0; passo < SUB_MAX_PASSOS; passo++) {
    const res = await createMessage({ model, max_tokens: 8000, output_config: { effort: complexa ? "medium" : "low" }, system, tools: apiTools, messages }, ctx.signal);
    ctx.addCusto?.(
      costUsd(res.model, res.usage),
      (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
      res.usage.output_tokens ?? 0,
    );
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !toolUses.length) return text || "(sem resultado)";
    messages.push({ role: "assistant", content: res.content });
    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        // ferramenta fora da lista (ou que muda algo) é recusada aqui também
        if (!tools.some((t) => t.name === tu.name)) return { type: "tool_result", tool_use_id: tu.id, content: "Sub-agentes só podem usar ferramentas de leitura.", is_error: true };
        const out = await executeTool(tu, subCtx, () => {});
        return { type: "tool_result", tool_use_id: tu.id, content: out.content, is_error: out.isError || undefined };
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return "Atingi o limite de passos nesta parte.";
}
