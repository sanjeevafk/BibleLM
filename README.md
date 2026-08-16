# BibleLM: The Sola Scriptura Engine

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Runtime](https://img.shields.io/badge/Runtime-Vercel%20Edge-blue?style=flat-square)](https://vercel.com/docs/functions/edge-functions)
[![Dataset](https://img.shields.io/badge/Dataset-Hugging%20Face-yellow?style=flat-square)](https://huggingface.co/datasets/sanjeevafk/biblelm)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**BibleLM** is a high-performance, text-first Retrieval-Augmented Generation (RAG) architecture designed to deliver uncompromising biblical search and original-language insights. 

Built to eliminate LLM "hallucination" and theological drift, BibleLM functions as a strict "Sola Scriptura" (Scripture Alone) engine. It forces base models to answer complex theological queries using raw, cited text and structural linguistics rather than external commentary or interpretive bias.

**Live Demo**: [https://biblelm.vercel.app](https://biblelm.vercel.app)  
**System Architecture Diagram**: [`docs/architecture.html`](file:///home/sanjeev/Downloads/bibleLM/docs/architecture.html)

---

## Architectural Deep-Dive

```text
┌──────────────┐      ┌──────────────────────────┐      ┌────────────────────┐
│  Client App  │      │    Next.js Edge Route    │      │    Primary LLM     │
│ (React / TS) ├─────►│ (proxy.ts + Rate Limit)  ├─────►│ (Groq: Llama 3.1)  │
└──────────────┘      └────────────┬─────────────┘      └──────────┬─────────┘
                                   │                               │
                                   ▼                               ▼
┌──────────────┐      ┌──────────────────────────┐      ┌────────────────────┐
│ Neon pgvector│      │    Hybrid Retrieval V3   │      │  Citation Audit    │
│  (31k Verses)├─────►│(BM25 + Vector Re-Ranker) ├─────►│ Grounding Filter   │
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
*   **Multi-Translation Brotli Storage**: Supports 5 full translations (`BSB`, `WEB`, `KJV`, `ASV`, `NHEB`) stored as compressed `.json.br` book files.
*   **Citation-Locking**: A post-generation scrubbing middleware validates every LLM citation against retrieved context. If a verse wasn't in the context, it's stripped—preventing "AI-generated" scripture.
*   **Lexical & Morphological Tethering**: Verses are enriched with Hebrew/Greek morphology (OpenGNT & MorphHB) word-by-word, forcing the LLM to output Strong's numbers and transliterations.

### 2. The 4-Stage Retrieval Pipeline
1.  **Theological Expansion**: Expands keywords using a domain-specific synonym map to maximize recall.
2.  **Lexical Search (BM25)**: Custom TypeScript implementation of BM25 tuned for verse-length documents ($k1=1.2, b=0.65$).
3.  **Semantic Vector Re-ranking**: Integrates Groq `nomic-embed-text-v1.5` embeddings and Neon PostgreSQL `pgvector` for dense semantic similarity ranking.
4.  **Context Windowing**: Automatically expands hits into narrative blocks (neighboring verses ±1) to preserve literary context.

---

## Performance & Evaluation Metrics

| Metric | Measured Value | Benchmark Target | Status |
| :--- | :--- | :--- | :--- |
| **Hit @ 1** | **100.0%** | ≥ 90.0% | ✅ PASS |
| **Hit @ 5** | **100.0%** | ≥ 95.0% | ✅ PASS |
| **Mean Reciprocal Rank (MRR)** | **1.000** | ≥ 0.900 | ✅ PERFECT |
| **Average Search Latency** | **155.4 ms** | < 300 ms | ✅ PASS |
| **Citation Validity Rate** | **86.7%** | ≥ 80.0% | ✅ PASS |
| **Golden Eval Test Cases** | **56 Scenarios** | 8 Categories | ✅ COMPLETE |

---

## Benchmark Snapshot

- JSON report: [docs/benchmark/latest-report.json](docs/benchmark/latest-report.json)
- Methodology & Guardrails: [docs/benchmark/README.md](docs/benchmark/README.md)

Run:

```bash
npm run benchmark:sample
npm run benchmark:live
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

*   **Frontend/API**: Next.js 16 (App Router), React 19, Tailwind CSS v4.
*   **AI/LLM**: Vercel AI SDK, Groq (Llama 3.1 / 3.3), Context-Only Fail-safe.
*   **Infrastructure**: Vercel Edge Runtime, Upstash Redis (Distributed Caching).
*   **Database-less**: Static JSON Edge Data Store (Bible Index, TSK, Morphology).

---

## Deployment & Setup

BibleLM supports two primary deployment paths: **Edge-Native** (Vercel) and **Containerized** (Docker).

### Option A: Local Development
```bash
# 1. Install & Config
npm install
cp .env.example .env.local  # Add your GROQ_API_KEY

# 2. Pre-compute Retrieval Index (Mandatory)
# This generates the search state map for <10ms hydration
npx ts-node --project tsconfig.scripts.json scripts/build-retrieval-index.ts

# 3. Start
npm run dev
```

### Option B: Docker (Self-Hosted)
For privacy-focused or non-Vercel deployments, a production-ready multi-stage Dockerfile is provided.
```bash
# Builds a minimal Alpine-based image (~150MB)
docker compose up --build
```

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
