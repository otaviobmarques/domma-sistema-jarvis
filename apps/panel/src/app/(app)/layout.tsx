import { redirect } from "next/navigation";
import { PanicButton } from "@/components/PanicButton";
import { Icon } from "@/components/icons";
import { NavLinks, type NavItem } from "@/components/nav";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

const NAV: (NavItem & { perfis?: string[]; grupo: string })[] = [
  { href: "/", label: "Início", icon: "home", grupo: "Assistente" },
  { href: "/tarefas", label: "Tarefas", icon: "tasks", grupo: "Assistente" },
  { href: "/memoria", label: "Memória", icon: "brain", grupo: "Assistente" },
  { href: "/rotinas", label: "Skills e rotinas", icon: "repeat", grupo: "Assistente" },
  { href: "/dispositivos", label: "Dispositivos", icon: "devices", grupo: "Assistente" },
  { href: "/usuarios", label: "Usuários e permissões", icon: "users", perfis: ["dono", "gestor"], grupo: "Gestão" },
  { href: "/integracoes", label: "Integrações", icon: "plug", perfis: ["dono"], grupo: "Gestão" },
  { href: "/custos", label: "Custos", icon: "wallet", perfis: ["dono", "gestor"], grupo: "Gestão" },
  { href: "/auditoria", label: "Auditoria", icon: "shield", perfis: ["dono"], grupo: "Gestão" },
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
  const itens = NAV.filter((n) => !n.perfis || n.perfis.includes(user.perfil));
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
        <div className="flex items-center gap-3 px-1">
          <img src="/logo.svg" alt="" width={36} height={36} className="rounded-lg" />
          <div>
            <div className="text-lg font-bold leading-tight tracking-tight">Jarvis</div>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: "var(--side-ink)", opacity: 0.7 }}>
              Domma Tecnologia
            </div>
          </div>
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
            <div className="w-9 h-9 rounded-full grid place-items-center text-sm font-semibold" style={{ background: "linear-gradient(135deg,#3b82f6,#1e3a5f)" }}>
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
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
