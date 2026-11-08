import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataTypeMap } from "baileys";
import { db } from "../lib/db.js";
import { encrypt, decrypt } from "../lib/crypto.js";

/**
 * Sessão do WhatsApp guardada no Postgres (criptografada), para sobreviver a redeploys
 * sem precisar de volume em disco.
 */
async function read(key: string): Promise<any | null> {
  const sql = db();
  const [r] = await sql<{ valor: { enc: string } }[]>`select valor from wa_auth where chave = ${key}`;
  if (!r) return null;
  return JSON.parse(decrypt(r.valor.enc), BufferJSON.reviver);
}

async function write(key: string, value: unknown) {
  const sql = db();
  const enc = encrypt(JSON.stringify(value, BufferJSON.replacer));
  await sql`insert into wa_auth (chave, valor, atualizado_em) values (${key}, ${sql.json({ enc })}, now())
            on conflict (chave) do update set valor = excluded.valor, atualizado_em = now()`;
}

async function remove(key: string) {
  await db()`delete from wa_auth where chave = ${key}`;
}

export async function clearWaAuth() {
  await db()`delete from wa_auth`;
}

export async function usePostgresAuthState(): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const creds: AuthenticationCreds = (await read("creds")) ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
              data[id] = value;
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            const cat = data[category as keyof SignalDataTypeMap]!;
            for (const id in cat) {
              const value = cat[id];
              const key = `${category}-${id}`;
              tasks.push(value ? write(key, value) : remove(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write("creds", creds),
  };
}
