import { revogarDispositivo } from "@/app/actions";
import { ActionButton, ParearPc } from "@/components/client";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { brain } from "@/lib/brain";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const RELEASES = "https://github.com/otaviobmarques/domma-sistema-jarvis/releases";
const DOWNLOAD = `${RELEASES}?q=pc-v&expanded=true`;
const DOWNLOAD_ANDROID = `${RELEASES}?q=android-v&expanded=true`;

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
  tela: "Ler a tela",
  tocar: "Tocar",
  digitar: "Digitar",
  rolar: "Rolar",
  navegar: "Navegar",
  notificacoes: "Notificações",
  alarme: "Alarme",
  timer: "Timer",
  ligar: "Ligação",
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
            <Icon name="devices" /> App do Tavinho para Windows
          </div>
          <ol className="text-sm list-decimal ml-5 space-y-1">
            <li>
              Baixe o instalador em{" "}
              <a className="underline" href={DOWNLOAD} target="_blank" rel="noreferrer">
                Releases do GitHub
              </a>{" "}
              (arquivo <code>Tavinho_x.y.z_x64-setup.exe</code>) e instale.
            </li>
            <li>Abra o app (ícone na bandeja, ou <b>Ctrl+Espaço</b>).</li>
            <li>Gere o código abaixo e digite no app.</li>
          </ol>
          <ParearPc />
        </div>
        <div className="card space-y-3">
          <div className="flex items-center gap-2 font-semibold">📱 App do Tavinho para Android</div>
          <ol className="text-sm list-decimal ml-5 space-y-1">
            <li>
              No celular, abra{" "}
              <a className="underline" href={DOWNLOAD_ANDROID} target="_blank" rel="noreferrer">
                Releases do GitHub
              </a>{" "}
              e baixe <code>Tavinho_x.y.z.apk</code> (Android 8 ou mais novo).
            </li>
            <li>Abra o arquivo e permita “instalar apps desconhecidos” se o Android pedir.</li>
            <li>No app, digite o código de pareamento (gere aqui ao lado) e conceda as permissões: microfone, notificações, acessibilidade e leitura de notificações.</li>
          </ol>
          <p className="muted text-xs">Com o celular pareado, o Tavinho cria alarmes e timers, faz ligações (com confirmação), lê suas notificações, abre apps e opera a tela.</p>
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
