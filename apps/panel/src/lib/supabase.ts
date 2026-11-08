import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          /* chamado de um Server Component: o middleware renova a sessão */
        }
      },
    },
  });
}

/** Login aceita "Admin" (usuário) ou e-mail completo. Usuários sem e-mail usam o domínio interno. */
export function loginToEmail(login: string) {
  const l = login.trim().toLowerCase();
  return l.includes("@") ? l : `${l}@jarvis.local`;
}
