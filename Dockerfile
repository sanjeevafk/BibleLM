# =============================================================================
# BibleLM — Production Dockerfile
# Multi-stage build: deps → builder → runner
#
# Final image is based on Alpine Linux and only contains the minimal set of
# files output by Next.js "standalone" mode — no node_modules, no source.
#
# Build:
#   docker build --build-arg GROQ_API_KEY=<key> -t biblelm .
#
# Run:
#   docker run -p 3000:3000 --env-file .env.local biblelm
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: deps — install production dependencies only
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps

# libc6-compat is required for certain native Node addons on Alpine
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy manifests first so Docker layer-caching skips npm install when unchanged
COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
# Stage 2: builder — compile TypeScript, run data scripts, produce Next build
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Copy ALL dependencies (including devDependencies) needed to build
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source
COPY . .

# Pre-process data bundles (morphology, translations, opengnt, etc.)
# These produce the JSON files under data/ that are bundled into the build.
# If data/ is already populated (e.g. checked into git) you can comment these out.
RUN npm run build:morphhb
RUN npm run build:openhebrewbible
RUN npm run build:translations
RUN npm run build:opengnt

# Build the Next.js app in standalone mode
# NEXT_TELEMETRY_DISABLED silences the anonymous telemetry prompt
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Pre-compute the BM25 search-engine state so cold starts are <10ms at runtime
RUN npx ts-node --project tsconfig.scripts.json scripts/build-retrieval-index.ts

# -----------------------------------------------------------------------------
# Stage 3: runner — minimal production image
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Security: run as non-root
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Bind to all interfaces inside the container; the host port is mapped via -p
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy the self-contained server bundle produced by Next.js standalone output.
# This includes the minimal node_modules required to run — nothing more.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static   ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public         ./public

# Copy the pre-built data bundles (BM25 state, Bible index, morphology, etc.)
# These are read at runtime by the retrieval engine.
COPY --from=builder --chown=nextjs:nodejs /app/data ./data

USER nextjs

EXPOSE 3000

# Start the standalone Next.js server (no next start needed)
CMD ["node", "server.js"]
