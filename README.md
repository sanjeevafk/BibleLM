# BibleLM

**A zero-cost, edge-first, neutrality-enforced Bible chatbot** using Retrieval-Augmented Generation (RAG) to deliver **exact verse quotes**, **original-language (Hebrew/Greek) insights**, and **Treasury of Scripture Knowledge (TSK)** cross-references without theological bias, modern commentary, or hallucinated content.

**Live demo**: https://biblelm.vercel.app  

## Core Philosophy

- **Scripture-First and Absolute Neutrality** — Every response **must** quote real verses with chapter:verse citations. No interpretation, application, denominational slant, political framing, or moralizing allowed. The system prompt rigidly enforces this.
- **Zero-Cost Operation** — Runs indefinitely on Vercel **Hobby** tier and Gemini **free** tier (Gemini 2.5 Flash primary). No paid vector DBs, no heavy compute, no always-on servers.
- **Speed and Reliability** — Common queries (< 200ms) via pre-computed BM25 indexing and Edge Functions. Rare verses fallback gracefully to external APIs.
- **Original-Language Fidelity** — Hebrew (OSHB) / Greek (SBLGNT) word popups with Strong's number, transliteration, and gloss — no loose paraphrasing.

## System Architecture

```text
+-----------------------+      +-----------------------+      +-----------------------+
|                       |      |                       |      |                       |
|   Client App (UI)     +----->|  Vercel Edge API      +----->|  Primary LLM          |
|   Next.js React       |      |  (/api/chat)          |      |  (Gemini 2.5 Flash)   |
|                       |      |                       |      |                       |
+-----------------------+      +-----------+-----------+      +-----------+-----------+
                                           |                              |
                                           v                              v (Fallback)
+-----------------------+      +-----------+-----------+      +-----------+-----------+
|                       |      |                       |      |                       |
|   Upstash Redis       |<-----+  Hybrid Retrieval V3  |      |  Secondary LLMs       |
|   (Rate Limit/Cache)  |      |  (BM25 + Semantic)    |      |  (OpenRouter, Groq,   |
|                       |      |                       |      |   HuggingFace)        |
+-----------------------+      +-----------+-----------+      +-----------------------+
                                           |
                                           v
                               +-----------+-----------+
                               |                       |
                               |  Static Data Bundles  |
                               |  (JSON, BSB, TSK,     |
                               |   Morphology)         |
                               |                       |
                               +-----------------------+
```

Next.js 16 (App Router) and Vercel Edge runtime. Fully stateless where possible; lightweight Upstash Redis used for rate-limiting and response caching.

### Tech Stack

- **Framework** — Next.js 16 (App Router, Server Actions, React Server Components)
- **Styling** — Tailwind CSS and shadcn/ui
- **LLM Integration** — Vercel AI SDK and provider SDKs (@google/genai, OpenRouter, @ai-sdk/groq, @huggingface/inference)
- **Primary LLM** — Gemini 2.5 Flash (`GEMINI_API_KEY`) with streamed generation
- **Fallback Models (ordered)**  
  - OpenRouter (llama-3.1-8b-instruct)
  - Groq (llama-3.3-70b-versatile)
  - Hugging Face Inference (Meta-Llama-3.1-8B-Instruct)
- **Retrieval (V3 Hybrid)** — Advanced 4-stage pipeline:
  1. **Query Expansion**: Theological synonym mapping to improve concept-to-verse recall.
  2. **Lexical Search (BM25)**: Custom engine using the full 31,086 verse BSB index with smoothed IDF and pre-computed state.
  3. **Conditional Semantic Gating**: Semantic re-ranking (Google text-embedding-004) only triggers if lexical confidence is low.
  4. **Context Expansion**: Narrative windowing (±1 verse) with automated sequential merging.
- **Caching** — Upstash Redis for query-to-verses and final answer caching (72h TTL).
- **Data (Datasets and Attributions)** — Public domain and open-license sources:
  - **BSB** (Berean Standard Bible) — Default translation.
  - **KJV, WEB, ASV** — Public domain, sourced from scrollmapper CSV exports.
  - **OpenHebrewBible Subset** — Clause segmentation, poetic division, BHS-WLC alignments, and extended glosses. Processed from eliranwong/OpenHebrewBible — CC BY-NC 4.0 (attribution required).
  - **OpenGNT Greek NT Layers** — Morphology, interlinear glosses, and clause tagging built from OpenGNT sources — CC BY-NC 4.0.
  - **Strong's Exhaustive Concordance** — Core lexicon and dictionary mappings.
  - **Treasury of Scripture Knowledge (TSK)** — Ranked thematic cross-references.

