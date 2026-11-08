# Painel web do Jarvis — build a partir da raiz do repositório (npm workspaces)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/brain/package.json apps/brain/
COPY apps/panel/package.json apps/panel/
COPY apps/pc/package.json apps/pc/
RUN npm ci --workspace @jarvis/panel --include-workspace-root=false
COPY apps/panel apps/panel
ENV NEXT_TELEMETRY_DISABLED=1
# Os rewrites (/oauth → cérebro) são resolvidos no build: o Railway passa a variável como build arg
ARG BRAIN_URL
ENV BRAIN_URL=$BRAIN_URL
RUN npm run build --workspace @jarvis/panel

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/panel/.next/standalone ./
COPY --from=build /app/apps/panel/.next/static ./apps/panel/.next/static
COPY --from=build /app/apps/panel/public ./apps/panel/public
EXPOSE 3000
CMD ["node", "apps/panel/server.js"]
