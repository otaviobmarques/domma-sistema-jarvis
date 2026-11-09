import { painelAcesso, painelRemoverAcesso, usuarioAtivo } from "@/app/actions";
import { ActionButton, FormWithResult, PinForm, UsuarioForm } from "@/components/client";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Matriz de permissões (seção 10 do documento) — é o que o cérebro aplica.
const MATRIZ: [string, string, string, string, string][] = [
  ["Consultar dados da própria área", "Sim", "Sim", "Sim", "Sim"],
  ["Consultar todas as empresas", "Sim", "Liberadas", "Não", "Não"],
  ["Enviar mensagem a terceiros", "Confirmar", "Confirmar", "Confirmar", "Não"],
  ["Alterar orçamento de anúncio", "PIN", "Não", "Não", "Não"],
  ["Apagar arquivos ou dados", "PIN", "Não", "Não", "Não"],
  ["Pagamentos / bancos", "PIN + voz", "Não", "Não", "Não"],
  ["Controlar PC / Android", "Sim", "Próprios", "Próprios", "Não"],
  ["Editar memória e skills", "Sim", "Próprias", "Não", "Não"],
  ["Gerenciar usuários", "Sim", "Não", "Não", "Não"],
];

function Campos({ u, empresas, sel }: { u?: any; empresas: { id: string; nome: string }[]; sel: string[] }) {
  return (
    <>
      {u && <input type="hidden" name="id" value={u.id} />}
      <div className="grid md:grid-cols-4 gap-2">
        <input name="nome" defaultValue={u?.nome} className="input" placeholder="Nome" required />
        <select name="perfil" defaultValue={u?.perfil ?? "operador"} className="input">
          <option value="dono">Dono (super admin)</option>
          <option value="gestor">Gestor</option>
          <option value="operador">Operador</option>
          <option value="loja">Franqueado / loja</option>
        </select>
        <input name="whatsapp" defaultValue={u?.whatsapp ?? ""} className="input" placeholder="WhatsApp: 5531999998888" />
        <input name="email" defaultValue={u?.email ?? ""} className="input" placeholder="E-mail" />
      </div>
      <div className="flex gap-3 flex-wrap text-sm">
        <span className="muted">Empresas liberadas:</span>
        {empresas.map((c) => (
          <label key={c.id} className="flex items-center gap-1">
            <input type="checkbox" name="empresas" value={c.id} defaultChecked={sel.includes(c.id)} /> {c.nome}
          </label>
        ))}
      </div>
    </>
  );
}

