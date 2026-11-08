import "server-only";

const BRAIN = (process.env.BRAIN_URL ?? "http://localhost:8080").replace(/\/$/, "");

/** Chamada servidor→servidor ao cérebro, autenticada com o segredo compartilhado. */
export async function brain<T = any>(path: string, userId: string | null, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BRAIN}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      "x-jarvis-secret": process.env.BRAIN_API_SECRET ?? "",
      ...(userId ? { "x-jarvis-user": userId } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : init.method === "POST" ? "{}" : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(10 * 60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `cérebro respondeu ${res.status}`);
  return data as T;
}

export const usd = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  const brl = n * Number(process.env.USD_BRL ?? 5.5);
  return `R$ ${brl.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
