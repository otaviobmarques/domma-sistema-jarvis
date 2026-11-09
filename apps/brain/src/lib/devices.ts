import { createHash, randomBytes, randomUUID } from "node:crypto";
import { audit, db, json } from "./db.js";
import { log } from "./log.js";

/**
 * Hub dos dispositivos (Fase 2: app de PC; Fase 3: Android).
 * O app faz long-polling em /device/poll; o cérebro entrega ações e espera o resultado.
 * Tudo em memória (uma instância do cérebro) + registro em task_queue para auditoria.
 */
export interface DeviceAction {
  id: string;
  acao: string;
  params: Record<string, unknown>;
}

export interface DeviceResult {
  ok: boolean;
  texto: string;
  imagem?: { media_type: "image/png" | "image/jpeg"; data: string };
}

const fila = new Map<string, DeviceAction[]>(); // deviceId → ações pendentes
const esperando = new Map<string, (a: DeviceAction | null) => void>(); // deviceId → long-poll aberto
const resultados = new Map<string, { resolve: (r: DeviceResult) => void; timer: NodeJS.Timeout }>();
const vistoEm = new Map<string, number>();

const ONLINE_MS = 45_000;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export function isOnline(deviceId: string) {
  return Date.now() - (vistoEm.get(deviceId) ?? 0) < ONLINE_MS;
}

// ------------------------------------------------------------------ pareamento
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I

export async function criarCodigoPareamento(userId: string) {
  const sql = db();
  const bytes = randomBytes(6);
  const codigo = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
  await sql`delete from device_pairings where user_id = ${userId} and usado_em is null`;
  const [r] = await sql<{ expira_em: Date }[]>`insert into device_pairings (codigo, user_id) values (${codigo}, ${userId}) returning expira_em`;
  return { codigo, expira_em: r!.expira_em };
}

export async function parear(codigo: string, nome: string, tipo: "pc" | "android", info: Record<string, unknown>) {
  const sql = db();
  const c = codigo.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const [p] = await sql<{ user_id: string }[]>`
    update device_pairings set usado_em = now()
    where codigo = ${c} and usado_em is null and expira_em > now()
    returning user_id`;
  if (!p) return null;
  const token = randomBytes(32).toString("base64url");
  const [d] = await sql<{ id: string }[]>`
    insert into devices (user_id, tipo, nome, token_hash, info, status, ultimo_contato)
    values (${p.user_id}, ${tipo}, ${nome.slice(0, 80)}, ${sha(token)}, ${json(info)}, 'online', now())
    returning id`;
  await audit(p.user_id, "dispositivo.parear", d!.id, null, { nome, tipo, info }, nome);
  return { deviceId: d!.id, userId: p.user_id, token };
}

const cacheAuth = new Map<string, { d: { id: string; user_id: string; nome: string; tipo: string }; ate: number }>();

export async function autenticar(token: string) {
  if (!token) return null;
  const h = sha(token);
  const c = cacheAuth.get(h);
  if (c && c.ate > Date.now()) return c.d;
  const d = await autenticarBanco(token);
  if (d) cacheAuth.set(h, { d, ate: Date.now() + 60_000 });
  return d;
}

async function autenticarBanco(token: string) {
  const sql = db();
  const [d] = await sql<{ id: string; user_id: string; nome: string; tipo: string }[]>`
    select id, user_id, nome, tipo from devices where token_hash = ${sha(token)} and ativo`;
  return d ?? null;
}

export async function revogar(deviceId: string, userId: string) {
  const sql = db();
  await sql`update devices set ativo = false, token_hash = null, status = 'revogado' where id = ${deviceId} and user_id = ${userId}`;
  cacheAuth.clear();
  esperando.get(deviceId)?.(null);
  await audit(userId, "dispositivo.revogar", deviceId);
}

// ------------------------------------------------------------------ long-poll
export async function marcarVisto(deviceId: string, info?: Record<string, unknown>) {
  const antes = isOnline(deviceId);
  vistoEm.set(deviceId, Date.now());
  if (!antes || info) {
    await db()`update devices set status = 'online', ultimo_contato = now(), info = info || ${json(info ?? {})} where id = ${deviceId}`.catch(() => {});
  }
}

