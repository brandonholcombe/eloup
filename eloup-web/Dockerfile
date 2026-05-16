# syntax=docker/dockerfile:1.6
# bholcombe/eloup-web — Next.js 15 App Router + better-sqlite3
# Multi-stage build. AMD64 only (matches architecture.image_arch symbol).
# Runtime stage matches K8s/statefulset-web.yaml: UID 1000, fsGroup 1000, port 3000.

FROM --platform=linux/amd64 node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
# Build deps for better-sqlite3 native binding.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile || pnpm install

FROM --platform=linux/amd64 node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM --platform=linux/amd64 node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The node base image already ships a `node` user at UID/GID 1000 — reuse
# it instead of creating another at the same UID (matches K8s securityContext
# runAsUser: 1000 + fsGroup: 1000).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/lib/db/migrations ./lib/db/migrations
USER node
EXPOSE 3000
ENTRYPOINT ["tini", "--", "node", "server.js"]
