// Janela do Tavinho no PC. Fala com o núcleo em Rust via window.__TAURI__.
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
  if (dormindo) orb("", dicaPalavra());
  else if (emConversa) {
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
    u.rate = Math.min(2, velocidade() + 0.1);
    u.onboundary = () => window.Tavinho?.pulso();
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
// ---- velocidade da fala (⚙): 1.0 normal · padrão 1.15
function velocidade() {
  try {
    return Number(localStorage.getItem("velocidade-fala")) || 1.15;
  } catch {
    return 1.15;
  }
}

// ---- fila de fala: as frases entram conforme chegam do cérebro e são faladas em ordem
let fila = [];
let filaFechada = true;
let falandoLoop = false;
let idFala = 0;
function deveFalar() {
  // com a palavra de ativação, só fala sozinho a resposta de um pedido feito por voz
  return estado.falar_respostas || (emConversa && (!modoPalavra || pedidoPorVoz));
}
function falarFrase(frase) {
  if (!deveFalar() || !frase.trim()) return;
  fila.push({ frase, audio: null });
  // já pede a síntese desta frase (enquanto a anterior ainda toca)
  const item = fila[fila.length - 1];
  item.audio = invoke("sintetizar", { texto: frase, velocidade: Math.min(1.2, velocidade()) }).catch(() => null);
  if (!falandoLoop) processarFila();
}
async function processarFila() {
  falandoLoop = true;
  const id = idFala;
  orb("falando");
  if (emConversa && !dormindo) invoke("conversa_modo", { modo: "falando" });
  while (id === idFala) {
    const item = fila.shift();
    if (!item) {
      if (filaFechada) break;
      await new Promise((r) => setTimeout(r, 40));
      continue;
    }
    const r = await item.audio;
    if (id !== idFala) break;
    if (r && r.audio) await tocar(r.audio, r.mime || "audio/mpeg", filaFala);
    else await falarWindows(item.frase, filaFala);
  }
  falandoLoop = false;
  if (id === idFala) {
    audioAtual = null;
    window.Tavinho?.nivel(0);
    voltarAOuvir();
  }
}
function cancelarFila() {
  idFala++;
  fila = [];
  filaFechada = true;
  pararFala();
}
// compatibilidade: falar um texto inteiro de uma vez
function falar(texto) {
  if (!deveFalar()) return voltarAOuvir();
  cancelarFila();
  filaFechada = false;
  for (const f of frases(texto)) falarFrase(f);
  filaFechada = true;
}

// ---- recebe a resposta aos poucos e fala cada frase assim que fica completa
let bufferFala = "";
let textoAoVivo = "";
listen("fala_delta", (e) => {
  const d = e.payload || "";
  textoAoVivo += d;
  $("legenda").textContent = textoAoVivo.replace(/\*+/g, "");
  bufferFala += d;
  // frase completa: termina em . ! ? … ou quebra de linha, com pelo menos ~12 caracteres
  let m;
  while ((m = bufferFala.match(/^([\s\S]{12,}?[.!?…:](?=\s)|[^\n]{3,}\n)/))) {
    falarFrase(m[1].trim());
    bufferFala = bufferFala.slice(m[1].length);
  }
});

async function enviar(texto, voz = false) {
  texto = texto.trim();
  if (!texto || ocupado) return;
  ocupado = true;
  pedidoPorVoz = voz;
  cancelarFila();
  addMsg("eu", texto);
  orb("pensando", "Pensando…");
  bufferFala = "";
  textoAoVivo = "";
  filaFechada = false;
  try {
    const r = await invoke("conversar_stream", { texto, voz });
    const resposta = r.resposta || textoAoVivo || "Feito.";
    if (bufferFala.trim()) falarFrase(bufferFala.trim());
    bufferFala = "";
    // se nada veio em streaming (ex.: confirmação), fala a resposta inteira
    if (!textoAoVivo.trim()) for (const f of frases(resposta)) falarFrase(f);
    filaFechada = true;
    addMsg("jarvis", resposta);
    if (!deveFalar()) voltarAOuvir();
  } catch (e) {
    filaFechada = true;
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
let modoPalavra = false; // conversa iniciada pela palavra de ativação (escuta contínua)
let dormindo = false; // esperando "Tavinho" (só o reconhecimento local ouve)
let pedidoPorVoz = false;
function dicaPalavra() {
  return `Diga “${nomeAssistente()}” quando precisar.`;
}
// A palavra de ativação reconhece "Tavinho" (o modelo de voz local foi ajustado para esse nome).
function palavraPossivel() {
  return !!estado.ativacao_instalada && !estado.privacidade && nomeAssistente().toLowerCase() === "tavinho";
}
function palavraLigada() {
  return !!estado.palavra_ativacao && palavraPossivel();
}
function bip() {
  try {
    ctxAudio ??= new AudioContext();
    const o = ctxAudio.createOscillator();
    const g = ctxAudio.createGain();
    o.frequency.setValueAtTime(660, ctxAudio.currentTime);
    o.frequency.linearRampToValueAtTime(990, ctxAudio.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, ctxAudio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ctxAudio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + 0.22);
    o.connect(g).connect(ctxAudio.destination);
    o.start();
    o.stop(ctxAudio.currentTime + 0.25);
  } catch {}
}
function rotuloConversa() {
  if (!emConversa) return `🎙️ Conversar com o ${nomeAssistente()}`;
  if (modoPalavra) return dormindo ? `🎙️ Chamar o ${nomeAssistente()}` : "💤 Pôr para dormir";
  return "⏹ Encerrar conversa";
}
function atualizarBotaoConversa() {
  $("btn-conversa").classList.toggle("ativa", emConversa && !dormindo);
  $("btn-conversa").textContent = rotuloConversa();
}
async function iniciarEscuta() {
  if (emConversa || !palavraLigada()) return;
  try {
    await invoke("conversa_iniciar", { palavra: true });
    emConversa = true;
    modoPalavra = true;
    dormindo = true;
    atualizarBotaoConversa();
    orb("", dicaPalavra());
    medirNivel();
  } catch (e) {
    modoPalavra = false;
    orb("erro", String(e));
  }
}
async function pararEscuta() {
  if (!emConversa) return;
  emConversa = false;
  modoPalavra = false;
  dormindo = false;
  cancelarFila();
  await invoke("conversa_parar");
  atualizarBotaoConversa();
}
function dormir() {
  dormindo = true;
  cancelarFila();
  invoke("conversa_modo", { modo: "esperando" });
  atualizarBotaoConversa();
  orb("", dicaPalavra());
}
let medindo = false;
async function medirNivel() {
  if (medindo) return;
  medindo = true;
  while (emConversa || gravando) {
    const n = await invoke("nivel_mic").catch(() => 0);
    window.Tavinho?.nivel(dormindo ? 0 : n);
    await new Promise((r) => setTimeout(r, 60));
  }
  window.Tavinho?.nivel(0);
  medindo = false;
}
async function alternarConversa() {
  if (emConversa && modoPalavra) {
    if (dormindo) {
      // chamar sem falar a palavra (botão ou atalho)
      dormindo = false;
      invoke("conversa_modo", { modo: "ouvindo" });
      atualizarBotaoConversa();
      bip();
      orb("ouvindo", "Pode falar…");
    } else dormir();
    return;
  }
  if (emConversa) {
    emConversa = false;
    cancelarFila();
    await invoke("conversa_parar");
    $("btn-conversa").classList.remove("ativa");
    $("btn-conversa").textContent = `🎙️ Conversar com o ${nomeAssistente()}`;
    orb("", "Conversa encerrada.");
    return;
  }
  try {
    await invoke("conversa_iniciar");
    emConversa = true;
    $("btn-conversa").classList.add("ativa");
    $("btn-conversa").textContent = "⏹ Encerrar conversa";
    orb("ouvindo", `Pode falar… (diga “${nomeAssistente()}, para” para encerrar)`);
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
  cancelarFila();
  orb("ouvindo", "Ouvindo…");
});
listen("conversa_erro", (e) => {
  orb("erro", String(e.payload));
  setTimeout(voltarAOuvir, 1500);
});
listen("conversa_ativada", () => {
  dormindo = false;
  cancelarFila();
  atualizarBotaoConversa();
  bip();
  orb("ouvindo", "Oi! Pode falar…");
});
listen("conversa_dormiu", () => {
  dormindo = true;
  atualizarBotaoConversa();
  orb("", dicaPalavra());
});
listen("conversa_fim", () => {
  modoPalavra = false;
  dormindo = false;
  if (emConversa) {
    emConversa = false;
    $("btn-conversa").classList.remove("ativa");
    $("btn-conversa").textContent = `🎙️ Conversar com o ${nomeAssistente()}`;
  }
});
listen("conversa_texto", async (e) => {
  const texto = e.payload.texto;
  const nm = nomeAssistente().toLowerCase();
  const t2 = texto.trim().toLowerCase().replace(/[.!?,]/g, "");
  const chamada = new RegExp(`^((jarvis|${nm})\\s*)?(para|pare|chega|encerra|encerrar|tchau|pode parar)$`);
  if (chamada.test(t2) || t2 === `obrigado ${nm}` || t2 === "obrigado jarvis") {
    addMsg("eu", texto);
    if (modoPalavra) return dormir();
    return alternarConversa();
  }
  await enviar(texto, true);
});

// ------------------------------------------------------------------ pânico
$("btn-panico").addEventListener("click", async () => {
  speechSynthesis.cancel();
  try {
    cancelarFila();
    if (emConversa) {
      if (modoPalavra) await pararEscuta();
      else await alternarConversa();
    }
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
let nomeDoCerebro = null; // fonte da verdade: preferência salva no cérebro
function nomeAssistente() {
  if (nomeDoCerebro) return nomeDoCerebro;
  try {
    return localStorage.getItem("nome-assistente") || "Tavinho";
  } catch {
    return "Tavinho";
  }
}
function aplicarNome() {
  const n = nomeAssistente();
  $("nome-assistente").textContent = n.toUpperCase();
  document.title = `${n} by Domma Tecnologia`;
  if (!emConversa) $("btn-conversa").textContent = `🎙️ Conversar com o ${n}`;
  $("btn-sair").textContent = `⏻ Sair do ${n}`;
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
    if (c.usuario?.nome_assistente) {
      nomeDoCerebro = c.usuario.nome_assistente;
      aplicarNome();
    }
    if (c.usuario?.pausado) {
      mostrarPausado(true);
      orb("erro", `⏸ O ${nomeAssistente()} está pausado. Clique em Retomar para voltar.`);
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
  if (confirm(`Fechar o ${nomeAssistente()}? Ele deixa de responder neste PC até você abrir de novo.`)) await invoke("sair");
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
  $("pref-velocidade").value = String(velocidade());
  $("val-velocidade").textContent = velocidade().toFixed(2) + "x";
  $("pref-falar").checked = !!estado.falar_respostas;
  $("pref-privacidade").checked = !!estado.privacidade;
  $("pref-palavra").checked = !!estado.palavra_ativacao;
  $("pref-palavra").disabled = !estado.ativacao_instalada;
  $("info-palavra").textContent = !estado.ativacao_instalada
    ? "Não instalada nesta versão do app."
    : nomeAssistente().toLowerCase() !== "tavinho"
      ? "Funciona só com o nome Tavinho."
      : "O áudio fica no PC até você dizer “Tavinho”.";
  $("info-conta").textContent = `${estado.nome} · ${estado.usuario || ""} · ${estado.servidor} · v${estado.versao}`;
  $("dlg-config").showModal();
});
$("pref-velocidade").addEventListener("input", () => ($("val-velocidade").textContent = Number($("pref-velocidade").value).toFixed(2) + "x"));
$("btn-testar-voz").addEventListener("click", () => {
  try {
    localStorage.setItem("velocidade-fala", $("pref-velocidade").value);
  } catch {}
  const antes = estado.falar_respostas;
  estado.falar_respostas = true;
  falar(`Oi, eu sou o ${nomeAssistente()}. É assim que eu falo agora.`);
  estado.falar_respostas = antes;
});
$("btn-fechar-config").addEventListener("click", async () => {
  try {
    localStorage.setItem("velocidade-fala", $("pref-velocidade").value);
  } catch {}
  const novoNome = $("pref-nome").value.trim() || "Tavinho";
  try {
    localStorage.setItem("nome-assistente", novoNome);
  } catch {}
  if (novoNome !== nomeAssistente()) {
    try {
      const r = await invoke("definir_nome", { nome: novoNome });
      nomeDoCerebro = r.nome_assistente || novoNome;
    } catch {
      nomeDoCerebro = novoNome;
    }
    aplicarNome();
  }
  await invoke("preferencias", { privacidade: $("pref-privacidade").checked, falarRespostas: $("pref-falar").checked, palavraAtivacao: $("pref-palavra").checked });
  $("dlg-config").close();
  if (modoPalavra && !($("pref-palavra").checked && !$("pref-privacidade").checked)) await pararEscuta();
  await carregar();
});
$("btn-desparear").addEventListener("click", async () => {
  if (!confirm(`Desconectar este PC do ${nomeAssistente()}?`)) return;
  await invoke("desparear");
  $("dlg-config").close();
  await carregar();
});

// ------------------------------------------------------------------ Modo Tavinho (tela cheia)
let cheia = false;
async function alternarTelaCheia() {
  cheia = !cheia;
  document.body.classList.toggle("cheia", cheia);
  await invoke("tela_cheia", { ligar: cheia }).catch(() => {});
}
$("btn-cheia").addEventListener("click", alternarTelaCheia);
$("tavinho").addEventListener("dblclick", alternarTelaCheia);

// ------------------------------------------------------------------ câmera (visão)
listen("capturar_camera", async () => {
  const aviso = $("acao-atual");
  aviso.hidden = false;
  aviso.textContent = `📷 ${nomeAssistente()} está olhando a câmera…`;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    const v = document.createElement("video");
    v.srcObject = stream;
    v.muted = true;
    await v.play();
    await new Promise((r) => setTimeout(r, 700)); // tempo para a câmera ajustar a luz
    const w = Math.min(1280, v.videoWidth || 1280);
    const h = Math.round(w * ((v.videoHeight || 720) / (v.videoWidth || 1280)));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(v, 0, 0, w, h);
    const dados = c.toDataURL("image/jpeg", 0.8).split(",")[1];
    await invoke("camera_resultado", { ok: true, dados });
  } catch (e) {
    await invoke("camera_resultado", { ok: false, dados: "Não consegui usar a câmera: " + (e?.message || e) });
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    setTimeout(() => (aviso.hidden = true), 1500);
  }
});

// ------------------------------------------------------------------ eventos do núcleo
const NOMES = { camera: "olhando a câmera", abrir: "abrindo", arquivos: "mexendo em arquivos", apagar: "apagando", comando: "rodando comando", janelas: "olhando as janelas", print: "olhando a tela", mouse: "usando o mouse", teclado: "digitando" };
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
    if (palavraLigada()) iniciarEscuta();
    else if (modoPalavra) pararEscuta();
  }
}
speechSynthesis.onvoiceschanged = () => {};
carregar();
setInterval(() => estado.pareado && verificarAtualizacao(), 6 * 3600 * 1000);