/** Espera até `waitMs` por uma ação para o dispositivo. */
export function proximaAcao(deviceId: string, waitMs = 25_000): Promise<DeviceAction | null> {
  const q = fila.get(deviceId);
  if (q?.length) return Promise.resolve(q.shift()!);
  esperando.get(deviceId)?.(null); // só um long-poll por dispositivo
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (esperando.get(deviceId) === done) esperando.delete(deviceId);
      resolve(null);
    }, waitMs);
    const done = (a: DeviceAction | null) => {
      clearTimeout(timer);
      if (esperando.get(deviceId) === done) esperando.delete(deviceId);
      resolve(a);
    };
    esperando.set(deviceId, done);
  });
}

export async function receberResultado(deviceId: string, actionId: string, r: DeviceResult) {
  const w = resultados.get(actionId);
  await db()`
    update task_queue set status = ${r.ok ? "concluida" : "erro"}, concluido_em = now(),
      resultado = ${json({ ok: r.ok, texto: r.texto.slice(0, 20000), imagem: !!r.imagem })}
    where id = ${actionId} and device_id = ${deviceId}`.catch(() => {});
  if (w) {
    clearTimeout(w.timer);
    resultados.delete(actionId);
    w.resolve(r);
  }
}

/** Envia uma ação ao dispositivo e espera o resultado. */
export async function executarNoDispositivo(
  deviceId: string,
  taskId: string | null,
  acao: string,
  params: Record<string, unknown>,
  opts: { timeoutMs?: number; signal?: AbortSignal; recurso?: "pc" | "android" } = {},
): Promise<DeviceResult> {
  const recurso = opts.recurso ?? "pc";
  const quem = recurso === "android" ? "O celular" : "O PC";
  if (!isOnline(deviceId)) return { ok: false, texto: `${quem} está offline (app fechado, sem internet ou aparelho desligado).` };
  const id = randomUUID();
  await db()`
    insert into task_queue (id, task_id, device_id, recurso, acao, payload, status)
    values (${id}, ${taskId}, ${deviceId}, ${recurso}, ${acao}, ${json(params)}, 'entregue')`.catch((err) => log.warn({ err }, "task_queue"));
  const action: DeviceAction = { id, acao, params };

  const result = new Promise<DeviceResult>((resolve) => {
    const timer = setTimeout(() => {
      resultados.delete(id);
      resolve({ ok: false, texto: `${quem} não respondeu a tempo.` });
    }, opts.timeoutMs ?? 90_000);
    resultados.set(id, { resolve, timer });
    opts.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resultados.delete(id);
      resolve({ ok: false, texto: "Interrompido." });
    });
  });

  const waiter = esperando.get(deviceId);
  if (waiter) waiter(action);
  else fila.set(deviceId, [...(fila.get(deviceId) ?? []), action]);
  return result;
}

/** Cancela tudo o que está na fila dos dispositivos do usuário (botão de pânico). */
export function cancelarFila(deviceIds: string[]) {
  for (const d of deviceIds) {
    fila.delete(d);
    // manda um "parar" para o app soltar teclado/mouse na hora
    const w = esperando.get(d);
    if (w) w({ id: randomUUID(), acao: "parar", params: {} });
    else fila.set(d, [{ id: randomUUID(), acao: "parar", params: {} }]);
  }
}

export function pcOnlineDoUsuario(userId: string, preferido?: string | null) {
  return dispositivoOnline(userId, "pc", preferido);
}

export async function dispositivoOnline(userId: string, tipo: "pc" | "android", preferido?: string | null) {
  const sql = db();
  const devs = await sql<{ id: string; nome: string }[]>`
    select id, nome from devices where user_id = ${userId} and tipo = ${tipo} and ativo order by ultimo_contato desc nulls last`;
  if (preferido && devs.some((d) => d.id === preferido) && isOnline(preferido)) return devs.find((d) => d.id === preferido)!;
  return devs.find((d) => isOnline(d.id)) ?? null;
}
