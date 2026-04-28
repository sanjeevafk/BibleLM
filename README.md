# BibleLM: The Sola Scriptura Engine

**An uncompromising, text-first Retrieval-Augmented Generation (RAG) architecture** designed to deliver exact verse quotes, original-language (Hebrew/Greek) lexical data, and Treasury of Scripture Knowledge (TSK) cross-references. 

Built to eliminate LLM "preachiness" and modern cultural relativization, BibleLM functions as a strict "Sola Scriptura" (Scripture Alone) engine. It forces base models to answer complex theological queries using raw, cited text and structural linguistics rather than external commentary or interpretive bias.

**Live Demo**: [https://biblelm.vercel.app](https://biblelm.vercel.app)

---

## The Engineering Challenge

Standard LLMs are trained to be conversational, safe, and agreeable. When asked complex or controversial theological questions, they tend to synthesize "balanced" essays that dilute strict biblical prohibitions with modern moralizing or cultural relativism. 

**BibleLM solves this through strict architectural constraints:**
1. **Citation-Locking:** The system prompt forces the LLM to *only* use the verses provided in the retrieval context. A post-generation scrubbing middleware strips any hallucinations.
2. **Lexical Tethering:** Every verse retrieved is enriched with its underlying Hebrew/Greek morphology (via OpenHebrewBible & OpenGNT). The LLM is forced to output Strong's numbers and transliterations, tethering its response to structural data rather than creative text generation.
3. **Algorithmic Textual Conclusions:** Instead of relying on the LLM to interpret severity, the system instructs the LLM to evaluate the *vocabulary* of the retrieved text (e.g., if the text contains words like "abomination" or prescribes "death"), forcing the LLM to output a direct, text-bound conclusion without softening.

## System Architecture

BibleLM operates entirely on the Edge (Vercel Edge Runtime) for sub-second global latency. It uses a custom **Stateless Hybrid Retrieval** system to avoid the overhead, latency, and cost of a managed Vector Database.

```text
┌─────────────────┐      ┌──────────────────────────┐      ┌─────────────────────┐
│                 │      │  Next.js Edge API Route  │      │  Primary LLM        │
│  Client UI      ├─────►│  (Rate Limiting &        ├─────►│  (Gemini 2.5 Flash) │
│  (React 19)     │      │   In-Flight Dedupe)      │      │  (Strict Temp: 0.1) │
│                 │      └────────────┬─────────────┘      └──────────┬──────────┘
└─────────────────┘                   │                               │
                                      ▼                               ▼ (Fallback)
┌─────────────────┐      ┌──────────────────────────┐      ┌─────────────────────┐
│  Upstash Redis  │      │  Retrieval Pipeline V3   │      │  Secondary LLMs     │
│  (Response Cache│◄────►│  (Query Expansion ->     │      │  (OpenRouter, Groq, │
│   & IP Limits)  │      │   Hybrid Search)         │      │   Llama-3.3 70B)    │
└─────────────────┘      └────────────┬─────────────┘      └─────────────────────┘
                                      │
                                      ▼
                         ┌──────────────────────────┐
                         │  Static Edge Data Store  │
                         │  - Serialized BM25 State │
                         │  - BSB/Originals JSON    │
                         │  - TSK Cross-References  │
                         └──────────────────────────┘
```

### The 4-Stage Retrieval Pipeline

1. **Theological Query Expansion:** User queries are intercepted and expanded via a domain-specific synonym map (e.g., "Messiah" -> "Christ, Anointed") to increase lexical recall.
2. **Lexical Search (BM25):** The primary retrieval engine. To bypass the ~1s cold-start penalty of indexing 31,000 verses on the Edge, the engine's TF/IDF term frequency state is pre-computed at build time and serialized to JSON. At runtime, the engine hydrates in <10ms.
3. **Conditional Semantic Gating:** If the top BM25 match yields low confidence or the gap between candidates is too narrow, the pipeline seamlessly falls back to a Semantic Re-ranking layer, fetching embeddings (Google `text-embedding-004`) for the top 50 candidates and blending scores (65% Semantic / 35% BM25).
4. **Context Windowing (Narrative Expansion):** Top lexical hits are expanded into narrative blocks (neighboring verses ±1) and merged into coherent reading sections before being injected into the prompt context.

## Tech Stack

*   **Framework**: Next.js 16 (App Router, Server Actions, Edge API Routes)
*   **AI Integration**: Vercel AI SDK, Google GenAI SDK, @ai-sdk/groq
*   **Infrastructure**: Vercel (Hosting), Upstash Redis (Caching/Rate Limiting)
*   **Retrieval**: Custom TypeScript BM25 Engine + Gemini Embeddings
*   **Styling**: Tailwind CSS v4, shadcn/ui

## Performance & Optimization

*   **Stateless Scaling**: The entire search index and lexical datasets are bundled as static JSON chunks, fitting within Vercel's strict 50MB deployment limit.
*   **Edge-Native Rate Limiting**: Implements a Redis-backed atomic sliding window (via custom Lua script), gracefully degrading to an in-memory map if Redis is unreachable.
*   **Request Deduplication**: In-flight identical requests are hashed and deduped at the route level to prevent API abuse and conserve LLM tokens.
*   **Latency Profile**: Warm lexical queries resolve in `~60-150ms`. Semantic-gated queries add `~300-500ms`. Final streamed time-to-first-token (TTFT) averages `< 1.2s`.

## Datasets & Attributions

BibleLM is built on open-license and public domain datasets:
*   **Translations**: Berean Standard Bible (BSB) as default. KJV, WEB, ASV fallbacks.
*   **Original Languages**: OpenHebrewBible (CC BY-NC 4.0) for clause segmentation and BHS-WLC alignments. OpenGNT (CC BY-NC 4.0) for Greek morphology.
*   **Lexicons**: Strong's Exhaustive Concordance mapping.
*   **Cross-References**: Treasury of Scripture Knowledge (TSK).

## Development Setup

\`\`\`bash
# 1. Clone repository
git clone https://github.com/voidcommit-afk/BibleLM.git
cd BibleLM

# 2. Install dependencies
npm install

# 3. Configure Environment
cp .env.example .env.local
# Required: GEMINI_API_KEY
# Optional (but recommended for prod): UPSTASH_REDIS_REST_URL/TOKEN

# 4. Pre-compute Retrieval Index
# Generates the BM25 state map for high-performance edge retrieval
npx ts-node --project tsconfig.scripts.json scripts/build-retrieval-index.ts

# 5. Run Dev Server
npm run dev
\`\`\`

## License
MIT License
