import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Dispositivos() {
  const u = await requireUser();
  const [devices, fila] = await Promise.all([
    sql<{ id: string; tipo: string; nome: string; status: string; ultimo_contato: Date | null }[]>`
      select id, tipo, nome, status, ultimo_contato from devices where user_id = ${u.id} order by tipo, nome`,
    sql<{ id: string; recurso: string; status: string; prioridade: string; payload: any; criado_em: Date }[]>`
      select q.id, q.recurso, q.status, q.prioridade, q.payload, q.criado_em from task_queue q
      join tasks t on t.id = q.task_id where t.user_id = ${u.id} order by q.criado_em desc limit 30`,
  ]);
  return (
    <div className="space-y-6">
      <h1 className="title">Dispositivos</h1>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="card text-sm space-y-1">
          <b>💻 App PC (Fase 2)</b>
          <p className="muted">Voz com “Jarvis…”, transcrição local, ações no PC, navegador automatizado e controle de tela. Pareamento por QR Code aqui.</p>
        </div>
        <div className="card text-sm space-y-1">
          <b>📱 App Android (Fase 3)</b>
          <p className="muted">Serviço de Acessibilidade, leitura de notificações, alarmes, ligações e mensagens.</p>
        </div>
      </div>
      <div className="card overflow-x-auto">
        <div className="font-medium mb-2">Pareados</div>
        {devices.length ? (
          <table className="t">
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.tipo === "pc" ? "💻" : "📱"} {d.nome}</td>
                  <td>
                    <span className="tag">{d.status}</span>
                  </td>
                  <td className="muted">{d.ultimo_contato?.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) ?? "nunca"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted text-sm">Nenhum dispositivo pareado ainda.</p>
        )}
      </div>
      <div className="card overflow-x-auto">
        <div className="font-medium mb-2">Fila de tarefas de tela</div>
        {fila.length ? (
          <table className="t">
            <tbody>
              {fila.map((q) => (
                <tr key={q.id}>
                  <td>{q.payload?.instrucao}</td>
                  <td>
                    <span className="tag">{q.recurso}</span> <span className="tag">{q.prioridade}</span>
                  </td>
                  <td>
                    <span className="tag">{q.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted text-sm">Fila vazia.</p>
        )}
      </div>
    </div>
  );
}
