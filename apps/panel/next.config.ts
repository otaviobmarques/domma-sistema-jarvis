import type { NextConfig } from "next";

const brain = (process.env.BRAIN_URL ?? "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  // áudio de voz do chat vai por server action (até ~2 min de fala)
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // O fluxo OAuth do Google é tratado pelo cérebro, mas fica no mesmo domínio do painel.
  async rewrites() {
    return [
      { source: "/oauth/:path*", destination: `${brain}/oauth/:path*` },
      // API do app de PC (pareamento, long-polling, voz)
      { source: "/device/:path*", destination: `${brain}/device/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
