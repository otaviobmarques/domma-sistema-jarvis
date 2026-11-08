"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  adicionarFonte,
  aprovar,
  chat,
  definirPin,
  googleLink,
  panico,
  progresso,
  recusar,
  retomar,
  rotinaRodar,
  salvarConta,
  salvarChave,
  salvarGoogleOAuth,
  salvarMeta,
  usuarioSalvar,
  whatsappLogout,
  whatsappStatus,
  whatsappTeste,
} from "@/app/actions";

function Msg({ m }: { m?: { ok: boolean; msg?: string } | null }) {
  if (!m?.msg) return null;
  return <p className={`text-sm whitespace-pre-wrap ${m.ok ? "text-green-600" : "text-red-600"}`}>{m.msg}</p>;
}

// ------------------------------------------------------------------ pânico
export function PanicButton({ pausado, dono }: { pausado: boolean; dono: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  if (pausado) {
    return (
      <div className="space-y-1">
        <div className="text-xs text-amber-600">⏸️ Jarvis pausado</div>
        <button className="btn w-full justify-center" disabled={pending} onClick={() => start(async () => void (await retomar(dono)))}>
          Retomar
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <button
        className="btn btn-danger w-full justify-center"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!confirm(dono ? "Parar TODAS as ações de todos os usuários agora?" : "Parar todas as suas ações agora?")) return;
            setMsg((await panico(dono)).msg);
          })
        }
      >
        ⛔ Parar tudo
      </button>
      {msg && <div className="text-xs muted">{msg}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ chat
type Linha = { autor: "user" | "assistant"; texto: string };

export function Chat({ inicial }: { inicial: Linha[] }) {
  const [linhas, setLinhas] = useState<Linha[]>(inicial);
  const [texto, setTexto] = useState("");
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  const [passos, setPassos] = useState<string[]>([]);
  useEffect(() => {
    if (!pending) {
      setPassos([]);
      return;
    }
    const t = setInterval(() => void progresso().then(setPassos).catch(() => {}), 1200);
    return () => clearInterval(t);
  }, [pending]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [linhas]);

  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    setTexto("");
    setLinhas((l) => [...l, { autor: "user", texto: t }]);
    start(async () => {
      const r = await chat(t);
      setLinhas((l) => [...l, { autor: "assistant", texto: r.resposta }]);
    });
  };

  return (
    <div className="card flex flex-col h-[28rem]">
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {linhas.length === 0 && <p className="muted text-sm">Fale com o Jarvis. Ex.: “resume meus e-mails de hoje”, “como foram as campanhas da semana?”</p>}
        {linhas.map((l, i) => (
          <div key={i} className={`flex ${l.autor === "user" ? "justify-end" : ""}`}>
            <div
              className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%]"
              style={l.autor === "user" ? { background: "var(--accent)", color: "white" } : { background: "var(--bg)" }}
            >
              {l.texto}
            </div>
          </div>
        ))}
        {pending && (
          <div className="muted text-sm space-y-0.5">
            {passos.map((p, i) => (
              <div key={i}>{p}</div>
            ))}
            <div>Jarvis está {passos.length ? "trabalhando" : "pensando"}…</div>
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <input className="input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escreva um pedido…" disabled={pending} />
        <button className="btn" disabled={pending || !texto.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ aprovações
export function Approval({ id, resumo, nivel }: { id: string; resumo: string; nivel: string }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card space-y-2">
      <div className="text-sm whitespace-pre-wrap">{resumo}</div>
      <div className="flex gap-2 items-center flex-wrap">
        {nivel !== "confirmar" && (
          <input className="input max-w-[9rem]" inputMode="numeric" maxLength={6} placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        )}
        <button className="btn" disabled={pending || (nivel !== "confirmar" && pin.length !== 6)} onClick={() => start(async () => setMsg(await aprovar(id, pin || undefined)))}>
          Confirmar
        </button>
        <button className="btn btn-ghost" disabled={pending} onClick={() => start(async () => setMsg(await recusar(id)))}>
          Cancelar
        </button>
        <span className="tag">{nivel === "confirmar" ? "confirmação" : nivel === "pin" ? "PIN" : "PIN + voz"}</span>
      </div>
      <Msg m={msg} />
    </div>
  );
}

// ------------------------------------------------------------------ WhatsApp
export function WhatsAppPanel() {
  const [st, setSt] = useState<{ conectado: boolean; qr: string | null; numero: string | null; erro?: string } | null>(null);
  const [img, setImg] = useState<string>();
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = await whatsappStatus();
      if (!alive) return;
      setSt(s);
      setImg(s.qr ? await QRCode.toDataURL(s.qr, { width: 260, margin: 1 }) : undefined);
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!st) return <p className="muted text-sm">Carregando…</p>;
  if (st.erro) return <p className="text-sm text-red-600">Cérebro indisponível: {st.erro}</p>;
  if (st.conectado)
    return (
      <div className="space-y-2">
        <p className="text-sm">
          ✅ Conectado como <b>+{st.numero}</b>
        </p>
        <div className="flex gap-2">
          <button className="btn btn-ghost" disabled={pending} onClick={() => start(async () => setMsg(await whatsappTeste()))}>
            Enviar teste para mim
          </button>
          <button
            className="btn btn-ghost"
            disabled={pending}
            onClick={() => start(async () => void (confirm("Desconectar o número do Jarvis?") && setMsg(await whatsappLogout())))}
          >
            Desconectar
          </button>
        </div>
        <Msg m={msg} />
      </div>
    );
  return (
    <div className="space-y-2">
      <p className="text-sm">
        No celular do <b>número dedicado do Jarvis</b>: WhatsApp → Aparelhos conectados → Conectar um aparelho → aponte para o código.
      </p>
      {img ? <img src={img} alt="QR Code do WhatsApp" width={260} height={260} className="rounded bg-white p-2" /> : <p className="muted text-sm">Gerando QR Code…</p>}
      <p className="text-xs muted">⚠️ Conexão por QR Code é para testes e uso pessoal; para produção use a API Oficial da Meta.</p>
    </div>
  );
}

export function GoogleOAuthForm({ configurado }: { configurado: boolean }) {
  const [f, setF] = useState({ id: "", secret: "" });
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {configurado && <p className="text-sm">✅ Credenciais do Google configuradas no servidor</p>}
      <div className="grid md:grid-cols-2 gap-2">
        <input className="input" placeholder="ID do cliente (….apps.googleusercontent.com)" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.trim() })} />
        <input className="input" type="password" autoComplete="off" placeholder="Chave secreta do cliente (GOCSPX-…)" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value.trim() })} />
      </div>
      <button
        className="btn btn-ghost"
        disabled={pending || !f.id || !f.secret}
        onClick={() =>
          start(async () => {
            setMsg(await salvarGoogleOAuth(f.id, f.secret));
            setF({ id: "", secret: "" });
          })
        }
      >
        Salvar credenciais
      </button>
      <Msg m={msg} />
    </div>
  );
}

