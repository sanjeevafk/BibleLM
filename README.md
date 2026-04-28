# BibleLM: The Sola Scriptura Engine

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Runtime](https://img.shields.io/badge/Runtime-Vercel%20Edge-blue?style=flat-square)](https://vercel.com/docs/functions/edge-functions)
[![Dataset](https://img.shields.io/badge/Dataset-Hugging%20Face-yellow?style=flat-square)](https://huggingface.co/datasets/sanjeevafk/biblelm)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

**BibleLM** is a high-performance, text-first Retrieval-Augmented Generation (RAG) architecture designed to deliver uncompromising biblical search and original-language insights. 

Built to eliminate LLM "hallucination" and theological drift, BibleLM functions as a strict "Sola Scriptura" (Scripture Alone) engine. It forces base models to answer complex theological queries using raw, cited text and structural linguistics rather than external commentary or interpretive bias.

**Live Demo**: [https://biblelm.vercel.app](https://biblelm.vercel.app)

---

## Architectural Deep-Dive

```text
┌──────────────┐      ┌──────────────────────────┐      ┌────────────────────┐
│  Client App  │      │    Next.js Edge Route    │      │    Primary LLM     │
│ (React / TS) ├─────►│ (Validation & Rate Limit) ├─────►│ (Gemini 2.5 Flash) │
└──────────────┘      └────────────┬─────────────┘      └──────────┬─────────┘
                                   │                               │
                                   ▼                               ▼
┌──────────────┐      ┌──────────────────────────┐      ┌────────────────────┐
│ Response     │      │   Hybrid Retrieval V3    │      │  Secondary LLMs    │
│ Cache (Redis)│◄────►│  (BM25 + Semantic Gate)  │      │  (Fallback Logic)  │
└──────────────┘      └────────────┬─────────────┘      └────────────────────┘
                                   │
                                   ▼
                      ┌──────────────────────────┐
                      │    Static JSON Store     │
                      │ (Index, Morph, TSK, Lex) │
                      └──────────────────────────┘
```

Most RAG systems rely on expensive, high-latency vector databases. BibleLM is built on a **Stateless Hybrid Retrieval** architecture optimized for the Edge.

### 1. The Engineering Strategy
*   **Stateless Scaling**: To bypass the ~1s cold-start penalty of indexing 31,000 verses on every request, the engine's TF/IDF state is pre-computed at build time and serialized to JSON. At runtime, the engine hydrates in **< 10ms**.
*   **Citation-Locking**: A post-generation scrubbing middleware validates every LLM citation against the retrieved context. If a verse wasn't in the context, it's stripped—preventing "AI-generated" scripture.
*   **Lexical Tethering**: Every verse is enriched with Hebrew/Greek morphology word-by-word. The LLM is forced to output Strong's numbers and transliterations, tethering its logic to structural data rather than creative prose.

### 2. The 4-Stage Retrieval Pipeline
1.  **Theological Expansion**: Expands keywords (e.g., "Messiah" -> "Christ, Anointed") using a domain-specific synonym map to maximize recall.
2.  **Lexical Search (BM25)**: Custom TypeScript implementation of BM25 tuned for verse-length documents ($k1=1.2, b=0.65$).
3.  **Conditional Semantic Gating**: Only triggers expensive vector embeddings (Google `text-embedding-004`) if BM25 confidence is low or results are ambiguous.
4.  **Context Windowing**: Automatically expands hits into narrative blocks (neighboring verses ±1) to preserve literary context.

---

## Performance Metrics

| Metric | Edge Performance | Optimization Technique |
| :--- | :--- | :--- |
| **Search Latency** | 60ms – 150ms | Pre-computed serialized BM25 state |
| **Cold Start** | ~550ms | Binary JSON chunking & lazy-loading |
| **Bundle Size** | 33.3 MB | Gzip/Brotli fragment compression |
| **Rate Limiting** | Atomic < 2ms | Redis-backed Lua scripts (Upstash) |

---

## Tech Stack

*   **Frontend/API**: Next.js 16 (App Router), React 19, Tailwind CSS v4.
*   **AI/LLM**: Vercel AI SDK, Gemini 2.5 Flash (Primary), Llama 3.3 70B (Fallback).
*   **Infrastructure**: Vercel Edge Runtime, Upstash Redis (Distributed Caching).
*   **Database-less**: Static JSON Edge Data Store (Bible Index, TSK, Morphology).

---

## Deployment & Setup

BibleLM supports two primary deployment paths: **Edge-Native** (Vercel) and **Containerized** (Docker).

### Option A: Local Development
```bash
# 1. Install & Config
npm install
cp .env.example .env.local  # Add your GEMINI_API_KEY

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
