import { ContaForm, PinForm } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const NIVEIS = [
  { n: 1, nome: "Assistido", desc: "Pergunta antes de qualquer ação que muda algo. Bom para as primeiras semanas." },
  { n: 2, nome: "Padrão", desc: "Age sozinho em leitura e tarefas internas; confirma envios, exclusões e dinheiro." },
  { n: 3, nome: "Total", desc: "Faz tudo sozinho; só pede você em dinheiro, exclusão e mensagens para fora." },
  { n: 4, nome: "Total sem travas", desc: "Não pergunta nada (exceto PIN + voz). Só o dono liga, e desliga sozinho após o tempo definido." },
];

export default async function Configuracoes() {
  const u = await requireUser();
  const [row] = await sql<{ autonomia: number; autonomia_total_ate: Date | null; horario_silencio_inicio: string; horario_silencio_fim: string; whatsapp: string | null }[]>`
    select autonomia, autonomia_total_ate, horario_silencio_inicio::text, horario_silencio_fim::text, whatsapp from users where id = ${u.id}`;
  const r = row!;
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="title">Autonomia e conta</h1>
      <ContaForm>
        <div className="card space-y-3">
          <div className="font-medium">Nível de autonomia</div>
          {NIVEIS.filter((n) => n.n < 4 || u.perfil === "dono").map((n) => (
            <label key={n.n} className="flex gap-2 text-sm items-start">
              <input type="radio" name="autonomia" value={n.n} defaultChecked={r.autonomia === n.n} className="mt-1" />
              <span>
                <b>
                  {n.n}. {n.nome}
                </b>{" "}
                — <span className="muted">{n.desc}</span>
              </span>
            </label>
          ))}
          {u.perfil === "dono" && (
            <label className="text-sm flex items-center gap-2">
              Nível 4 desliga sozinho após
              <input name="horas_total" type="number" step="0.25" min="0.25" max="12" defaultValue={2} className="input max-w-[6rem]" /> horas
              {r.autonomia === 4 && r.autonomia_total_ate && <span className="muted">(ativo até {r.autonomia_total_ate.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" })})</span>}
            </label>
          )}
          <p className="muted text-xs">Em qualquer nível continuam ativos: histórico de tudo, botão de pânico e a regra de nunca obedecer ordens escondidas em e-mails, sites ou documentos.</p>
        </div>
        <div className="card space-y-2">
          <div className="font-medium">WhatsApp e horário de silêncio</div>
          <label className="text-sm block">
            Seu WhatsApp (DDI + DDD + número)
            <input name="whatsapp" defaultValue={r.whatsapp ?? ""} className="input mt-1 max-w-xs" placeholder="5531999998888" />
          </label>
          <div className="flex gap-2 items-center text-sm">
            Sem avisos das
            <input name="silencio_inicio" type="time" defaultValue={r.horario_silencio_inicio?.slice(0, 5)} className="input max-w-[8rem]" />
            às
            <input name="silencio_fim" type="time" defaultValue={r.horario_silencio_fim?.slice(0, 5)} className="input max-w-[8rem]" />
          </div>
          <p className="muted text-xs">Alertas críticos passam mesmo no horário de silêncio.</p>
        </div>
        <button className="btn">Salvar</button>
      </ContaForm>

      <div className="card space-y-2">
        <div className="font-medium">PIN de confirmação</div>
        <p className="muted text-sm">Usado para ações sensíveis (orçamento de anúncio, exclusões). Nunca é guardado em texto.</p>
        <PinForm userId={u.id} label={u.tem_pin ? "Trocar PIN" : "Definir PIN"} />
      </div>
    </div>
  );
}
