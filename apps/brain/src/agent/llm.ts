import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config.js";

export let anthropic = new Anthropic({ maxRetries: 3 });

/** Troca a chave em tempo de execução (cadastrada no painel). Os módulos que importam `anthropic` veem a nova instância. */
export function setAnthropicKey(apiKey: string) {
  anthropic = new Anthropic({ apiKey, maxRetries: 3 });
}

// USD por 1M tokens (entrada, saída). Cache read ≈ 10% da entrada, escrita ≈ 125%.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-fable-5-1": [10, 50],
};

export function costUsd(model: string, u: Anthropic.Beta.BetaUsage | undefined): number {
  if (!u) return 0;
  const [pin, pout] = PRICES[model] ?? [4, 20];
  const input = u.input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return (input * pin + cacheRead * pin * 0.1 + cacheWrite * pin * 1.25 + (u.output_tokens ?? 0) * pout) / 1e6;
}

/** Modelos com fallback server-side disponível (recusa de classificador → outro modelo continua). */
const SUPPORTS_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export type CreateParams = Omit<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks">;

export async function createMessage(params: CreateParams, signal?: AbortSignal) {
  const extra: Partial<Anthropic.Beta.MessageCreateParamsNonStreaming> = SUPPORTS_FALLBACK.has(params.model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
  return anthropic.beta.messages.create({ ...params, ...extra }, { signal });
}

/** Mesma chamada, em streaming: `onTexto` recebe o texto à medida que é gerado. */
export async function streamMessage(params: CreateParams, onTexto: (delta: string) => void, signal?: AbortSignal) {
  const extra: Partial<Anthropic.Beta.MessageCreateParamsNonStreaming> = SUPPORTS_FALLBACK.has(params.model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : {};
  const stream = anthropic.beta.messages.stream({ ...params, ...extra }, { signal });
  stream.on("text", (d) => onTexto(d));
  return stream.finalMessage();
}

export type Rota = { model: string; effort: "low" | "medium" | "high"; motivo: string };

const ANALISE = /\b(analis|compar|relat[oó]rio|estrat[eé]g|planej|por que|porque|investig|diagn[oó]stic|recomend|tend[eê]ncia|otimiz|proposta|elabor|redij|escrev[ae] (um|uma) (texto|e-?mail|proposta|documento))/;
const CONSULTA = /\b(quant[oa]s?|qual|quais|quando|onde|lista|mostra|me (diz|fala|manda)|tem algum|agenda|compromisso|reuni|e-?mails?|n[aã]o lid|resum|status|lembr|marc[ae]|cri[ae]|cancel|mov[ae])/;

/**
 * Roteador de modelos (seção 2.1): pedido simples → modelo rápido; complexo → modelo forte.
 * Heurística barata primeiro; o modelo rápido só decide quando há dúvida.
 */
export async function rotear(texto: string, temAnexo: boolean, voz = false): Promise<Rota> {
  const t = texto.toLowerCase();
  // Conversa por voz: latência manda. Modelo rápido, a não ser que peçam análise de verdade.
  if (voz && !temAnexo) {
    return ANALISE.test(t) ? { model: config.modelStrong, effort: "low", motivo: "voz + análise" } : { model: config.modelFast, effort: "low", motivo: "voz" };
  }
  const forte = (motivo: string): Rota => ({ model: config.modelStrong, effort: "medium", motivo });
  const profundo = (motivo: string): Rota => ({ model: config.modelStrong, effort: "high", motivo });
  const rapido = (motivo: string): Rota => ({ model: config.modelFast, effort: "medium", motivo });

  if (temAnexo) return forte("anexo");
  if (texto.length > 800) return forte("pedido longo");
  if (ANALISE.test(t)) return profundo("análise");
  if (texto.length < 300 && CONSULTA.test(t)) return rapido("consulta direta");
  if (texto.length < 60) return rapido("mensagem curta");

  try {
    const r = await anthropic.messages.create({
      model: config.modelFast,
      max_tokens: 16,
      output_config: { effort: "low" },
      system:
        "Classifique o pedido feito a um assistente executivo que tem ferramentas (agenda, e-mail, anúncios, bancos de dados). Responda só SIMPLES ou COMPLEXO. SIMPLES: consultar, contar, listar, resumir, criar ou alterar algo com poucas etapas. COMPLEXO: análise, comparação entre várias fontes, estratégia, decisão, texto longo e elaborado.",
      messages: [{ role: "user", content: texto.slice(0, 1500) }],
    });
    const out = r.content.find((b) => b.type === "text")?.text.toUpperCase() ?? "";
    return out.includes("SIMPLES") ? rapido("classificador") : forte("classificador");
  } catch {
    return forte("classificador indisponível");
  }
}
