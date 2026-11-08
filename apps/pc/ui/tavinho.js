// Tavinho — a "cara" animada do Jarvis. Canvas 2D, ~60 fps, cor por estado:
// espera = roxo Domma · ouvindo = azul · pensando = violeta · falando = verde · erro = vermelho
(function () {
  const CORES = {
    "": [111, 92, 246],
    ouvindo: [59, 130, 246],
    pensando: [168, 85, 247],
    falando: [16, 185, 129],
    erro: [239, 68, 68],
  };
  const cv = document.getElementById("tavinho");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  let modo = "";
  let cor = [...CORES[""]];
  let nivelAlvo = 0;
  let nivel = 0;
  let pulso = 0;
  let energia = 0.25; // suaviza a transição de intensidade entre estados
  const particulas = Array.from({ length: 42 }, (_, i) => ({
    a: Math.random() * Math.PI * 2,
    r: 0.62 + Math.random() * 0.3,
    v: (0.15 + Math.random() * 0.35) * (i % 2 ? 1 : -1),
    t: 0.6 + Math.random() * 1.6,
  }));

  function ajustarTamanho() {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 200;
    if (cv.width !== Math.round(w * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(w * dpr);
    }
  }

  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function quadro(ts) {
    ajustarTamanho();
    const t = ts / 1000;
    const W = cv.width;
    const c = W / 2;
    const R = W * 0.22;

    // transições suaves
    const alvo = CORES[modo] || CORES[""];
    for (let i = 0; i < 3; i++) cor[i] += (alvo[i] - cor[i]) * 0.08;
    const energiaAlvo = { "": 0.25, ouvindo: 0.7, pensando: 0.85, falando: 0.9, erro: 0.5 }[modo] ?? 0.25;
    energia += (energiaAlvo - energia) * 0.05;
    nivel += (nivelAlvo - nivel) * 0.35;
    pulso *= 0.9;

    ctx.clearRect(0, 0, W, W);

    // brilho externo
    const respiro = Math.sin(t * (1.2 + energia * 2.5)) * 0.5 + 0.5;
    const brilho = ctx.createRadialGradient(c, c, R * 0.5, c, c, R * 2.3);
    brilho.addColorStop(0, rgba(cor, 0.35 + energia * 0.25));
    brilho.addColorStop(1, rgba(cor, 0));
    ctx.fillStyle = brilho;
    ctx.beginPath();
    ctx.arc(c, c, R * 2.3, 0, Math.PI * 2);
    ctx.fill();

    // onda de voz (ouvindo/falando)
    if (modo === "ouvindo" || modo === "falando" || nivel > 0.02) {
      ctx.beginPath();
      const amp = R * (0.08 + nivel * 0.5 + pulso * 0.3);
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        const ruido = Math.sin(a * 6 + t * 6) * 0.5 + Math.sin(a * 11 - t * 9) * 0.3 + Math.sin(a * 3 + t * 2) * 0.2;
        const rr = R * 1.32 + ruido * amp;
        const x = c + Math.cos(a) * rr;
        const y = c + Math.sin(a) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(cor, 0.75);
      ctx.lineWidth = W * 0.008;
      ctx.stroke();
    }

    // anéis girando
    const aneis = [
      { r: 1.55, v: 0.35, l: 1.2, w: 0.006, a: 0.55 },
      { r: 1.75, v: -0.22, l: 0.8, w: 0.004, a: 0.4 },
      { r: 1.95, v: 0.15, l: 1.7, w: 0.003, a: 0.25 },
    ];
    for (const an of aneis) {
      const giro = t * an.v * (1 + energia * 2.5);
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(c, c, R * an.r, giro + (k * Math.PI * 2) / 3, giro + (k * Math.PI * 2) / 3 + an.l);
        ctx.strokeStyle = rgba(cor, an.a * (0.6 + energia * 0.6));
        ctx.lineWidth = W * an.w;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // partículas em órbita
    for (const p of particulas) {
      p.a += p.v * 0.01 * (1 + energia * 3);
      const rr = R * (1.4 + p.r * 0.9) + Math.sin(t * p.t + p.a) * R * 0.05;
      const x = c + Math.cos(p.a) * rr;
      const y = c + Math.sin(p.a) * rr;
      ctx.beginPath();
      ctx.arc(x, y, W * 0.004 * (0.6 + p.r), 0, Math.PI * 2);
      ctx.fillStyle = rgba(cor, 0.35 + 0.4 * Math.sin(t * p.t + p.a) ** 2);
      ctx.fill();
    }

    // núcleo
    const escala = 1 + respiro * 0.04 * (1 + energia) + nivel * 0.18 + pulso * 0.08;
    const rn = R * escala;
    const g = ctx.createRadialGradient(c - rn * 0.35, c - rn * 0.4, rn * 0.05, c, c, rn);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.35, rgba(cor.map((x) => Math.min(255, x + 60)), 1));
    g.addColorStop(0.8, rgba(cor, 1));
    g.addColorStop(1, "rgba(28,19,55,1)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, rn, 0, Math.PI * 2);
    ctx.fill();

    // reflexo interno girando (pensando gira mais rápido)
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, rn, 0, Math.PI * 2);
    ctx.clip();
    const ang = t * (0.6 + energia * 2.2);
    const lg = ctx.createLinearGradient(c + Math.cos(ang) * rn, c + Math.sin(ang) * rn, c - Math.cos(ang) * rn, c - Math.sin(ang) * rn);
    lg.addColorStop(0, "rgba(255,255,255,0.18)");
    lg.addColorStop(0.5, "rgba(255,255,255,0)");
    lg.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = lg;
    ctx.fillRect(c - rn, c - rn, rn * 2, rn * 2);
    ctx.restore();

    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);

  window.Tavinho = {
    estado: (m) => (modo = m in CORES ? m : ""),
    nivel: (n) => (nivelAlvo = Math.max(0, Math.min(1, Number(n) || 0))),
    pulso: () => (pulso = 1),
  };
})();
