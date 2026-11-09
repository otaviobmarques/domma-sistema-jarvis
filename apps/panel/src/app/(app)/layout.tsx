import { redirect } from "next/navigation";
import { PanicButton } from "@/components/PanicButton";
import { ByDomma } from "@/components/brand";
import { Icon } from "@/components/icons";
import { FormWithResult } from "@/components/client";
import { NavLinks, type NavItem } from "@/components/nav";
import { trocarSenha } from "@/app/actions";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

const NAV: (NavItem & { perfis?: string[]; grupo: string; so?: "plataforma" | "cliente" })[] = [
  { href: "/", label: "Início", icon: "home", grupo: "Assistente" },
  { href: "/tarefas", label: "Tarefas", icon: "tasks", grupo: "Assistente" },
  { href: "/memoria", label: "Memória", icon: "brain", grupo: "Assistente" },
  { href: "/rotinas", label: "Skills e rotinas", icon: "repeat", grupo: "Assistente" },
  { href: "/dispositivos", label: "Dispositivos", icon: "devices", grupo: "Assistente" },
  { href: "/usuarios", label: "Usuários e permissões", icon: "users", perfis: ["dono", "gestor"], grupo: "Gestão" },
  { href: "/integracoes", label: "Integrações", icon: "plug", perfis: ["dono"], grupo: "Gestão" },
  { href: "/custos", label: "Custos", icon: "wallet", perfis: ["dono"], grupo: "Gestão" },
  { href: "/auditoria", label: "Auditoria", icon: "shield", perfis: ["dono"], grupo: "Gestão" },
  { href: "/assinatura", label: "Assinatura", icon: "wallet", perfis: ["dono"], so: "cliente", grupo: "Gestão" },
  { href: "/plataforma", label: "Plataforma", icon: "shield", perfis: ["dono"], so: "plataforma", grupo: "Gestão" },
  { href: "/configuracoes", label: "Autonomia e conta", icon: "settings", grupo: "Gestão" },
];

const PERFIL: Record<string, string> = { dono: "Dono", gestor: "Gestor", operador: "Operador", loja: "Loja" };

async function sair() {
  "use server";
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { data: sessao } = await (await supabaseServer()).auth.getUser();
  const trocar = !!sessao.user?.user_metadata?.trocar_senha;
  const itens = NAV.filter(
    (n) => (!n.perfis || n.perfis.includes(user.perfil)) && (!n.so || (n.so === "plataforma") === user.plataforma),
  );
  // situação da assinatura do cliente
  const diasTeste = user.teste_ate ? Math.ceil((new Date(user.teste_ate).getTime() - Date.now()) / 86_400_000) : 0;
  const aviso = user.plataforma
    ? null
    : user.tenant_status === "teste"
      ? diasTeste > 0
        ? { cor: "#6f5cf6", texto: `Teste grátis: ${diasTeste} ${diasTeste === 1 ? "dia restante" : "dias restantes"}.` }
        : { cor: "#ef4444", texto: "O período de teste terminou. Assine para continuar usando o Tavinho." }
      : user.tenant_status === "inadimplente"
        ? { cor: "#f59e0b", texto: "Há uma fatura em atraso. Regularize para não suspender o Tavinho." }
        : user.tenant_status === "bloqueado" || user.tenant_status === "cancelado"
          ? { cor: "#ef4444", texto: user.tenant_status === "bloqueado" ? "O Tavinho está suspenso nesta conta." : "A assinatura desta conta foi cancelada." }
          : null;
  const grupos = [...new Set(itens.map((i) => i.grupo))];
  const iniciais = user.nome
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

  return (
    <div className="min-h-screen md:flex">
      <aside
        className="md:w-64 md:h-screen md:sticky md:top-0 flex flex-col gap-5 p-4 md:p-5 text-white"
        style={{ background: "linear-gradient(180deg, var(--side) 0%, var(--side-2) 100%)" }}
      >
        <div className="px-1 space-y-1.5">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" width={36} height={36} className="rounded-lg" />
            <div className="text-xl font-bold leading-tight tracking-tight" style={{ fontFamily: "var(--font-brand), sans-serif" }}>
              Tavinho
            </div>
          </div>
          <ByDomma dark />
        </div>

        <div className="flex-1 space-y-5 md:overflow-y-auto">
          {grupos.map((g) => (
            <div key={g} className="space-y-1">
              <div className="hidden md:block px-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--side-ink)", opacity: 0.5 }}>
                {g}
              </div>
              <NavLinks items={itens.filter((i) => i.grupo === g)} />
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <PanicButton pausado={user.pausado} dono={user.perfil === "dono"} />
          <div className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.05)" }}>
            <div className="w-9 h-9 rounded-full grid place-items-center text-sm font-semibold" style={{ background: "linear-gradient(135deg,#8172ff,#1c1337)" }}>
              {iniciais || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{user.nome}</div>
              <div className="text-xs" style={{ color: "var(--side-ink)", opacity: 0.7 }}>
                {PERFIL[user.perfil]}
              </div>
            </div>
            <form action={sair}>
              <button title="Sair" className="p-1.5 rounded-md hover:bg-white/10" style={{ color: "var(--side-ink)" }}>
                <Icon name="logout" size={16} />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          {aviso && (
            <div className="mb-4 rounded-xl px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2" style={{ background: `${aviso.cor}14`, border: `1px solid ${aviso.cor}55` }}>
              <span>{aviso.texto}</span>
              {user.perfil === "dono" ? (
                <a href="/assinatura" className="font-medium underline">
                  Ver assinatura
                </a>
              ) : (
                <span className="muted">Fale com o responsável pela conta.</span>
              )}
            </div>
          )}
          {trocar ? (
            <div className="card max-w-md space-y-3">
              <h1 className="title">Crie sua senha</h1>
              <p className="muted text-sm">Este é o seu primeiro acesso com uma senha provisória. Escolha uma senha só sua (pelo menos 8 caracteres, com letras e números).</p>
              <FormWithResult action={trocarSenha} className="space-y-2">
                <input name="nova" type="password" className="input" placeholder="Nova senha" autoComplete="new-password" required />
                <input name="confirmar" type="password" className="input" placeholder="Repita a nova senha" autoComplete="new-password" required />
                <button className="btn">Salvar senha</button>
              </FormWithResult>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}
