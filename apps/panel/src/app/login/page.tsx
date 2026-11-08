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
    <main className="min-h-screen grid lg:grid-cols-2">
      <section
        className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{ background: "radial-gradient(1200px 600px at 20% 20%, #1d4ed8 0%, #0f1e36 55%, #070d19 100%)" }}
      >
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" width={40} height={40} className="rounded-lg" />
          <span className="text-xl font-bold tracking-tight">Jarvis</span>
        </div>
        <div className="space-y-4 max-w-md relative z-10">
          <h1 className="text-4xl font-bold tracking-tight leading-tight">Seu assistente de IA para todas as empresas do grupo.</h1>
          <p className="text-blue-100/80">E-mails, agenda, campanhas, lojas e rotinas, num só lugar. Pelo WhatsApp, pelo painel e, em breve, por voz.</p>
        </div>
        <div className="text-xs text-blue-100/50">© Domma Tecnologia</div>
        <div className="absolute -right-32 -bottom-32 w-[28rem] h-[28rem] rounded-full border border-white/10" />
        <div className="absolute -right-12 -bottom-12 w-[18rem] h-[18rem] rounded-full border border-white/10" />
      </section>

      <section className="grid place-items-center p-6">
        <form action={entrar} className="w-full max-w-sm space-y-5">
          <div className="flex items-center gap-3 lg:hidden">
            <img src="/logo.svg" alt="" width={40} height={40} className="rounded-lg" />
            <span className="text-xl font-bold tracking-tight">Jarvis</span>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Entrar</h2>
            <p className="muted text-sm">Acesse o painel do Jarvis</p>
          </div>
          <label className="block text-sm font-medium">
            Usuário ou e-mail
            <input name="login" className="input mt-1.5" autoComplete="username" required autoFocus />
          </label>
          <label className="block text-sm font-medium">
            Senha
            <input name="senha" type="password" className="input mt-1.5" autoComplete="current-password" required />
          </label>
          {erro === "1" && <p className="text-sm text-red-600">Usuário ou senha incorretos.</p>}
          {erro === "2" && <p className="text-sm text-red-600">Seu acesso ainda não foi liberado no Jarvis. Fale com o administrador.</p>}
          <button className="btn w-full py-2.5">Entrar</button>
          <p className="text-xs muted text-center">
            <a href="/privacidade" className="hover:underline">Privacidade</a> · <a href="/termos" className="hover:underline">Termos</a>
          </p>
        </form>
      </section>
    </main>
  );
}
