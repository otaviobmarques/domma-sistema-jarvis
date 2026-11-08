// Marca da Domma Tecnologia (símbolo da onda + ponto) e assinatura "Jarvis by Domma".
export const DOMMA_ROXO = "#6f5cf6";
export const DOMMA_ESCURO = "#1c1337";

export function DommaMark({ size = 40, dot = DOMMA_ESCURO, wave = DOMMA_ROXO }: { size?: number; dot?: string; wave?: string }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 640 384" aria-hidden="true">
      <path
        d="M52 250 C 100 170, 140 118, 172 118 C 214 118, 244 210, 282 286 C 300 320, 314 334, 330 334 C 346 334, 362 318, 380 284 C 420 206, 452 118, 494 118 C 528 118, 560 172, 594 250"
        fill="none"
        stroke={wave}
        strokeWidth="68"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="300" cy="62" r="50" fill={dot} />
    </svg>
  );
}

/** Logo completo: símbolo + "Domma" + "TECNOLOGIA". variant="dark" para fundos escuros. */
export function DommaLogo({ height = 40, variant = "light" }: { height?: number; variant?: "light" | "dark" }) {
  const ink = variant === "dark" ? "#ffffff" : DOMMA_ESCURO;
  return (
    <div className="inline-flex items-center" style={{ gap: height * 0.18 }}>
      <DommaMark size={height * 1.55} dot={ink} />
      <div className="leading-none" style={{ fontFamily: "var(--font-brand), var(--font-inter), sans-serif" }}>
        <div style={{ fontSize: height * 0.78, fontWeight: 800, color: ink, letterSpacing: "-0.02em" }}>Domma</div>
        <div style={{ fontSize: height * 0.25, fontWeight: 700, color: DOMMA_ROXO, letterSpacing: "0.42em", marginTop: height * 0.08 }}>TECNOLOGIA</div>
      </div>
    </div>
  );
}

/** Assinatura discreta "by Domma Tecnologia" com o símbolo. */
export function ByDomma({ dark = false, className = "" }: { dark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} style={{ color: dark ? "rgba(255,255,255,0.65)" : "var(--muted)" }}>
      <span className="text-[11px]">by</span>
      <DommaMark size={18} dot={dark ? "#ffffff" : DOMMA_ESCURO} />
      <span className="text-[11px] font-semibold tracking-wide" style={{ fontFamily: "var(--font-brand), sans-serif", color: dark ? "#ffffff" : DOMMA_ESCURO }}>
        Domma <span style={{ color: DOMMA_ROXO, letterSpacing: "0.18em", fontWeight: 700 }}>TECNOLOGIA</span>
      </span>
    </span>
  );
}