### Request Lifecycle (Detailed RAG Flow)

```text
User Query
    |
    v
[ Theological Synonym Expansion ] ---> (e.g., "Messiah" -> "Christ", "Anointed")
    |
    v
[ Lexical Search (BM25) ] ---> Uses pre-computed index state (<10ms)
    |
    +---> Top Result Confidence High?
                 |
                YES ───────────────────────────┐
                 |                             |
                 NO                            |
                 |                             v
                 v             [ Context Window Expansion (±1 Verse) ]
[ Semantic Re-ranking ]                        |
  (Top 50 candidates sent to                   |
   Gemini Embedding API)                       v
                 |               [ Build Strict Citation Prompt ]
                 |                             |
                 └─────────────────────────────┤
                                               v
                             [ Inference & Streaming (LLM) ]
```

1. **Client to /api/chat (POST, Edge)**  
   Sends message history array in Vercel AI SDK format.

2. **Theological Query Expansion**  
   User keywords are expanded using the theological synonym map (e.g., 'messiah' -> 'christ, anointed').

3. **Lexical Search (BM25)**  
   The expanded query hits the pre-computed BM25 engine. The engine hydrates in <10ms from the serialized state.

4. **Semantic Re-ranking (Conditional)**  
   If the top BM25 match score is low or the gap is small, the system triggers semantic re-ranking for the top 50 candidates using the Gemini Embedding API.

5. **Context Windowing**  
   Top hits are expanded into narrative blocks (neighboring verses) and merged into coherent reading sections.

6. **Prompt Engineering**  
   The system prompt (~800 tokens) enforces citation-only constraints. Temperature is set to 0.1 for maximum factual fidelity.

7. **Inference and Streaming**  
   Gemini/OpenRouter/Groq outputs are normalized to a unified streaming format for the UI.

## Key Features

- **Neutral Citation Engine** — Forces exact verse quoting with citations.
- **Original-Language Tooltips** — Click any tagged word for Strong's number, transliteration, and gloss popup.
- **TSK Cross-References** — Thematic links shown inline and ranked by relevance.
- **Translation Toggle** — BSB default with KJV/WEB/ASV available.
- **Free-Tier Friendly** — Optimized for edge functions and free-tier API limits.
- **Controversy-Resistant** — Designed to handle divisive topics without editorializing.

## Test Queries (Neutrality and Accuracy Smoke Tests)

1. "What does the Bible say about abortion?"  
   (Expect Ps 139:13-16, Ex 21:22-25)
2. "What is the biblical view of homosexuality?"  
   (Expect Lev 18:22, 20:13; Rom 1:26-27; 1 Cor 6:9-11)
3. "Is divorce allowed in the Bible?"  
   (Expect Mal 2:16; Matt 5:31-32, 19:3-9)
4. "Does the Bible support slavery?"  
   (Expect Ex 21; Eph 6:5-9; Philemon)
5. "Can women be pastors according to Scripture?"  
   (Expect 1 Tim 2:11-15; Gal 3:28; Rom 16:1-7)

## Performance and Optimization

- **Cold Start**: Optimized via `data/bm25-state.json`. Indexing is bypassed at runtime for a 50% faster startup (~550ms cold start).
- **Warm Latency**: Lexical-only queries respond in ~60-150ms. Semantic-gated queries add ~300-500ms based on API round-trips.
- **Data Bundling**: All Bible data is pre-parsed and pre-processed into static JSON fragments to fit within Vercel's 50MB deployment limit.

## Development Setup

```bash
# 1. Clone and install
git clone https://github.com/voidcommit-afk/BibleLM.git
cd BibleLM
npm install

# 2. Configure Environment
cp .env.example .env.local
# Required: GEMINI_API_KEY
# Optional: UPSTASH_REDIS_REST_URL/TOKEN, OPENROUTER_API_KEY

# 3. Build Data Bundles
# Aggregates BSB index and parses Strong's/Hebrew/Greek
npm run build:data 

# 4. Pre-compute Retrieval Index
# Generates the BM25 state for high-performance retrieval
ts-node --project tsconfig.scripts.json scripts/build-retrieval-index.ts

# 5. Run Dev Server
npm run dev
```

## Maintenance and Monitoring

- **Benchmark Suite**: `scripts/benchmark-retrieval.ts` verifies search accuracy (MRR/Precision).
- **Refresh Index**: If the Bible datasets are updated, rerun `scripts/build-retrieval-index.ts` to update the BM25 term frequencies.

## License

MIT
