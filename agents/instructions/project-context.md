---
description: BibleLM project context
applyTo: "/home/sanjeev/Downloads/bibleLM/**/*.{ts,tsx,js,jsx,py,md}"
---

# BibleLM

**Stack:** Next.js 15 App Router, TypeScript, React, Tailwind, Supabase, Python  
**Core:** Full-stack biblical research LLM with RAG (semantic search + LLM chat)

## Key Dirs

- `app/` — Next.js + API handlers
- `components/` — UI (Chat, Message, TranslationSelect)
- `lib/` — Retrieval, morphology, translations
- `scripts/` — Build, security checks
- `data/` — Indexes + morphology

## Before Shipping

- `./scripts/security/security-check.sh`
- `./scripts/security/supply-chain-check.sh`
- `npm run type-check` (strict: true required)

## For Current Work

See `local-docs/` for sprint-specific context.
