# Cérebro do Jarvis — build a partir da raiz do repositório (npm workspaces)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/brain/package.json apps/brain/
COPY apps/panel/package.json apps/panel/
RUN npm ci --workspace @jarvis/brain --include-workspace-root=false
COPY apps/brain apps/brain
RUN npm run build --workspace @jarvis/brain && npm prune --omit=dev --workspace @jarvis/brain

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/brain/package.json ./apps/brain/package.json
COPY --from=build /app/apps/brain/dist ./apps/brain/dist
WORKDIR /app/apps/brain
EXPOSE 8080
CMD ["node", "dist/index.js"]
