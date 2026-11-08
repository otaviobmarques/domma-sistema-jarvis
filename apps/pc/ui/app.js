// Janela do Jarvis no PC. Fala com o núcleo em Rust via window.__TAURI__.
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (id) => document.getElementById(id);
let estado = {};
let ocupado = false;

// ------------------------------------------------------------------ esfera / legenda
function orb(modo, legenda) {
  window.Tavinho?.estado(modo || "");
  if (legenda !== undefined) $("legenda").textContent = legenda;
}

function addMsg(quem, texto) {
  if (quem === "jarvis") $("legenda").textContent = texto.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
  else $("legenda").textContent = "Você: " + texto;
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
function voltarAOuvir() {
  window.Tavinho?.nivel(0);
  if (emConversa) {
    invoke("conversa_modo", { modo: "ouvindo" });
    orb("ouvindo", "Pode falar…");
  } else orb("", "Pronto.");
}
// Voz natural (ElevenLabs, pelo cérebro), frase a frase para começar a falar logo.
// Sem voz natural configurada, usa a voz do Windows.
let audioAtual = null;
let filaFala = 0; // muda a cada nova fala para cancelar a anterior
let ctxAudio = null;
function pararFala() {
  filaFala++;
  speechSynthesis.cancel();
  if (audioAtual) {
    audioAtual.pause();
    audioAtual = null;
  }
}
function frases(texto) {
  const limpo = texto.replace(/\*+/g, "").replace(/https?:\/\/\S+/g, "o link").replace(/[#_`>|]/g, "");
  const partes = limpo.match(/[^.!?\n]+[.!?]*\s*/g) || [limpo];
  const out = [];
  let atual = "";
  for (const p of partes) {
    atual += p;
    if (atual.length > (out.length ? 220 : 90)) {
      out.push(atual.trim());
      atual = "";
    }
  }
  if (atual.trim()) out.push(atual.trim());
  return out.slice(0, 12);
}
function tocar(b64, mime, id) {
  return new Promise((resolve) => {
    if (id !== filaFala) return resolve();
    const a = new Audio(`data:${mime};base64,${b64}`);
    audioAtual = a;
    try {
      ctxAudio = ctxAudio || new AudioContext();
      const src = ctxAudio.createMediaElementSource(a);
      const an = ctxAudio.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      an.connect(ctxAudio.destination);
      const dados = new Uint8Array(an.fftSize);
      const medir = () => {
        if (audioAtual !== a) return window.Tavinho?.nivel(0);
        an.getByteTimeDomainData(dados);
        let soma = 0;
        for (const v of dados) soma += ((v - 128) / 128) ** 2;
        window.Tavinho?.nivel(Math.min(1, Math.sqrt(soma / dados.length) * 4));
        requestAnimationFrame(medir);
      };
      requestAnimationFrame(medir);
    } catch {}
    a.onended = a.onerror = () => resolve();
    a.play().catch(() => resolve());
  });
}
function falarWindows(texto, id) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || id !== filaFala) return resolve();
    const u = new SpeechSynthesisUtterance(texto.replace(/\*+/g, "").slice(0, 1200));
    u.lang = "pt-BR";
    const v = vozPtBr();
    if (v) u.voice = v;
    u.rate = 1.05;
    u.onboundary = () => window.Tavinho?.pulso();
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
async function falar(texto) {
  if (!estado.falar_respostas && !emConversa) return voltarAOuvir();
  pararFala();
  const id = filaFala;
  orb("falando");
  if (emConversa) invoke("conversa_modo", { modo: "falando" });
  const lista = frases(texto);
  let proxima = invoke("sintetizar", { texto: lista[0] }).catch(() => null);
  for (let i = 0; i < lista.length; i++) {
    const r = await proxima;
    if (id !== filaFala) return;
    if (i + 1 < lista.length) proxima = invoke("sintetizar", { texto: lista[i + 1] }).catch(() => null);
    if (r && r.audio) await tocar(r.audio, r.mime || "audio/mpeg", id);
    else await falarWindows(lista[i], id);
  }
  if (id === filaFala) {
    audioAtual = null;
    window.Tavinho?.nivel(0);
    voltarAOuvir();
  }
}

// ------------------------------------------------------------------ conversa
async function enviar(texto, voz = false) {
  texto = texto.trim();
  if (!texto || ocupado) return;
  ocupado = true;
  pararFala();
  addMsg("eu", texto);
  orb("pensando", "Pensando…");
  try {
    const r = await invoke("conversar", { texto, voz });
    const resposta = r.resposta || "Feito.";
    addMsg("jarvis", resposta);
    falar(resposta);
  } catch (e) {
    orb("erro", String(e));
    addMsg("jarvis", "⚠️ " + e);
    if (emConversa) setTimeout(voltarAOuvir, 1500);
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
      medirNivel();
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

// ------------------------------------------------------------------ Modo Conversa (tempo real)
let emConversa = false;
let medindo = false;
async function medirNivel() {
  if (medindo) return;
  medindo = true;
  while (emConversa || gravando) {
    window.Tavinho?.nivel(await invoke("nivel_mic").catch(() => 0));
    await new Promise((r) => setTimeout(r, 60));
  }
  window.Tavinho?.nivel(0);
  medindo = false;
}
async function alternarConversa() {
  if (emConversa) {
    emConversa = false;
    pararFala();
    await invoke("conversa_parar");
    $("btn-conversa").classList.remove("ativa");
    $("btn-conversa").textContent = "🎙️ Conversar com o Jarvis";
    orb("", "Conversa encerrada.");
    return;
  }
  try {
    await invoke("conversa_iniciar");
    emConversa = true;
    $("btn-conversa").classList.add("ativa");
    $("btn-conversa").textContent = "⏹ Encerrar conversa";
    orb("ouvindo", "Pode falar… (diga “Jarvis, para” para encerrar)");
    medirNivel();
  } catch (e) {
    orb("erro", String(e));
  }
}
$("btn-conversa").addEventListener("click", alternarConversa);
listen("conversa_ouvindo", () => emConversa && orb("ouvindo", "Ouvindo…"));
listen("conversa_processando", () => orb("pensando", "Entendendo…"));
listen("conversa_retomou", () => emConversa && orb("ouvindo", "Pode falar…"));
listen("conversa_interrompeu", () => {
  pararFala();
  orb("ouvindo", "Ouvindo…");
});
listen("conversa_erro", (e) => {
  orb("erro", String(e.payload));
  setTimeout(voltarAOuvir, 1500);
});
listen("conversa_fim", () => {
  if (emConversa) {
    emConversa = false;
    $("btn-conversa").classList.remove("ativa");
    $("btn-conversa").textContent = "🎙️ Conversar com o Jarvis";
  }
});
listen("conversa_texto", async (e) => {
  const texto = e.payload.texto;
  if (/^(jarvis,?\s*)?(para|pare|chega|encerra|tchau|obrigado,? jarvis)[.!]?$/i.test(texto.trim())) {
    addMsg("eu", texto);
    return alternarConversa();
  }
  await enviar(texto, true);
});

// ------------------------------------------------------------------ pânico
$("btn-panico").addEventListener("click", async () => {
  speechSynthesis.cancel();
  try {
    pararFala();
    if (emConversa) await alternarConversa();
    await invoke("panico");
    orb("erro", "⛔ Parei tudo. Clique em Retomar quando quiser voltar.");
    mostrarPausado(true);
  } catch (e) {
    orb("erro", String(e));
  }
});

// ------------------------------------------------------------------ histórico e nome do assistente
$("btn-historico").addEventListener("click", () => {
  $("conversa").hidden = !$("conversa").hidden;
  $("btn-historico").textContent = $("conversa").hidden ? "Histórico" : "Fechar histórico";
  $("conversa").scrollTop = $("conversa").scrollHeight;
});
function nomeAssistente() {
  try {
    return localStorage.getItem("nome-assistente") || "Tavinho";
  } catch {
    return "Tavinho";
  }
}
function aplicarNome() {
  const n = nomeAssistente();
  $("nome-assistente").textContent = n.toUpperCase();
  const primeiro = (estado.usuario || "").replace(/\(.*?\)/g, "").trim().split(/\s+/)[0];
  $("texto").placeholder = primeiro ? `Como posso ajudar, ${primeiro}?` : "Como posso ajudar?";
}

// ------------------------------------------------------------------ pausado / retomar
function mostrarPausado(p) {
  $("btn-retomar").hidden = !p;
  $("btn-panico").hidden = p;
}
$("btn-retomar").addEventListener("click", async () => {
  try {
    await invoke("retomar");
    mostrarPausado(false);
    orb("", "Voltei. Diga ou escreva o que precisa.");
  } catch (e) {
    orb("erro", String(e));
  }
});
async function verificarConta() {
  try {
    const c = await invoke("conta");
    if (c.usuario?.pausado) {
      mostrarPausado(true);
      orb("erro", "⏸ O Jarvis está pausado. Clique em Retomar para voltar.");
    } else mostrarPausado(false);
  } catch {}
}

// ------------------------------------------------------------------ atualização
let urlNova = null;
async function verificarAtualizacao(manual = false) {
  try {
    const v = await invoke("verificar_atualizacao");
    if (v.tem_nova) {
      urlNova = v.url;
      $("v-nova").textContent = v.nova;
      $("faixa-atualizar").hidden = false;
      if (manual) $("msg-atualizar").textContent = `Versão ${v.nova} disponível.`;
    } else if (manual) $("msg-atualizar").textContent = `Você está na versão mais recente (${v.atual}).`;
  } catch (e) {
    if (manual) $("msg-atualizar").textContent = String(e);
  }
}
async function baixarAtualizacao() {
  if (!urlNova) await verificarAtualizacao(true);
  if (urlNova) {
    await invoke("abrir_link", { url: urlNova });
    orb("", "Baixe o instalador e execute: ele atualiza por cima, sem perder o pareamento.");
  }
}
$("btn-baixar").addEventListener("click", baixarAtualizacao);
$("btn-atualizar").addEventListener("click", async () => {
  $("msg-atualizar").textContent = "Verificando…";
  await verificarAtualizacao(true);
  if (urlNova) baixarAtualizacao();
});
$("btn-sair").addEventListener("click", async () => {
  if (confirm("Fechar o Jarvis? Ele deixa de responder neste PC até você abrir de novo.")) await invoke("sair");
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
  $("pref-nome").value = nomeAssistente();
  $("pref-falar").checked = !!estado.falar_respostas;
  $("pref-privacidade").checked = !!estado.privacidade;
  $("info-conta").textContent = `${estado.nome} · ${estado.usuario || ""} · ${estado.servidor} · v${estado.versao}`;
  $("dlg-config").showModal();
});
$("btn-fechar-config").addEventListener("click", async () => {
  try {
    localStorage.setItem("nome-assistente", $("pref-nome").value.trim() || "Tavinho");
  } catch {}
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

// ------------------------------------------------------------------ Modo Jarvis (tela cheia)
let cheia = false;
async function alternarTelaCheia() {
  cheia = !cheia;
  document.body.classList.toggle("cheia", cheia);
  await invoke("tela_cheia", { ligar: cheia }).catch(() => {});
}
$("btn-cheia").addEventListener("click", alternarTelaCheia);
$("tavinho").addEventListener("dblclick", alternarTelaCheia);

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
listen("falar", () => alternarConversa());
listen("parado", () => orb("erro", "⛔ Parei tudo."));

document.addEventListener("keydown", (e) => {
  if (e.key === "F11") {
    e.preventDefault();
    alternarTelaCheia();
  } else if (e.key === "Escape" && cheia) alternarTelaCheia();
  else if (e.key === "Escape" && !$("dlg-config").open) invoke("esconder");
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
    orb("", estado.privacidade ? "Modo privacidade: microfone desligado." : "");
    $("btn-mic").disabled = !!estado.privacidade;
    $("texto").focus();
    aplicarNome();
    verificarConta();
    verificarAtualizacao();
  }
}
speechSynthesis.onvoiceschanged = () => {};
carregar();
setInterval(() => estado.pareado && verificarAtualizacao(), 6 * 3600 * 1000);
