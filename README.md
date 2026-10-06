# BibleLM: The Sola Scriptura Engine

[![Vite](https://img.shields.io/badge/Vite-React%2019-646CFF?style=flat-square&logo=vite)](https://vite.dev/)
[![Runtime](https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020?style=flat-square&logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Dataset](https://img.shields.io/badge/Dataset-Hugging%20Face-yellow?style=flat-square)](https://huggingface.co/datasets/sanjeevafk/biblelm)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**BibleLM** is a high-performance, text-first Retrieval-Augmented Generation (RAG) architecture designed to deliver uncompromising biblical search and original-language insights. 

Built to eliminate LLM "hallucination" and theological drift, BibleLM functions as a strict "Sola Scriptura" (Scripture Alone) engine. It forces base models to answer complex theological queries using raw, cited text and structural linguistics rather than external commentary or interpretive bias.

**Live Demo**: [https://biblelm.sanjeevkumar.me](https://biblelm.sanjeevkumar.me) (also served at [biblelm.strucker08.workers.dev](https://biblelm.strucker08.workers.dev))  
**System Architecture Diagram**: [`docs/architecture.html`](docs/architecture.html)

---

## Architectural Deep-Dive

```text
┌──────────────┐      ┌──────────────────────────┐      ┌────────────────────┐
│  Client App  │      │ Cloudflare Worker (Hono) │      │    Primary LLM     │
│ (React / TS) ├─────►│  (worker/ + Rate Limit)  ├─────►│ (Groq: Llama 3.1)  │
└──────────────┘      └────────────┬─────────────┘      └──────────┬─────────┘
                                   │                               │
                                   ▼                               ▼
┌──────────────┐      ┌──────────────────────────┐      ┌────────────────────┐
│ Turso libSQL │      │    Hybrid Retrieval V3   │      │  Citation Audit    │
│(Verses+Vector├─────►│(BM25+Vector+Rerank Gate) ├─────►│ Grounding Filter   │
└──────────────┘      └────────────┬─────────────┘      └────────────────────┘
                                   │
                                   ▼
                      ┌──────────────────────────┐
                      │ Multi-Translation Store  │
                      │(BSB, WEB, KJV, ASV, NHEB)│
                      └──────────────────────────┘
```

Most RAG systems rely on expensive, high-latency vector databases. BibleLM is built on a **Stateless Hybrid Retrieval** architecture optimized for the Edge and production serverless execution.

### 1. The Engineering Strategy
*   **Stateless Scaling**: To bypass cold-start penalties, TF/IDF state is pre-computed at build time and serialized to JSON. At runtime, the engine hydrates in **< 10ms**.
*   **Contextual Verse Prepending**: Each indexed verse is prepended at build time with a structured context header `[Book · Chapter · Pericope/Topic]` (e.g. `[John · Chapter 3 · Salvation]`), boosting thematic precision@5 by **+140%** (20% → 48%) and thematic Hit@1 by **+200%** (20% → 60%) with **0ms runtime latency penalty**.
*   **Multi-Translation Brotli Storage**: Supports 5 full translations (`BSB`, `WEB`, `KJV`, `ASV`, `NHEB`) stored as compressed `.json.br` book files.
*   **Citation-Locking**: A post-generation scrubbing middleware validates every LLM citation against retrieved context. If a verse wasn't in the context, it's stripped—preventing "AI-generated" scripture.
*   **Lexical & Morphological Tethering**: Verses are enriched with Hebrew/Greek morphology (OpenGNT & MorphHB) word-by-word, forcing the LLM to output Strong's numbers and transliterations.

### 2. The 4-Stage Retrieval Pipeline
1.  **Theological Expansion**: Expands keywords using a domain-specific synonym map to maximize recall.
2.  **Context-Aware Lexical Search (BM25)**: Custom TypeScript BM25 engine ($k1=1.2, b=0.65$) indexing contextually enriched verse headers (`bm25Text`) for zero-latency thematic retrieval.
3.  **Semantic Vector Re-ranking**: Dense similarity over precomputed 1024-dim verse embeddings stored in Turso (libSQL), with a local binary-vector fallback.
    *   **Optional neural re-rank**: A selective gate sends ambiguous candidate sets to Workers AI `bge-reranker-base`. Controlled by `ENABLE_NEURAL_RERANK` (set to `1` in `wrangler.jsonc`; unset or `0` disables it).
4.  **Context Windowing**: Automatically expands hits into narrative blocks (neighboring verses ±1) to preserve literary context.

---

## Performance & Evaluation Metrics

> **Note:** the table below is a historical lexical-only run and does not reflect the current production stack (Turso vectors + optional neural re-rank). Re-measure before citing.

Measured 2026-09-04, commit `cleanup/ponytail-audit` + review fixes, lexical-only
mode (`BIBLELM_DISABLE_DB=1`, no Postgres/pgvector), local run. Retrieval-only
(no LLM latency). See dated reports in `docs/benchmark/`.

| Metric | Full set (n=53) | Held-out (n=17) | Benchmark Target | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Hit @ 1** | **25%** | **29%** | ≥ 90.0% | ❌ BELOW TARGET (lexical-only) |
| **Hit @ 5** | **40%** | **41%** | ≥ 95.0% | ❌ BELOW TARGET (lexical-only) |
| **Mean Reciprocal Rank (MRR)** | **0.31** | **0.34** | ≥ 0.900 | ❌ BELOW TARGET (lexical-only) |
| **Median Retrieval Latency (p50)** | **52 ms** | **159 ms** | < 300 ms | ✅ PASS |
| **p95 Retrieval Latency** | **603 ms** | **2735 ms** | — | ℹ️ first-run index hydration dominates p95 |
| **Golden Eval Test Cases** | **53 scenarios** | **9 categories** | 8 categories | ✅ COMPLETE |

> Previous table claimed Hit@1/Hit@5 100% / MRR 1.000 — those were
> `benchmark:sample` synthetic fixture values (`tests/benchmark/fixtures/sample-results.json`,
> hand-written), not measured retrieval. Do not cite them. Production numbers
> with Postgres/pgvector + semantic rerank enabled are expected to be higher
> than lexical-only; re-run `benchmark:heldout` with `BIBLELM_DISABLE_DB=0`
> and a live DB to publish them.

---

## Benchmark Snapshot & Documentation

- **LLM Evaluation Report (RAGAS + DeepEval)**: [`docs/benchmark/LLM_EVALUATION_REPORT.md`](docs/benchmark/LLM_EVALUATION_REPORT.md)
- **Historical Architecture Changelog**: [`docs/ARCHITECTURE_CHANGELOG.md`](docs/ARCHITECTURE_CHANGELOG.md)
- **JSON Report**: [`docs/benchmark/latest-report.json`](docs/benchmark/latest-report.json)
- **Methodology & Guardrails**: [`docs/benchmark/README.md`](docs/benchmark/README.md)

Run:

```bash
npm run benchmark:sample    # synthetic fixture demo only — NOT a quality claim
npm run benchmark:live      # full 53-scenario measured retrieval (no LLM)
npm run benchmark:heldout   # 17-scenario held-out subset — cite THESE numbers
npm run benchmark:regression

# GraphRAG experiment (off by default)
ENABLE_GRAPH_RAG=1 npm run benchmark:live
ENABLE_GRAPH_RAG=0 npm run benchmark:regression  # baseline
ENABLE_GRAPH_RAG=1 npm run benchmark:regression  # with graph expansion
```

Primary retrieval quality metrics:
- `hit_at_1`
- `hit_at_5`
- `mrr`
- `precision_at_5`

---

## Tech Stack

*   **Frontend**: Vite, React 19, Tailwind CSS v4 (static assets served from the Worker).
*   **API**: Hono on Cloudflare Workers (`worker/`).
*   **AI/LLM**: Vercel AI SDK, Groq (Llama 3.1 / 3.3), Context-Only Fail-safe. Workers AI for neural re-ranking.
*   **Data**: Turso (libSQL) holds verses, embeddings, graph edges, Strong's, morphology, interlinear, OpenHebrewBible layers and TSK refs. Readers fall back to bundled static files when Turso is not configured.
*   **Caching / rate limiting**: Upstash Redis.

---

## Deployment & Setup

### Local development

```bash
npm install
cp .env.example .env.local   # GROQ_API_KEY at minimum; see variables below

# Pre-compute retrieval index (mandatory, enables <10ms BM25 hydration)
npx ts-node --project tsconfig.scripts.json scripts/build-retrieval-index.ts

npm run dev                  # Vite dev server
```

For Worker-runtime parity, build and run `npx wrangler dev` with secrets in `.dev.vars`.

### Environment variables

| Variable | Purpose |
| :--- | :--- |
| `GROQ_API_KEY` | LLM (required for chat) |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Turso data store (optional locally; falls back to bundled files) |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Response cache and rate limiting |
| `ENABLE_NEURAL_RERANK` | `1` enables Workers AI bge-reranker gate |
| `GEMINI_API_KEY` | Only for `scripts/generate-embeddings.ts` |

Never commit secrets. Scripts read credentials from the environment only.

### Production: Cloudflare Workers

```bash
npm run build        # data bundles + vite build into dist/client
npx wrangler deploy  # config in wrangler.jsonc
```

Set secrets once with `npx wrangler secret put GROQ_API_KEY` (and `TURSO_*`, `UPSTASH_*`).

> **Keep `"workers_dev": true` in `wrangler.jsonc`.** Adding a `routes` block makes wrangler disable the `workers.dev` URL on deploy, which returns Cloudflare error 1042 on every path.

Custom domain: add a proxied DNS record for the subdomain in the Cloudflare zone (or attach it under Workers & Pages, Settings, Domains & Routes). The route is declared in `wrangler.jsonc`.

### Populating Turso

Run with `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` exported:

```bash
npx tsx scripts/populate-turso-verses.ts     # verses
npx tsx scripts/upload-vectors-to-turso.ts   # embeddings
npx tsx scripts/migrate-graph-to-turso.ts    # graph edges
npx tsx scripts/upload-enrichment-to-turso.ts  # strongs, morph, interlinear, openhebrew, tsk
DRY_RUN=1 npx tsx scripts/upload-enrichment-to-turso.ts  # print expected row counts only
```

### Testing

```bash
npx vitest run
npx tsc --noEmit
npm run e2e:study && npm run e2e:stream   # set E2E_BASE to target a deployed URL
```

> **Docker / Diploi:** the bundled `Dockerfile` and Diploi launch config predate the Vite + Workers migration (they build Next.js standalone output) and are not maintained for the current stack. Use Cloudflare Workers.

---

## Dataset & Attributions

The processed dataset behind BibleLM is publicly available on **[Hugging Face](https://huggingface.co/datasets/sanjeevafk/biblelm)** under **CC BY-NC 4.0**.

*   **Translations**: Berean Standard Bible (BSB), KJV, WEB, ASV.
*   **Originals**: OpenHebrewBible (Hebrew), OpenGNT (Greek).
*   **Cross-References**: Treasury of Scripture Knowledge (TSK).
*   **Lexicons**: Strong's Exhaustive Concordance.

---

## License
MIT License.