export default async function Usuarios() {
  const me = await requireUser(["dono", "gestor"]);
  const dono = me.perfil === "dono";
  const [users, empresas, links, tentativas] = await Promise.all([
    sql<any[]>`select id, nome, perfil, whatsapp, email, ativo, autonomia, pausado, pin_hash is not null as tem_pin, auth_user_id is not null as tem_login,
               case when auth_user_id is not null then painel_login(auth_user_id) end as login_email
               from users where tenant_id = ${me.tenant_id} order by perfil, nome`,
    sql<{ id: string; nome: string }[]>`select id, nome from companies where tenant_id = ${me.tenant_id} order by nome`,
    sql<{ user_id: string; company_id: string }[]>`select uc.* from user_companies uc join users u on u.id = uc.user_id where u.tenant_id = ${me.tenant_id}`,
    dono ? sql<any[]>`select remetente, conteudo, data from blocked_attempts order by data desc limit 10` : Promise.resolve([]),
  ]);
  const sel = (id: string) => links.filter((l) => l.user_id === id).map((l) => l.company_id);

  return (
    <div className="space-y-6">
      <h1 className="title">Usuários e permissões</h1>
      <p className="muted text-sm">O Jarvis só obedece números de WhatsApp cadastrados aqui. Cada pessoa tem um perfil e uma lista de empresas liberadas.</p>

      <div className="space-y-2">
        {users.map((u) => (
          <div key={u.id} className="card space-y-2">
            <div className="flex justify-between gap-2 flex-wrap text-sm">
              <div>
                <b>{u.nome}</b> <span className="tag">{u.perfil}</span> {!u.ativo && <span className="tag">inativo</span>} {u.pausado && <span className="tag">pausado</span>}{" "}
                <span className="tag">{u.tem_pin ? "PIN ok" : "sem PIN"}</span> <span className="tag">autonomia {u.autonomia}</span>
                {u.tem_login && <span className="tag">acessa o painel</span>}
              </div>
              {dono && u.id !== me.id && <ActionButton label={u.ativo ? "Desativar" : "Ativar"} action={usuarioAtivo.bind(null, u.id, !u.ativo)} />}
            </div>
            {dono ? (
              <>
                <UsuarioForm>
                  <Campos u={u} empresas={empresas} sel={sel(u.id)} />
                  <button className="btn btn-ghost">Salvar</button>
                </UsuarioForm>
                <PinForm userId={u.id} label={u.tem_pin ? "Trocar PIN" : "Definir PIN"} />
                {u.id !== me.id && (
                  <details className="text-sm">
                    <summary className="cursor-pointer muted">
                      {u.tem_login ? `Acesso ao painel: ${String(u.login_email ?? "").replace(/@jarvis\.local$/, "")}` : "Dar acesso ao painel"}
                    </summary>
                    <div className="mt-2 space-y-2">
                      <FormWithResult action={painelAcesso} className="flex flex-wrap gap-2 items-center">
                        <input type="hidden" name="id" value={u.id} />
                        <input
                          name="login"
                          className="input max-w-[14rem]"
                          placeholder="login (ex.: maria) ou e-mail"
                          defaultValue={u.login_email ? String(u.login_email).replace(/@jarvis\.local$/, "") : (u.email ?? "")}
                          required
                        />
                        <input name="senha" type="password" className="input max-w-[14rem]" placeholder="senha provisória" autoComplete="new-password" required />
                        <button className="btn btn-ghost">{u.tem_login ? "Redefinir senha" : "Criar acesso"}</button>
                      </FormWithResult>
                      <p className="muted text-xs">A pessoa entra em jarvis.dommasistemas.com.br com esse login e a senha provisória, e é obrigada a criar a própria senha. Ela vê só as próprias tarefas e as empresas liberadas.</p>
                      {u.tem_login && <ActionButton label="Remover acesso ao painel" confirmText={`Remover o acesso de ${u.nome} ao painel?`} action={painelRemoverAcesso.bind(null, u.id)} />}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <div className="muted text-sm">
                {u.whatsapp ?? "sem WhatsApp"} · {empresas.filter((c) => sel(u.id).includes(c.id)).map((c) => c.nome).join(", ") || "nenhuma empresa"}
              </div>
            )}
          </div>
        ))}
      </div>

      {dono && (
        <div className="card space-y-2">
          <div className="font-medium">Novo usuário</div>
          <UsuarioForm>
            <Campos empresas={empresas} sel={[]} />
            <button className="btn">Cadastrar</button>
          </UsuarioForm>
          <p className="muted text-xs">Depois de cadastrar, peça para a pessoa mandar “oi” para o número do Jarvis. Para ela usar o painel, abra o cadastro dela e clique em “Dar acesso ao painel”.</p>
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="font-medium mb-2">Matriz de permissões</div>
        <table className="t">
          <thead>
            <tr>
              <th>Ação</th>
              <th>Dono</th>
              <th>Gestor</th>
              <th>Operador</th>
              <th>Loja</th>
            </tr>
          </thead>
          <tbody>
            {MATRIZ.map((r) => (
              <tr key={r[0]}>
                {r.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dono && tentativas.length > 0 && (
        <div className="card">
          <div className="font-medium mb-2">Números não cadastrados que tentaram falar com o Jarvis</div>
          <ul className="text-sm space-y-1">
            {tentativas.map((t, i) => (
              <li key={i}>
                +{t.remetente} <span className="muted">— {new Date(t.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}: {String(t.conteudo ?? "").slice(0, 80)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
