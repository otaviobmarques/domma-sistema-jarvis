// Tavinho — HUD animado (protótipo "Tavinho · Assistente pessoal").
// Cor por estado: aguardando = ciano · ouvindo = azul · falando = verde · executando = violeta · alerta = vermelho
(function () {
  const CORES = {
    "": [34, 211, 238],
    ouvindo: [59, 130, 246],
    falando: [16, 185, 129],
    pensando: [167, 139, 250],
    erro: [239, 68, 68],
  };
  const ROTULOS = { "": "AGUARDANDO COMANDO", ouvindo: "OUVINDO…", falando: "FALANDO", pensando: "EXECUTANDO", erro: "ALERTA" };
  const VELOC = { "": 1, ouvindo: 1.6, falando: 1.8, pensando: 3.2, erro: 0.6 };

  const cv = document.getElementById("tavinho");
  const onda = document.getElementById("onda");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const octx = onda?.getContext("2d");
  let modo = "";
  const cor = [...CORES[""]];
  let vel = 1;
  let nivelAlvo = 0;
  let nivel = 0;
  let pulso = 0;
  let giro = 0;
  let ultimo = 0;
  const barras = Array.from({ length: 46 }, () => Math.random());

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function ajustar(c) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, c.clientWidth);
    const h = Math.max(20, c.clientHeight);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
  }

  function arco(cx, r, a0, a1, w, estilo, glow = 0) {
    ctx.beginPath();
    ctx.arc(cx, cx, r, a0, a1);
    ctx.strokeStyle = estilo;
    ctx.lineWidth = w;
    ctx.shadowColor = estilo;
    ctx.shadowBlur = glow;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function quadro(ts) {
    const dt = Math.min(0.05, (ts - ultimo) / 1000 || 0.016);
    ultimo = ts;
    ajustar(cv);
    const W = cv.width;
    const c = W / 2;
    const t = ts / 1000;

    const alvo = CORES[modo] || CORES[""];
    for (let i = 0; i < 3; i++) cor[i] += (alvo[i] - cor[i]) * 0.08;
    vel += ((VELOC[modo] ?? 1) - vel) * 0.05;
    nivel += (nivelAlvo - nivel) * 0.3;
    pulso *= 0.9;
    giro += dt * vel;
    const forca = Math.min(1, nivel + pulso * 0.6);

    ctx.clearRect(0, 0, W, W);
    ctx.lineCap = "round";

    // brilho de fundo
    const g = ctx.createRadialGradient(c, c, W * 0.1, c, c, W * 0.5);
    g.addColorStop(0, rgba(cor, 0.16 + forca * 0.18));
    g.addColorStop(1, rgba(cor, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, W);

    // mira (linhas finas)
    ctx.strokeStyle = rgba([34, 211, 238], 0.18);
    ctx.lineWidth = Math.max(1, W * 0.0015);
    ctx.beginPath();
    ctx.moveTo(c, 0);
    ctx.lineTo(c, W * 0.2);
    ctx.moveTo(c, W * 0.8);
    ctx.lineTo(c, W);
    ctx.moveTo(0, c);
    ctx.lineTo(W * 0.2, c);
    ctx.moveTo(W * 0.8, c);
    ctx.lineTo(W, c);
    ctx.stroke();

    // anel externo fino + segmentos grossos girando devagar
    arco(c, W * 0.485, 0, Math.PI * 2, Math.max(1, W * 0.0015), rgba(cor, 0.22));
    const segs = [
      [0.15, 0.55, 0.012, 0.85],
      [0.9, 1.25, 0.012, 0.45],
      [1.6, 2.35, 0.006, 0.7],
      [2.8, 3.05, 0.016, 0.35],
      [3.5, 4.3, 0.006, 0.75],
      [4.7, 5.0, 0.016, 0.35],
      [5.4, 5.9, 0.008, 0.6],
    ];
    for (const [a0, a1, w, al] of segs) arco(c, W * 0.455, a0 + giro * 0.12, a1 + giro * 0.12, W * w, rgba(cor, al), W * 0.01);

    // anel de marcações
    const n = 120;
    const rot = -giro * 0.05;
    ctx.lineWidth = Math.max(1, W * 0.003);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rot;
      const longo = i % 5 === 0;
      const r1 = W * 0.405;
      const r2 = r1 + W * (longo ? 0.03 : 0.018);
      ctx.strokeStyle = rgba(cor, longo ? 0.75 : 0.4);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
      ctx.stroke();
    }

    // anel tracejado (gira ao contrário)
    ctx.save();
    ctx.setLineDash([W * 0.012, W * 0.012]);
    arco(c, W * 0.385, giro * -0.2, giro * -0.2 + Math.PI * 2, Math.max(1, W * 0.002), rgba(cor, 0.45));
    ctx.restore();

    // arcos brilhantes (reagem à voz)
    const rb = W * (0.345 + forca * 0.02);
    const brilhantes = [
      [-1.2, -0.3],
      [0.35, 1.0],
      [1.7, 2.5],
      [3.1, 3.5],
      [4.0, 4.9],
    ];
    for (const [a0, a1] of brilhantes) arco(c, rb, a0 + giro * 0.35, a1 + giro * 0.35, W * (0.009 + forca * 0.006), rgba(cor, 0.95), W * 0.03);

    // anel pontilhado violeta
    const pts = 72;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2 + giro * 0.08;
      const r = W * 0.305;
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, W * 0.0035, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(139,92,246,${0.45 + 0.35 * Math.sin(t * 2 + i)})`;
      ctx.fill();
    }

    // disco central
    const rd = W * (0.27 + forca * 0.012 + Math.sin(t * 1.4) * 0.003);
    const gd = ctx.createRadialGradient(c, c, rd * 0.2, c, c, rd);
    gd.addColorStop(0, "rgba(14,52,78,0.95)");
    gd.addColorStop(1, "rgba(8,30,48,0.95)");
    ctx.fillStyle = gd;
    ctx.beginPath();
    ctx.arc(c, c, rd, 0, Math.PI * 2);
    ctx.fill();
    arco(c, rd, 0, Math.PI * 2, Math.max(1, W * 0.003), rgba(cor, 0.7 + forca * 0.3), W * 0.02);

    // marcas em cruz no disco
    ctx.strokeStyle = rgba(cor, 0.5);
    ctx.lineWidth = Math.max(1, W * 0.002);
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * rd, c + Math.sin(a) * rd);
      ctx.lineTo(c + Math.cos(a) * (rd + W * 0.04), c + Math.sin(a) * (rd + W * 0.04));
      ctx.stroke();
    }

    // onda lateral
    if (octx && onda.offsetParent !== null) {
      ajustar(onda);
      const OW = onda.width;
      const OH = onda.height;
      octx.clearRect(0, 0, OW, OH);
      const nb = barras.length;
      const bw = OW / nb;
      for (let i = 0; i < nb; i++) {
        const env = Math.sin((i / (nb - 1)) * Math.PI);
        barras[i] += (Math.random() - barras[i]) * 0.12;
        const ativo = 0.12 + forca * 0.9;
        const h = OH * (0.08 + env * ativo * (0.4 + barras[i] * 0.6));
        octx.fillStyle = rgba(cor, 0.35 + env * 0.5);
        octx.fillRect(i * bw + bw * 0.2, (OH - h) / 2, bw * 0.55, h);
      }
    }

    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);

  function estado(m) {
    modo = m in CORES ? m : "";
    const hud = document.getElementById("tela-main");
    if (hud) hud.className = "hud" + (modo ? " m-" + modo : "") + (hud.hidden ? "" : "");
    const rotulo = document.querySelector("#estado-atual span");
    if (rotulo) rotulo.textContent = ROTULOS[modo];
    for (const el of document.querySelectorAll("#estados span")) el.classList.toggle("on", el.dataset.m === modo);
  }
  estado("");

  window.Tavinho = {
    estado,
    nivel: (v) => (nivelAlvo = Math.max(0, Math.min(1, Number(v) || 0))),
    pulso: () => (pulso = 1),
  };
})();
