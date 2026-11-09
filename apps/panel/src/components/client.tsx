"use client";

import QRCode from "qrcode";
import { Icon } from "./icons";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  adicionarFonte,
  aprovar,
  chat,
  definirPin,
  gerarCodigoPareamento,
  googleLink,
  panico,
  progresso,
  transcrever,
  recusar,
  retomar,
  rotinaRodar,
  salvarConta,
  salvarChave,
  sintetizarFala,
  vozesDisponiveis,
  escolherVoz,
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
      <div className="space-y-2 rounded-xl p-3" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
        <div className="text-xs font-medium text-amber-300">⏸ Jarvis pausado</div>
        <button className="btn w-full" disabled={pending} onClick={() => start(async () => void (await retomar(dono)))}>
          <Icon name="play" size={14} /> Retomar
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <button
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition"
        style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.35)" }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!confirm(dono ? "Parar TODAS as ações de todos os usuários agora?" : "Parar todas as suas ações agora?")) return;
            setMsg((await panico(dono)).msg);
          })
        }
      >
        <Icon name="stop" size={16} /> Parar tudo
      </button>
      {msg && <div className="text-xs" style={{ color: "var(--side-ink)" }}>{msg}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ chat
type Linha = { autor: "user" | "assistant"; texto: string };

const SUGESTOES = [
  { icon: "mail", texto: "Resume meus e-mails importantes de hoje" },
  { icon: "calendar", texto: "Como está minha agenda amanhã?" },
  { icon: "clock", texto: "Acha um horário livre de 1h nesta semana" },
  { icon: "chart", texto: "Como foram as campanhas da Meta nos últimos 7 dias?" },
];

/** Formata *negrito* (estilo WhatsApp) e **negrito** (markdown) nas respostas. */
function Rico({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2)}</b> : /^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

function Orb({ thinking = false, size = 32 }: { thinking?: boolean; size?: number }) {
  return (
    <div className={`orb rounded-full shrink-0 grid place-items-center ${thinking ? "thinking" : ""}`} style={{ width: size, height: size }}>
      <img src="/logo.svg" alt="" width={size * 0.62} height={size * 0.62} style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.2))", borderRadius: 6 }} />
    </div>
  );
}

