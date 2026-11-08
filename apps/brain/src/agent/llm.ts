import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config.js";

export const anthropic = new Anthropic({ maxRetries: 3 });

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

export type Rota = { model: string; effort: "low" | "medium" | "high" };

/**
 * Roteador de modelos (seção 2.1): pedido simples → modelo rápido; complexo → modelo forte.
 * Heurística barata primeiro; o modelo rápido decide só quando há dúvida.
 */
export async function rotear(texto: string, temAnexo: boolean): Promise<Rota> {
  const t = texto.toLowerCase();
  const forte: Rota = { model: config.modelStrong, effort: "high" };
  const rapido: Rota = { model: config.modelFast, effort: "low" };

  if (temAnexo || texto.length > 600) return forte;
  if (/\b(analis|compar|relat[oó]rio|estrat|planej|por que|porque|campanha|todas as|todos os|resum[oa] (da|do|das|dos) (semana|m[eê]s)|investig)/.test(t)) return forte;
  if (texto.length < 80 && /^(oi|ol[aá]|bom dia|boa tarde|boa noite|obrigad|valeu|que horas|qual (a|o) data|ok|beleza)/.test(t)) return rapido;

  try {
    const r = await anthropic.messages.create({
      model: config.modelFast,
      max_tokens: 16,
      output_config: { effort: "low" },
      system:
        "Classifique o pedido de um assistente executivo. Responda só SIMPLES (uma consulta ou ação direta, uma ferramenta) ou COMPLEXO (várias etapas, análise, comparação, decisão, texto longo).",
      messages: [{ role: "user", content: texto.slice(0, 1500) }],
    });
    const out = r.content.find((b) => b.type === "text")?.text.toUpperCase() ?? "";
    return out.includes("SIMPLES") ? { model: config.modelFast, effort: "medium" } : forte;
  } catch {
    return forte;
  }
}
