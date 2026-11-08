import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { PanicButton } from "@/components/PanicButton";

const NAV = [
  { href: "/", label: "Início" },
  { href: "/tarefas", label: "Tarefas" },
  { href: "/memoria", label: "Memória" },
  { href: "/rotinas", label: "Skills e rotinas" },
  { href: "/dispositivos", label: "Dispositivos" },
  { href: "/usuarios", label: "Usuários e permissões", perfis: ["dono", "gestor"] },
  { href: "/integracoes", label: "Integrações", perfis: ["dono"] },
  { href: "/custos", label: "Custos", perfis: ["dono", "gestor"] },
  { href: "/auditoria", label: "Auditoria", perfis: ["dono"] },
  { href: "/configuracoes", label: "Autonomia e conta" },
];

async function sair() {
  "use server";
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-60 md:min-h-screen border-b md:border-b-0 md:border-r p-4 space-y-4" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
        <div>
          <div className="text-xl font-bold" style={{ color: "var(--brand)" }}>
            Jarvis
          </div>
          <div className="muted text-xs">
            {user.nome} · {user.perfil}
          </div>
        </div>
        <nav className="flex md:flex-col gap-1 overflow-x-auto text-sm">
          {NAV.filter((n) => !n.perfis || n.perfis.includes(user.perfil)).map((n) => (
            <Link key={n.href} href={n.href} className="px-2 py-1.5 rounded hover:bg-black/5 whitespace-nowrap">
              {n.label}
            </Link>
          ))}
        </nav>
        <PanicButton pausado={user.pausado} dono={user.perfil === "dono"} />
        <form action={sair}>
          <button className="text-xs muted underline">Sair</button>
        </form>
      </aside>
      <main className="flex-1 p-4 md:p-6 max-w-6xl">{children}</main>
    </div>
  );
}