export function GoogleConnect({ conectado }: { conectado: string | null }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3">
      {conectado && <span className="text-sm">✅ {conectado}</span>}
      <button className="btn" disabled={pending} onClick={() => start(async () => void (window.location.href = await googleLink()))}>
        {conectado ? "Reconectar" : "Conectar conta Google"}
      </button>
    </div>
  );
}

export function MetaForm({ configurado }: { configurado: boolean }) {
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {configurado && <p className="text-sm">✅ Token configurado</p>}
      <div className="flex gap-2">
        <input className="input" type="password" placeholder="Token de acesso (System User) da Meta" value={token} onChange={(e) => setToken(e.target.value)} />
        <button className="btn" disabled={pending || token.length < 20} onClick={() => start(async () => setMsg(await salvarMeta(token)))}>
          Salvar
        </button>
      </div>
      <Msg m={msg} />
    </div>
  );
}

export function KeyForm({ tipo, configurado, placeholder }: { tipo: "anthropic" | "stt"; configurado: boolean; placeholder: string }) {
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {configurado && <p className="text-sm">✅ Configurada</p>}
      <div className="flex gap-2">
        <input className="input" type="password" autoComplete="off" placeholder={placeholder} value={key} onChange={(e) => setKey(e.target.value.trim())} />
        <button
          className="btn"
          disabled={pending || key.length < 20}
          onClick={() =>
            start(async () => {
              setMsg(await salvarChave(tipo, key));
              setKey("");
            })
          }
        >
          {pending ? "Validando…" : "Salvar"}
        </button>
      </div>
      <Msg m={msg} />
    </div>
  );
}

export function FonteForm() {
  const [f, setF] = useState({ nome: "", descricao: "", url: "" });
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <div className="grid md:grid-cols-3 gap-2">
        <input className="input" placeholder="Nome (ex.: Domma Chat)" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
        <input className="input" placeholder="O que tem lá (ex.: conversas e atendimentos)" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        <input className="input" type="password" placeholder="postgresql://usuario_leitura:senha@host:5432/postgres" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      </div>
      <button className="btn" disabled={pending || !f.nome || !f.url} onClick={() => start(async () => setMsg(await adicionarFonte(f.nome, f.descricao, f.url)))}>
        Testar e conectar
      </button>
      <p className="text-xs muted">Use um usuário de banco somente leitura. O Jarvis sempre consulta em modo READ ONLY.</p>
      <Msg m={msg} />
    </div>
  );
}

export function PinForm({ userId, label = "Definir PIN" }: { userId: string; label?: string }) {
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2 items-center flex-wrap">
      <input className="input max-w-[10rem]" type="password" inputMode="numeric" maxLength={6} placeholder="6 dígitos" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      <button
        className="btn btn-ghost"
        disabled={pending || pin.length !== 6}
        onClick={() =>
          start(async () => {
            setMsg(await definirPin(userId, pin));
            setPin("");
          })
        }
      >
        {label}
      </button>
      <Msg m={msg} />
    </div>
  );
}

export function FormWithResult({ action, children, className }: { action: (f: FormData) => Promise<{ ok: boolean; msg?: string }>; children: React.ReactNode; className?: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => setMsg(await action(fd)));
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      <Msg m={msg} />
    </form>
  );
}

export const ContaForm = (p: { children: React.ReactNode }) => <FormWithResult action={salvarConta} className="space-y-3">{p.children}</FormWithResult>;
export const UsuarioForm = (p: { children: React.ReactNode }) => <FormWithResult action={usuarioSalvar} className="space-y-2">{p.children}</FormWithResult>;

export function RunRoutine({ id }: { id: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button className="btn btn-ghost" disabled={pending} onClick={() => start(async () => setMsg(await rotinaRodar(id)))}>
        {pending ? "Executando…" : "Rodar agora"}
      </button>
      <Msg m={msg} />
    </div>
  );
}

/** Botão que chama uma server action, com confirmação opcional. */
export function ActionButton({ action, label, confirmText, className = "btn btn-ghost" }: { action: () => Promise<unknown>; label: string; confirmText?: string; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button className={className} disabled={pending} onClick={() => start(async () => void ((!confirmText || confirm(confirmText)) && (await action())))}>
      {label}
    </button>
  );
}
