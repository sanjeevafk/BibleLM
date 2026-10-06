# =============================================================================
# BibleLM — self-hosted image (Vite client + Hono Worker run under workerd)
#
# The app is Cloudflare-Worker-native, so the container serves it with
# `wrangler dev` (local workerd). Production on Cloudflare uses `wrangler deploy`.
#
# Build:  docker build -t biblelm .
# Run:    docker run -p 8787:8787 --env-file .env.local biblelm
#
# Notes:
#  - Secrets come from the environment (CLOUDFLARE_INCLUDE_PROCESS_ENV=true makes
#    wrangler expose process env vars to the Worker). Never bake them in.
#  - The Workers AI binding needs Cloudflare credentials, so neural re-ranking is
#    disabled here (ENABLE_NEURAL_RERANK=0). Everything else works offline.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: builder — install deps, build data bundles + client, precompute BM25
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `npm run build` runs the data-bundle scripts, then `vite build` -> dist/client
RUN npm run build

# Pre-compute BM25 state so cold starts hydrate in <10ms
RUN npx ts-node --project tsconfig.scripts.json scripts/build-retrieval-index.ts

# -----------------------------------------------------------------------------
# Stage 2: runner — workerd needs wrangler (a devDependency) at runtime
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat libstdc++

WORKDIR /app

ENV NODE_ENV=production
ENV CLOUDFLARE_INCLUDE_PROCESS_ENV=true
ENV WRANGLER_SEND_METRICS=false
ENV ENABLE_NEURAL_RERANK=0

COPY --from=builder --chown=node:node /app /app

# Writable dir for wrangler's local state/logs when running non-root
RUN mkdir -p /app/.wrangler /home/node/.config && chown -R node:node /app/.wrangler /home/node

USER node

EXPOSE 8787

CMD ["npx", "wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8787", "--var", "ENABLE_NEURAL_RERANK:0"]
