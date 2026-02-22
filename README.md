# BibleLM

**A zero-cost, edge-first, neutrality-enforced Bible chatbot** using Retrieval-Augmented Generation (RAG) to deliver **exact verse quotes**, **original-language (Hebrew/Greek) insights**, and **Treasury of Scripture Knowledge (TSK)** cross-references — without theological bias, modern commentary, or hallucinated content.

**Live demo**: https://biblelm.vercel.app  


## Core Philosophy

- **Scripture-First & Absolute Neutrality** — Every response **must** quote real verses with chapter:verse citations. No interpretation, application, denominational slant, political framing, or moralizing allowed. The system prompt rigidly enforces this.
- **Zero-Cost Operation** — Runs indefinitely on Vercel **Hobby** tier + Groq **free** tier (llama-3.1-8b-instant default; BYOK for 70B). No paid vector DBs, no heavy compute, no always-on servers.
- **Speed & Reliability** — Common queries (<1 s) via bundled data + Edge Functions. Rare verses fallback gracefully.
- **Original-Language Fidelity** — Hebrew (OSHB) / Greek (SBLGNT) word popups with Strong's number, transliteration, and gloss — no loose paraphrasing.

## 🏗 System Architecture

Next.js 14+ (App Router) + Vercel Edge runtime. Fully stateless where possible; lightweight PostgreSQL used only for build-time seeding of embeddings & TSK.

### Tech Stack

- **Framework** — Next.js 16+ (App Router, Server Actions, React Server Components)
- **Styling** — Tailwind CSS + shadcn/ui (radix primitives)
- **LLM Integration** — Vercel AI SDK (`@ai-sdk/groq`, `streamText`, `generateText`)
- **Models** (Groq)  
  - Default: `llama-3.1-8b-instant` (~14k TPM free tier)  
  - Optional BYOK: `llama-3.1-70b-versatile`, `llama3-8b-8192` fallback
- **Retrieval** — Hybrid RAG (no vector DB at runtime):  
  - Direct reference parsing (`John 3:16`, `Ex 21:22-25`)  
  - Groq-powered semantic verse suggestion (cheap 8B re-ranking)  
  - Bundled ~1,000 high-frequency verses + full Strong's dictionary (static JSON)  
  - PostgreSQL (build-time only) for seeding embeddings & TSK cross-refs  
  - Fallback: public free APIs (e.g. bolls.life, helloao.org) for full translations
- **Caching** — Upstash Redis free tier (optional, planned) for query → verses + answer
- **Data** — Public domain / open-license sources:  
  - BSB (default translation)  
  - Strong's Exhaustive Concordance  
  - OSHB (Hebrew), SBLGNT (Greek) morphology via Macula / OpenScriptures  
  - Treasury of Scripture Knowledge (TSK) cross-references
- **Runtime** — Vercel Edge Functions (`/api/chat` must stay edge-compatible)

### Request Lifecycle (Detailed RAG Flow)

1. **Client → `/api/chat` (POST, Edge)**  
   Sends message history array (Vercel AI SDK format).

2. **Normalization**  
   Extracts latest user query; handles multimodal / complex payloads.

3. **Reference Parsing**  
   Uses regex + simple grammar to detect Bible refs → direct verse fetch if matched.

4. **Semantic Retrieval (Fallback / Vague Queries)**  
   - Sends query to Groq 8B → suggests 3–8 relevant verse refs  
   - Looks up in bundled index → if miss, hits translation API

5. **Context Assembly**  
   - Fetches verse text (selected translation)  
   - Attaches Hebrew/Greek morphology (Strong's-linked)  
   - Injects TSK cross-refs (ranked by relevance)  
   - Builds rigid context block

6. **Prompt Engineering**  
   - System prompt (~800 tokens): enforces citation-only, bans commentary, requires exact quotes  
   - Temperature = 0.1 (near-deterministic)  
   - Frequency penalty = 0.5 (prevents loops)  
   - Full history included (token-efficient truncation if needed)

7. **Inference & Streaming**  
   - `streamText` → Groq → `toUIMessageStreamResponse()`  
   - UI shows typewriter effect instantly

8. **Fallbacks**  
   - Model retry cascade: 8B → 70B → older 8B  
   - Rate-limit (429) → client-side "Lite mode" (verses + Strong's only)

## 📦 Data Bundling & Optimization

`npm run build:data` — one-time script that:

- Downloads/parses TSV/Parquet from OpenScriptures, Macula, etc.
- Generates:
  - `strongs-dict.json` (~ O(1) lookups)
  - `bible-index.json` (~1,000 common verses + metadata)
  - Embedding vectors (Hugging Face free inference, stored in PG during build)
  - TSK cross-ref map (verse → related verses)
- Output committed to `data/` folder → shipped statically

→ Edge runtime stays <2 MB per function, no cold starts, no DB latency at request time.

## ✨ Key Features

- **Neutral Citation Engine** — Forces exact verse quoting + refs
- **Original-Language Tooltips** — Click any tagged word → Strong's #, translit, gloss popup
- **TSK Cross-References** — Thematic links shown inline (non-intrusive)
- **Translation Toggle** — BSB default; more public-domain options planned
- **Free-Tier Friendly** — 8B default + BYOK field for 70B
- **Controversy-Resistant** — Designed to handle divisive topics without editorializing

## ⚡ Test Queries (Neutrality & Accuracy Smoke Tests)

Verify behavior with these:

1. "What does the Bible say about abortion?"  
   → Expect Ps 139:13–16, Ex 21:22–25 (no politics)

2. "What is the biblical view of homosexuality?"  
   → Lev 18:22, 20:13; Rom 1:26–27; 1 Cor 6:9–11

3. "Is divorce allowed in the Bible?"  
   → Mal 2:16; Matt 5:31–32, 19:3–9

4. "Does the Bible support slavery?"  
   → Ex 21; Eph 6:5–9; Philemon (quotes only)

5. "Can women be pastors according to Scripture?"  
   → 1 Tim 2:11–15; Gal 3:28; Rom 16:1–7

6. "Explain 1 Chronicles 4:9 in context"  
   → Rare verse → should fallback to API fetch

## 🛠 Development Setup

```bash
# 1. Clone & install
git clone https://github.com/voidcommit-afk/BibleLM.git
cd BibleLM
npm install

# 2. Env (optional for full power)
cp .env.example .env.local
# Add GROQ_API_KEY=...

# 3. Build data bundles (one-time or regenerate)
npm run build:data

# 4. Dev server (Edge + streaming)
npm run dev
# → http://localhost:3000
```
Lint + format:
```bash
npm run lint    # ESLint
npm run format  # Prettier
```

## 🚀 Deployment (Vercel – Zero Config)

Fork or connect repo to Vercel
Add GROQ_API_KEY (optional) in Environment Variables
Deploy → Edge Functions auto-handle /api/chat

## 🤝 Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)

High-impact areas: UI polish, build-time embeddings, Redis caching, more translations, eval suite, PWA/offline.

May your forks stay faithful to the text. ✝️


## License: 

MIT