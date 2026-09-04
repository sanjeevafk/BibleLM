# 📜 BibleLM Architecture Additions & Innovations Changelog

Chronological log of major technical milestones, retrieval optimizations, and architectural additions in the BibleLM codebase.

---

## 1. Contextual Verse Prepending & Header Enrichment *(Latest)*
* **Category:** Build-Time Indexing Optimization
* **Commit / Date:** August 2026
* **Description:** Prepends structured context headers (`[Book · Chapter · Pericope/Topic]`) to every verse at build time in `scripts/prepare-index.ts`. Updates `BM25Engine` to index `bm25Text` while preserving raw `text` for display and citation verification.
* **Empirical Impact:**
  - **Thematic Precision @ 5:** Increased **+140%** (0.20 → 0.48).
  - **Thematic Hit @ 1:** Increased **+200%** (0.20 → 0.60).
  - **Exact Quote Accuracy:** Maintained **100%** (1.00 Hit@1, 0% regression).
  - **Runtime Latency:** **0 ms** overhead.
* **Key Artifacts:** [`scripts/prepare-index.ts`](file:///home/sanjeev/Downloads/bibleLM/scripts/prepare-index.ts), [`lib/retrieval/bm25.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/bm25.ts), [`docs/contextual-verse-prepending.md`](file:///home/sanjeev/Downloads/bibleLM/docs/contextual-verse-prepending.md).

---

## 2. GraphRAG & TSK Cross-Reference Graph Engine
* **Category:** Knowledge Graph Retrieval
* **Commits:** `b3294e0`, `c680e9a`, `f63b519`, `802edd6`
* **Description:** Integrates 344,000 Treasury of Scripture Knowledge (TSK) cross-reference links into a pre-computed graph index (`graph-index.json`). Supports calibrated multi-hop candidate expansion behind the `ENABLE_GRAPH_RAG` feature flag.
* **Empirical Impact:** Enables multi-hop theological synthesis while maintaining a fall-back path to pure BM25/Vector search for low-latency single-verse queries.
* **Key Artifacts:** [`lib/retrieval/graph-rag.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/graph-rag.ts), [`scripts/build-graph-index.ts`](file:///home/sanjeev/Downloads/bibleLM/scripts/build-graph-index.ts), [`docs/graph-rag-method.md`](file:///home/sanjeev/Downloads/bibleLM/docs/graph-rag-method.md).

---

## 3. Original Language Morphology Enrichment (OpenGNT & MorphHB)
* **Category:** Lexical & Linguistic Tethering
* **Commit:** `76266b6`
* **Description:** Enriches retrieved New Testament and Old Testament verses word-by-word with Strong's numbers, lemmas, parsing codes, and transliterations from OpenGNT and MorphHB datasets.
* **Empirical Impact:** Forces LLM responses to anchor directly on original Greek/Hebrew root meanings, eliminating hallucinated word definitions.
* **Key Artifacts:** [`lib/datasets/opengnt.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/datasets/opengnt.ts), [`lib/datasets/morphhb.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/datasets/morphhb.ts), [`lib/retrieval/enrichment.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/enrichment.ts).

---

## 4. Pericope Passage Range Expansion
* **Category:** Query Classification & Context Windowing
* **Commit:** `a8fe23c`
* **Description:** Introduces pattern matching for 45 curated pericopes (e.g., *Ten Commandments*, *Sermon on the Mount*, *Good Samaritan*). Expands query hits to return the complete passage range (up to 20 verses) instead of fragmented single-verse snippets.
* **Empirical Impact:** Eliminates context truncation for named passage queries and bypasses generic vector search for known narrative blocks.
* **Key Artifacts:** [`data/pericopes.json`](file:///home/sanjeev/Downloads/bibleLM/data/pericopes.json), [`lib/retrieval/pericopes.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/pericopes.ts).

---

## 5. Golden Evaluation Dataset & Automated Benchmark Harness
* **Category:** Evaluation & Quality Guardrails
* **Commits:** `1ad57d5`, `8bea6ed`
* **Description:** Builds an automated end-to-end benchmark framework ([`tests/benchmark/run-benchmarks.ts`](file:///home/sanjeev/Downloads/bibleLM/tests/benchmark/run-benchmarks.ts)) testing 53 Golden Eval scenarios across 9 categories (passage, topical, exegesis, theology, ethics, original_language, multiturn, adversarial, graphrag).
* **Empirical Impact:** Enforces automated CI regression checks (`npm run benchmark:regression`) for Hit@1, Hit@5, MRR, latency (P50/P95), and citation validity rate.
* **Key Artifacts:** [`tests/benchmark/fixtures/scenarios.json`](file:///home/sanjeev/Downloads/bibleLM/tests/benchmark/fixtures/scenarios.json), [`tests/benchmark/run-benchmarks.ts`](file:///home/sanjeev/Downloads/bibleLM/tests/benchmark/run-benchmarks.ts).

---

## 6. Speculative Parallel Retrieval & Fast-Path Routing
* **Category:** Performance & Edge Optimization
* **Commit:** `2f2903f`
* **Description:** Implements a multi-stage query routing pipeline that detects direct verse references (e.g., *"John 3:16"*) and immediately routes them to an instant lookup fast-path, bypassing heavy vector search. Executes hybrid BM25 and vector queries speculatively in parallel.
* **Empirical Impact:** Reduced average search latency from >300ms down to **155.4ms** on Vercel Edge Runtime.
* **Key Artifacts:** [`lib/retrieval/pipeline.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/pipeline.ts), [`lib/retrieval/verse-fetch.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/verse-fetch.ts).

---

## 7. Multi-Translation Brotli Storage & Fast Hydration
* **Category:** Infrastructure & Database-less Scaling
* **Commit:** `cc156b4`
* **Description:** Stores 5 full translations (`BSB`, `WEB`, `KJV`, `ASV`, `NHEB`) as Brotli-compressed `.json.br` book files. Pre-computes BM25 state into `bm25-state.json` (9.77 MB) for <10ms Edge cold-start hydration.
* **Empirical Impact:** Complete serverless deployment without expensive vector database infrastructure costs.
* **Key Artifacts:** [`data/translations/`](file:///home/sanjeev/Downloads/bibleLM/data/translations), [`lib/retrieval/bm25.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/bm25.ts).

---

## 8. Rust Native Offline Build CLI & Query-Time BM25 Search Engine
* **Category:** High-Performance Native Indexing & Retrieval
* **Commits:** `ad14cb4`, `4e0a317`, `2acde7e`
* **Description:** Implements a modular Rust workspace (`biblelm-types`, `biblelm-index`, `biblelm-graph`, `biblelm-build`) providing byte-exact TypeScript-parity BM25 and TSK graph pre-compilation into compact binary formats (`BLM1`, `BLMG`). Ports query-time BM25 scoring with smoothed IDF, k1/b TF saturation, stable float sorting (`f64::total_cmp`), and top-100 phrase boosting. Includes an offline `eval` subcommand with side-by-side metric comparison against TypeScript.
* **Empirical Impact:**
  - **Pre-compilation speed:** Compiles full Bible index and cross-reference graph in **~4s** (vs 30s+ in Node.js).
  - **Binary compactness:** Reduces BM25 index and graph storage to **6.5 MB / 5.6 MB** (vs 9.8 MB / 21 MB in JSON).
  - **Retrieval Parity:** **100% bit-for-bit parity** with TypeScript engine (0 differing top-5 refs across all 53 golden scenarios).
* **Key Artifacts:** [`rust/crates/biblelm-index/src/lib.rs`](file:///home/sanjeev/Downloads/bibleLM/rust/crates/biblelm-index/src/lib.rs), [`rust/crates/biblelm-build/src/main.rs`](file:///home/sanjeev/Downloads/bibleLM/rust/crates/biblelm-build/src/main.rs), [`rust/crates/biblelm-build/src/eval.rs`](file:///home/sanjeev/Downloads/bibleLM/rust/crates/biblelm-build/src/eval.rs), [`scripts/eval-raw-bm25.ts`](file:///home/sanjeev/Downloads/bibleLM/scripts/eval-raw-bm25.ts).
