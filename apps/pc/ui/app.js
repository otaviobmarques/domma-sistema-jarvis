// Janela do Jarvis no PC. Fala com o núcleo em Rust via window.__TAURI__.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
let estado = {};
let ocupado = false;

// ------------------------------------------------------------------ esfera / legenda
function orb(modo, legenda) {
  $("orb").className = "orb " + (modo || "");
  if (legenda !== undefined) $("legenda").textContent = legenda;
}

function addMsg(quem, texto) {
  const d = document.createElement("div");
  d.className = "msg " + quem;
  d.textContent = texto.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
  $("conversa").appendChild(d);
  $("conversa").scrollTop = $("conversa").scrollHeight;
}

// ------------------------------------------------------------------ voz (resposta falada)
function vozPtBr() {
  const vozes = speechSynthesis.getVoices();
  return vozes.find((v) => v.lang === "pt-BR" && /Francisca|Antonio|Thalita|Natural/i.test(v.name)) || vozes.find((v) => v.lang.startsWith("pt"));
}
function falar(texto) {
  if (!estado.falar_respostas || !("speechSynthesis" in window)) return orb("", "Pronto.");
  const limpo = texto.replace(/\*+/g, "").replace(/https?:\/\/\S+/g, "link").replace(/[#_`>|]/g, "").slice(0, 1200);
  const u = new SpeechSynthesisUtterance(limpo);
  u.lang = "pt-BR";
  const v = vozPtBr();
  if (v) u.voice = v;
  u.rate = 1.05;
  u.onstart = () => orb("falando");
  u.onend = () => orb("", "Pronto.");
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ------------------------------------------------------------------ conversa
async function enviar(texto, voz = false) {
  texto = texto.trim();
  if (!texto || ocupado) return;
  ocupado = true;
  speechSynthesis.cancel();
  addMsg("eu", texto);
  orb("pensando", "Pensando…");
  try {
    const r = await invoke("conversar", { texto, voz });
    const resposta = r.resposta || "Feito.";
    addMsg("jarvis", resposta);
    $("legenda").textContent = "";
    falar(resposta);
  } catch (e) {
    orb("erro", String(e));
    addMsg("jarvis", "⚠️ " + e);
  } finally {
    ocupado = false;
    $("acao-atual").hidden = true;
  }
}

$("form-chat").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("texto").value;
  $("texto").value = "";
  enviar(t);
});

// ------------------------------------------------------------------ microfone
let gravando = false;
async function alternarMic() {
  if (ocupado && !gravando) return;
  if (!gravando) {
    try {
      speechSynthesis.cancel();
      await invoke("gravar_inicio");
      gravando = true;
      $("btn-mic").classList.add("gravando");
      orb("ouvindo", "Ouvindo… clique de novo (ou Ctrl+Shift+Espaço) para enviar.");
    } catch (e) {
      orb("erro", String(e));
    }
    return;
  }
  gravando = false;
  $("btn-mic").classList.remove("gravando");
  orb("pensando", "Transcrevendo…");
  try {
    const texto = await invoke("gravar_fim");
    if (!texto) return orb("erro", "Não entendi. Pode repetir?");
    enviar(texto, true);
  } catch (e) {
    orb("erro", String(e));
  }
}
$("btn-mic").addEventListener("click", alternarMic);

// ------------------------------------------------------------------ pânico
$("btn-panico").addEventListener("click", async () => {
  speechSynthesis.cancel();
  try {
    await invoke("panico");
    orb("erro", "⛔ Parei tudo. Reative pelo painel ou mande /retomar.");
  } catch (e) {
    orb("erro", String(e));
  }
});

// ------------------------------------------------------------------ pareamento
$("form-parear").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("btn-parear").disabled = true;
  $("erro-parear").textContent = "";
  try {
    const usuario = await invoke("parear", { servidor: $("servidor").value, codigo: $("codigo").value, nome: $("nome-pc").value });
    await carregar();
    addMsg("jarvis", `Pronto, ${usuario.split(" ")[0]}! Este PC está conectado. Pode me pedir coisas por aqui, pela voz ou pelo WhatsApp.`);
  } catch (err) {
    $("erro-parear").textContent = String(err);
  } finally {
    $("btn-parear").disabled = false;
  }
});

// ------------------------------------------------------------------ configurações
$("btn-config").addEventListener("click", () => {
  $("pref-falar").checked = !!estado.falar_respostas;
  $("pref-privacidade").checked = !!estado.privacidade;
  $("info-conta").textContent = `${estado.nome} · ${estado.usuario || ""} · ${estado.servidor} · v${estado.versao}`;
  $("dlg-config").showModal();
});
$("btn-fechar-config").addEventListener("click", async () => {
  await invoke("preferencias", { privacidade: $("pref-privacidade").checked, falarRespostas: $("pref-falar").checked });
  $("dlg-config").close();
  await carregar();
});
$("btn-desparear").addEventListener("click", async () => {
  if (!confirm("Desconectar este PC do Jarvis?")) return;
  await invoke("desparear");
  $("dlg-config").close();
  await carregar();
});

// ------------------------------------------------------------------ eventos do núcleo
const NOMES = { abrir: "abrindo", arquivos: "mexendo em arquivos", apagar: "apagando", comando: "rodando comando", janelas: "olhando as janelas", print: "olhando a tela", mouse: "usando o mouse", teclado: "digitando" };
listen("acao", (e) => {
  const a = e.payload.acao;
  $("acao-atual").hidden = false;
  $("acao-atual").textContent = "🖐 " + (NOMES[a] || a) + (e.payload.params?.alvo ? `: ${e.payload.params.alvo}` : "");
});
listen("acao_fim", () => setTimeout(() => ($("acao-atual").hidden = true), 1200));
listen("conexao", (e) => {
  const s = e.payload;
  $("status").className = "status " + s;
  $("status").querySelector("em").textContent = s === "online" ? "conectado" : s === "offline" ? "sem conexão" : "desconectado";
  if (s === "desconectado") carregar();
});
listen("foco", () => setTimeout(() => $("texto").focus(), 50));
listen("falar", () => alternarMic());
listen("parado", () => orb("erro", "⛔ Parei tudo."));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("dlg-config").open) invoke("esconder");
});

// ------------------------------------------------------------------ início
async function carregar() {
  estado = await invoke("estado");
  $("tela-parear").hidden = estado.pareado;
  $("tela-main").hidden = !estado.pareado;
  if (!estado.pareado) {
    $("servidor").value = estado.servidor;
    $("nome-pc").value = estado.nome;
    $("codigo").focus();
  } else {
    orb("", estado.privacidade ? "Modo privacidade: microfone desligado." : "Diga ou escreva o que precisa.");
    $("btn-mic").disabled = !!estado.privacidade;
    $("texto").focus();
  }
}
speechSynthesis.onvoiceschanged = () => {};
carregar();
