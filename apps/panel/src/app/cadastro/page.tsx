import { cadastrar } from "@/app/actions";
import { ByDomma, DommaLogo } from "@/components/brand";
import { FormWithResult } from "@/components/client";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta · Tavinho by Domma Tecnologia" };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function Cadastro() {
  const [cfg] = await sql<{ preco_usuario: string; dias_teste: number }[]>`select preco_usuario, dias_teste from plataforma_config limit 1`;
  const preco = Number(cfg?.preco_usuario ?? 99);
  const dias = cfg?.dias_teste ?? 14;
  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <section
        className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden"
        style={{ background: "radial-gradient(1100px 600px at 15% 15%, #4b3bc4 0%, #1c1337 55%, #0c0819 100%)" }}
      >
        <DommaLogo height={44} variant="dark" />
        <div className="space-y-5 max-w-md relative z-10">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" width={48} height={48} className="rounded-xl" />
            <div>
              <div className="text-3xl font-bold tracking-tight" style={{ fontFamily: "var(--font-brand), sans-serif" }}>Tavinho</div>
              <div className="text-sm text-white/60">by Domma Tecnologia</div>
            </div>
          </div>
          <h1 className="text-4xl font-bold tracking-tight leading-tight">Um assistente de IA para a sua empresa inteira.</h1>
          <ul className="space-y-2 text-white/80 text-sm">
            <li>✓ Responde e executa pelo WhatsApp, pelo painel, no PC e no celular — inclusive por voz</li>
            <li>✓ E-mails, agenda, campanhas, relatórios e rotinas automáticas</li>
            <li>✓ Cada pessoa da equipe com o seu perfil e as suas permissões</li>
            <li>✓ Memória da empresa: aprende como vocês trabalham</li>
          </ul>
          <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="text-2xl font-bold">
              {brl(preco)} <span className="text-sm font-normal text-white/60">por usuário / mês</span>
            </div>
            <div className="text-sm text-white/70">
              {dias} dias grátis. Sem fidelidade. Pague por Pix, boleto ou cartão.
            </div>
          </div>
        </div>
        <div className="text-xs text-white/40">© Domma Tecnologia</div>
        <div className="absolute -right-32 -bottom-32 w-[28rem] h-[28rem] rounded-full border border-white/10" />
      </section>

      <section className="grid place-items-center p-6">
        <div className="w-full max-w-md space-y-5">
          <div className="lg:hidden space-y-3">
            <DommaLogo height={32} />
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="" width={40} height={40} className="rounded-lg" />
              <span className="text-xl font-bold tracking-tight">Tavinho</span>
            </div>
            <p className="text-sm muted">
              {brl(preco)} por usuário/mês · {dias} dias grátis
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Criar conta grátis</h2>
            <p className="muted text-sm">Teste por {dias} dias. Você só paga se continuar.</p>
          </div>
          <FormWithResult action={cadastrar} className="space-y-3">
            <label className="block text-sm font-medium">
              Nome da empresa
              <input name="empresa" className="input mt-1" required maxLength={120} autoComplete="organization" />
            </label>
            <label className="block text-sm font-medium">
              CNPJ ou CPF
              <input name="documento" className="input mt-1" required inputMode="numeric" placeholder="00.000.000/0000-00" />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-sm font-medium">
                Seu nome
                <input name="responsavel" className="input mt-1" required maxLength={120} autoComplete="name" />
              </label>
              <label className="block text-sm font-medium">
                Seu WhatsApp
                <input name="whatsapp" className="input mt-1" required inputMode="tel" placeholder="(31) 99999-8888" autoComplete="tel" />
              </label>
            </div>
            <label className="block text-sm font-medium">
              E-mail (para as faturas)
              <input name="email" type="email" className="input mt-1" required autoComplete="email" />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block text-sm font-medium">
                Usuário para entrar
                <input name="login" className="input mt-1" required placeholder="ex.: maria.silva" autoComplete="username" />
              </label>
              <label className="block text-sm font-medium">
                Senha
                <input name="senha" type="password" className="input mt-1" required minLength={8} autoComplete="new-password" />
              </label>
            </div>
            {/* campo-isca: pessoas não veem, robôs preenchem */}
            <input name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="aceite" className="mt-1" required />
              <span>
                Li e aceito os <a href="/termos" target="_blank" className="underline">Termos de Uso</a> e a{" "}
                <a href="/privacidade" target="_blank" className="underline">Política de Privacidade</a>.
              </span>
            </label>
            <button className="btn w-full py-2.5">Começar o teste grátis</button>
          </FormWithResult>
          <p className="text-sm text-center muted">
            Já tem conta? <a href="/login" className="underline">Entrar</a>
          </p>
          <div className="flex justify-center">
            <ByDomma />
          </div>
        </div>
      </section>
    </main>
  );
}
