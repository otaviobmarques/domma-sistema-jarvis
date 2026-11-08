import { revogarDispositivo } from "@/app/actions";
import { ActionButton, ParearPc } from "@/components/client";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { brain } from "@/lib/brain";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const DOWNLOAD = "https://github.com/otaviobmarques/domma-sistema-jarvis/releases/latest";

const ACAO: Record<string, string> = {
  abrir: "Abrir",
  arquivos: "Arquivos",
  apagar: "Apagar",
  comando: "Comando",
  janelas: "Janelas",
  print: "Print da tela",
  mouse: "Mouse",
  teclado: "Teclado",
  parar: "Parar",
};

export default async function Dispositivos() {
  const u = await requireUser();
  const [devices, fila] = await Promise.all([
    brain<{ id: string; tipo: string; nome: string; status: string; ultimo_contato: string | null; online: boolean; info: any }[]>("/api/devices", u.id).catch(() => []),
    sql<{ id: string; acao: string | null; status: string; payload: any; criado_em: Date; nome: string | null }[]>`
      select q.id, q.acao, q.status, q.payload, q.criado_em, d.nome from task_queue q
      left join devices d on d.id = q.device_id
      where d.user_id = ${u.id} order by q.criado_em desc limit 25`,
  ]);

  return (
    <div className="space-y-6">
      <h1 className="title">Dispositivos</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="devices" /> App do Jarvis para Windows
          </div>
          <ol className="text-sm list-decimal ml-5 space-y-1">
            <li>
              Baixe o instalador em{" "}
              <a className="underline" href={DOWNLOAD} target="_blank" rel="noreferrer">
                Releases do GitHub
              </a>{" "}
              (arquivo <code>Jarvis_x.y.z_x64-setup.exe</code>) e instale.
            </li>
            <li>Abra o app (ícone na bandeja, ou <b>Ctrl+Espaço</b>).</li>
            <li>Gere o código abaixo e digite no app.</li>
          </ol>
          <ParearPc />
        </div>
        <div className="card text-sm space-y-2">
          <div className="flex items-center gap-2 font-semibold">📱 App Android (Fase 3)</div>
          <p className="muted">Serviço de Acessibilidade, leitura de notificações, alarmes, ligações e mensagens. Em desenvolvimento.</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="font-semibold mb-2">Pareados</div>
        {devices.length ? (
          <table className="t">
            <thead>
              <tr>
                <th>Dispositivo</th>
                <th>Status</th>
                <th>Último contato</th>
                <th>Sistema</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.tipo === "pc" ? "💻" : "📱"} {d.nome}
                  </td>
                  <td>
                    <span className="pill">
                      <span className="dot" style={{ background: d.online ? "#10b981" : "#94a3b8" }} />
                      {d.online ? "online" : "offline"}
                    </span>
                  </td>
                  <td className="muted">{d.ultimo_contato ? new Date(d.ultimo_contato).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca"}</td>
                  <td className="muted text-xs">{[d.info?.os, d.info?.versao_app && `app ${d.info.versao_app}`].filter(Boolean).join(" · ")}</td>
                  <td>
                    <ActionButton label="Desconectar" confirmText={`Desconectar ${d.nome}? O app precisará ser pareado de novo.`} action={revogarDispositivo.bind(null, d.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted text-sm">Nenhum dispositivo pareado ainda.</p>
        )}
      </div>

      <div className="card overflow-x-auto">
        <div className="font-semibold mb-2">Últimas ações nos dispositivos</div>
        {fila.length ? (
          <table className="t">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Dispositivo</th>
                <th>Ação</th>
                <th>Detalhe</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {fila.map((q) => (
                <tr key={q.id}>
                  <td className="muted whitespace-nowrap">{q.criado_em.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                  <td>{q.nome}</td>
                  <td>{ACAO[q.acao ?? ""] ?? q.acao ?? "tarefa"}</td>
                  <td className="text-xs muted max-w-[22rem] truncate">{JSON.stringify(q.payload).slice(0, 120)}</td>
                  <td>
                    <span className="tag">{q.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted text-sm">Nenhuma ação ainda.</p>
        )}
      </div>
    </div>
  );
}
