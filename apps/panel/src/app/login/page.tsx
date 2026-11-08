import { redirect } from "next/navigation";
import { loginToEmail, supabaseServer } from "@/lib/supabase";

async function entrar(formData: FormData) {
  "use server";
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({
    email: loginToEmail(String(formData.get("login") ?? "")),
    password: String(formData.get("senha") ?? ""),
  });
  if (error) redirect("/login?erro=1");
  redirect("/");
}

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <form action={entrar} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" width={44} height={44} />
          <div>
          <div className="text-2xl font-bold" style={{ color: "var(--brand)" }}>
            Jarvis
          </div>
          <div className="muted text-sm">Domma Tecnologia</div>
          </div>
        </div>
        <label className="block text-sm">
          Usuário ou e-mail
          <input name="login" className="input mt-1" autoComplete="username" required />
        </label>
        <label className="block text-sm">
          Senha
          <input name="senha" type="password" className="input mt-1" autoComplete="current-password" required />
        </label>
        {erro === "1" && <p className="text-sm text-red-600">Usuário ou senha incorretos.</p>}
        {erro === "2" && <p className="text-sm text-red-600">Seu acesso ainda não foi liberado no Jarvis. Fale com o administrador.</p>}
        <button className="btn w-full justify-center">Entrar</button>
        <p className="text-xs muted text-center">
          <a href="/privacidade" className="underline">Privacidade</a> · <a href="/termos" className="underline">Termos</a>
        </p>
      </form>
    </main>
  );
}