export function Chat({ inicial, nome }: { inicial: Linha[]; nome?: string }) {
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
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [linhas, passos]);

  // ---------------------------------------------------------------- voz
  const [falar, setFalar] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [erroVoz, setErroVoz] = useState<string>();
  const rec = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);

  useEffect(() => {
    try {
      setFalar(localStorage.getItem("jarvis-falar") === "1");
    } catch {}
  }, []);
  useEffect(() => {
    if (!gravando) return;
    setSegundos(0);
    const t = setInterval(() => setSegundos((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  const alternarFala = () => {
    const v = !falar;
    setFalar(v);
    if (!v) {
      window.speechSynthesis?.cancel();
      audioRef.current?.pause();
    }
    try {
      localStorage.setItem("jarvis-falar", v ? "1" : "0");
    } catch {}
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dizer = async (t: string) => {
    if (!falar) return;
    audioRef.current?.pause();
    const r = await sintetizarFala(t).catch(() => ({ erro: "x" }) as { erro: string });
    if ("audio" in r && r.audio) {
      const a = new Audio(`data:${r.mime ?? "audio/mpeg"};base64,${r.audio}`);
      audioRef.current = a;
      void a.play().catch(() => {});
      return;
    }
    if (!("speechSynthesis" in window)) return;
    const limpo = t.replace(/\*+/g, "").replace(/[#_`>]/g, "").replace(/https?:\/\/\S+/g, "link").slice(0, 1500);
    const u = new SpeechSynthesisUtterance(limpo);
    u.lang = "pt-BR";
    const voz = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("pt-BR"));
    if (voz) u.voice = voz;
    u.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const gravar = async () => {
    setErroVoz(undefined);
    if (gravando) {
      rec.current?.stop();
      return;
    }
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const tipo = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const r = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      pedacos.current = [];
      r.ondataavailable = (e) => e.data.size && pedacos.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        const blob = new Blob(pedacos.current, { type: r.mimeType || "audio/webm" });
        if (blob.size < 2000) return setErroVoz("Não captei nada. Segure o botão um pouco mais.");
        setTranscrevendo(true);
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const res = await transcrever(btoa(bin), blob.type);
        setTranscrevendo(false);
        if (res.erro || !res.texto) return setErroVoz(res.erro ?? "Não entendi. Pode repetir?");
        enviar(res.texto);
      };
      rec.current = r;
      r.start();
      setGravando(true);
      // limite de segurança: 2 minutos
      setTimeout(() => r.state === "recording" && r.stop(), 120_000);
    } catch {
      setErroVoz("Não consegui acessar o microfone. Libere a permissão no navegador.");
    }
  };

  const enviar = (valor?: string) => {
    const t = (valor ?? texto).trim();
    if (!t || pending) return;
    setTexto("");
    setLinhas((l) => [...l, { autor: "user", texto: t }]);
    start(async () => {
      const r = await chat(t);
      setLinhas((l) => [...l, { autor: "assistant", texto: r.resposta }]);
      dizer(r.resposta);
    });
  };

  return (
    <div className="card !p-0 flex flex-col h-[34rem] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor: "var(--line)" }}>
        <Orb thinking={pending} size={34} />
        <div className="flex-1">
          <div className="font-semibold text-sm">Jarvis</div>
          <div className="text-xs muted flex items-center gap-1.5">
            <span className="dot" style={{ background: pending ? "#f59e0b" : "#10b981" }} />
            {pending ? (passos.length ? "trabalhando…" : "pensando…") : "pronto"}
          </div>
        </div>
        <button
          type="button"
          onClick={alternarFala}
          title={falar ? "Respostas faladas: ligado" : "Respostas faladas: desligado"}
          className="pill hover:bg-black/5"
          style={falar ? { color: "var(--accent)", borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
        >
          <Icon name={falar ? "volume" : "mute"} size={15} />
          <span className="hidden sm:inline">{falar ? "Voz ligada" : "Voz desligada"}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {linhas.length === 0 && (
          <div className="min-h-full flex flex-col items-center justify-center text-center gap-4">
            <Orb size={56} />
            <div>
              <div className="font-semibold">Como posso ajudar{nome ? `, ${nome}` : ""}?</div>
              <div className="muted text-sm">Peça qualquer coisa: e-mails, agenda, campanhas, lembretes…</div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGESTOES.map((s) => (
                <button key={s.texto} className="chip flex items-center gap-2" onClick={() => enviar(s.texto)}>
                  <span style={{ color: "var(--accent)" }}>
                    <Icon name={s.icon} size={16} />
                  </span>
                  {s.texto}
                </button>
              ))}
            </div>
          </div>
        )}
        {linhas.map((l, i) =>
          l.autor === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="bubble-user px-4 py-2.5 text-sm whitespace-pre-wrap max-w-[80%]">{l.texto}</div>
            </div>
          ) : (
            <div key={i} className="flex gap-2.5 items-end">
              <Orb size={26} />
              <div className="bubble-bot px-4 py-2.5 text-sm whitespace-pre-wrap max-w-[80%] leading-relaxed">
                <Rico texto={l.texto} />
              </div>
            </div>
          ),
        )}
        {pending && (
          <div className="flex gap-2.5 items-end">
            <Orb size={26} thinking />
            <div className="bubble-bot px-4 py-2.5 text-sm space-y-1">
              {passos.map((p, i) => (
                <div key={i} className="muted text-xs">
                  {p}
                </div>
              ))}
              <div className="flex gap-1 py-1">
                <span className="dot animate-bounce" style={{ background: "var(--muted)" }} />
                <span className="dot animate-bounce [animation-delay:150ms]" style={{ background: "var(--muted)" }} />
                <span className="dot animate-bounce [animation-delay:300ms]" style={{ background: "var(--muted)" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      {erroVoz && <div className="px-4 pb-1 text-xs text-red-600">{erroVoz}</div>}

      <form
        className="flex gap-2 items-end p-3 border-t"
        style={{ borderColor: "var(--line)" }}
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <button
          type="button"
          onClick={gravar}
          disabled={pending || transcrevendo}
          title={gravando ? "Parar e enviar" : "Falar com o Jarvis"}
          className={`h-[38px] px-3 rounded-[0.65rem] inline-flex items-center gap-1.5 text-sm font-semibold border transition shrink-0 ${gravando ? "animate-pulse" : ""}`}
          style={
            gravando
              ? { background: "#dc2626", color: "white", borderColor: "#dc2626" }
              : { background: "var(--card)", color: "var(--accent)", borderColor: "var(--line)" }
          }
        >
          <Icon name="mic" size={16} />
          {gravando && <span>{`${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`}</span>}
        </button>
        <textarea
          className="input resize-none"
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
          placeholder={gravando ? "Ouvindo… clique no microfone para enviar" : transcrevendo ? "Transcrevendo…" : "Escreva ou fale um pedido… (Enter envia)"}
        />
        <button className="btn !px-3 h-[38px]" disabled={pending || !texto.trim()} title="Enviar">
          <Icon name="send" size={16} />
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

export function KeyForm({ tipo, configurado, placeholder }: { tipo: "anthropic" | "stt" | "tts"; configurado: boolean; placeholder: string }) {
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

// ------------------------------------------------------------------ pareamento do PC
export function ParearPc() {
  const [cod, setCod] = useState<{ codigo?: string; expira_em?: string; erro?: string } | null>(null);
  const [resta, setResta] = useState(0);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!cod?.expira_em) return;
    const fim = new Date(cod.expira_em).getTime();
    const t = setInterval(() => setResta(Math.max(0, Math.round((fim - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [cod]);
  return (
    <div className="space-y-3">
      {cod?.codigo && resta > 0 ? (
        <div className="rounded-xl p-4 text-center space-y-1" style={{ background: "var(--accent-soft)" }}>
          <div className="muted text-xs">Digite este código no app do Tavinho (PC ou celular)</div>
          <div className="text-4xl font-bold tracking-[0.3em]" style={{ fontFamily: "ui-monospace, monospace", color: "var(--accent)" }}>
            {cod.codigo}
          </div>
          <div className="muted text-xs">
            válido por {Math.floor(resta / 60)}:{String(resta % 60).padStart(2, "0")}
          </div>
        </div>
      ) : (
        <button className="btn" disabled={pending} onClick={() => start(async () => setCod(await gerarCodigoPareamento()))}>
          <Icon name="devices" size={16} /> Gerar código de pareamento
        </button>
      )}
      {cod?.erro && <p className="text-sm text-red-600">{cod.erro}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ escolha da voz natural
export function VozSelect({ atual }: { atual: string | null }) {
  const [vozes, setVozes] = useState<{ id: string; nome: string; descricao: string; preview: string | null }[] | null>(null);
  const [sel, setSel] = useState(atual ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    void vozesDisponiveis().then(setVozes);
  }, []);
  if (!vozes) return <p className="muted text-sm">Carregando vozes…</p>;
  if (!vozes.length) return null;
  const atualV = vozes.find((v) => v.id === sel);
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap items-center">
        <select className="input max-w-sm" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">Escolha uma voz…</option>
          {vozes.map((v) => (
            <option key={v.id} value={v.id}>
              {v.nome}
              {v.descricao ? ` — ${v.descricao}` : ""}
            </option>
          ))}
        </select>
        {atualV?.preview && (
          <button type="button" className="btn btn-ghost" onClick={() => void new Audio(atualV.preview!).play()}>
            ▶ Ouvir
          </button>
        )}
        <button type="button" className="btn" disabled={pending || !sel} onClick={() => start(async () => setMsg(await escolherVoz(sel)))}>
          Usar esta voz
        </button>
      </div>
      <p className="muted text-xs">A prévia é em inglês; no Jarvis a voz fala português.</p>
      <Msg m={msg} />
    </div>
  );
}
