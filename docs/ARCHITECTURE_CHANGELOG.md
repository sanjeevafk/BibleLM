# 📜 BibleLM Architecture Additions & Innovations Changelog

Chronological log of major technical milestones, retrieval optimizations, and architectural additions in the BibleLM codebase.

---

## 1. Contextual Verse Prepending & Header Enrichment
* **Category:** Build-Time Indexing Optimization
* **Commit / Date:** August 2026
* **Description:** Pre-indexes structured contextual headers combining book, chapter, pericope title, and topic labels into a dedicated `bm25Text` field for each verse during offline preparation (`scripts/prepare-index.ts`). The inverted index operates on this contextually enriched text while raw scripture text (`text`) is preserved intact for user display, phrase-boost regex matching, and citation whitelist verification.
* **Header Structure:**
  ```text
  Raw Verse Text:
  "For God so loved the world that He gave His one and only Son..."

  Contextually Enriched BM25 Input (bm25Text):
  "[John · Chapter 3 · Salvation, Love of God] For God so loved the world that He gave His one and only Son..."
  ```
* **Data Structures:**
  - **Raw Text (`text`)**: Retained without modification for UI display, phrase-boost candidate matching, and post-generation citation validation.
  - **Enriched Text (`bm25Text`)**: Extracted from `pericopes.json` and `verse-topics.json`, indexed by `BM25Engine.createFromIndex`.
* **Empirical Impact (Evaluated across 31,086 indexed verses):**

  | Metric | Baseline | Context Prepend | Delta |
  | :--- | :--- | :--- | :--- |
  | **Thematic Precision @ 5** | 0.20 (20%) | **0.48 (48%)** | **+140% relative (+0.28)** |
  | **Thematic Hit @ 1** | 0.20 (20%) | **0.60 (60%)** | **+200% relative (+0.40)** |
  | **Exact Quote Hit @ 1** | 1.00 (100%) | **1.00 (100%)** | **0.00 (Zero Regression)** |
  | **Runtime Latency Impact** | 0 ms | **0 ms** | **0 ms (Build-time only)** |
  | **Index Coverage** | 0 / 31,086 | **31,086 / 31,086** | **100% Coverage** |

* **Key Artifacts:** [`scripts/prepare-index.ts`](file:///home/sanjeev/Downloads/bibleLM/scripts/prepare-index.ts), [`lib/retrieval/bm25.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/bm25.ts), [`scripts/measure-context-addition.py`](file:///home/sanjeev/Downloads/bibleLM/scripts/measure-context-addition.py).

---

## 2. GraphRAG & TSK Knowledge Graph Engine
* **Category:** Knowledge Graph Retrieval & BFS Expansion
* **Commits:** `b3294e0`, `c680e9a`, `f63b519`, `802edd6`
* **Description:** Integrates 344,000 Treasury of Scripture Knowledge (TSK) cross-reference links and thematic cluster graphs into a pre-computed index (`data/graph-index.json` / `data/rust/tsk-graph.bin`). Performs breadth-first expansion across related verses with topic-overlap score biasing.
* **Graph Architecture & Schema:**
  - **Node Kinds:**
    - `verse`: Canonical verse IDs (`GEN 1:1`, `JHN 3:16`).
    - `topic`: Topic IDs from `verse-topics.json` and virtual cluster hubs (`creation`, `cluster:cluster-adulterer-57`).
  - **Edge Kinds & Weight Semantics:**
    - `cluster`: `1 / √(cluster_size)` via a hub-and-spoke model connecting member verses to virtual cluster hubs, preventing O(n²) edge explosion on clusters up to 14,000 members.
    - `topic`: Confidence score (0.0 to 1.0) connecting verses to thematic tags.
  - **Adjacency Pruning:** Offline build prunes every node to its top-20 neighbors by weight descending.
* **BFS Traversal & Scoring Policy:**
  ```text
  1. frontier = seedVerseIds (top 10 from initial retrieval)
  2. For depth 1..GRAPH_RAG_MAX_DEPTH:
     a. For each node in frontier, fetch top neighbors where weight >= GRAPH_RAG_EDGE_MIN_WEIGHT
     b. Score: edge.weight + 0.2 * topicOverlapBonus + (1 / depth) * 0.1
     c. Retain top GRAPH_RAG_MAX_EXPANSIONS candidates and advance frontier
  3. Filter non-verse nodes; return ranked candidate verses
  ```
* **Rollout Configuration Flags:**
  - `ENABLE_GRAPH_RAG`: Master toggle (default: `0`).
  - `GRAPH_RAG_MAX_DEPTH`: Traversal depth limit (default: `2`).
  - `GRAPH_RAG_MAX_EXPANSIONS`: Candidate cap total (default: `30`).
  - `GRAPH_RAG_MAX_NEIGHBORS_PER_SEED`: Per-node neighbor cap (default: `10`).
  - `GRAPH_RAG_EDGE_MIN_WEIGHT`: Minimum edge confidence threshold (default: `0.1`).
* **Safety Invariants:**
  - Missing or corrupted graph index returns an empty array immediately; never throws or blocks retrieval.
  - Fallback to pure BM25/Vector retrieval guaranteed when flag is disabled.
* **Key Artifacts:** [`lib/retrieval/graph-rag.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/retrieval/graph-rag.ts), [`scripts/build-graph-index.ts`](file:///home/sanjeev/Downloads/bibleLM/scripts/build-graph-index.ts), [`rust/crates/biblelm-graph/src/lib.rs`](file:///home/sanjeev/Downloads/bibleLM/rust/crates/biblelm-graph/src/lib.rs).

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

---

## 9. Rust WebAssembly (WASM) Engine & Next.js Bridge
* **Category:** In-Process WASM Acceleration & Safe Fallback
* **Commits:** `279225c`, `10838ed`, `a5f3018`, `5f2a645`, `659bf5d`
* **Description:** Packages core retrieval routines into a high-performance WebAssembly module (`biblelm-wasm`) executed directly inside Node.js and Next.js via `wasm-pack`. Integrated into the main pipeline through [`lib/rust-bridge.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/rust-bridge.ts) with zero external network overhead and transparent zero-latency fallback to TypeScript when WASM is absent or disabled (`ENABLE_RUST_ENGINE=0`).
* **Accelerated Subsystems:**
  - **BM25 Search:** Sub-5ms lexical retrieval against pre-compiled `bm25.bin` with verse phrase boost text hydration.
  - **GraphRAG Expansion:** In-memory BFS traversal across `tsk-graph.bin` with hub-and-spoke cluster scoring.
  - **Citation Scrubber:** Linear-time regex-free citation whitelist parser and sanitizer in `wasm_scrub_citations`.
  - **Rank Aggregation:** Exact Reciprocal Rank Fusion (`wasm_fuse_rrf`) for hybrid retrieval.
  - **Linguistic Utilities:** Hebrew and Greek morphological code parsing and binary Strong's dictionary lookup (`strongs.bin`).
* **Empirical Impact & Benchmarks:**
  - **Search Acceleration:** **13x to 98x faster** than pure TypeScript BM25 across real biblical queries (e.g., *Melchizedek* in 15.4 ms vs 1,509 ms).
  - **Citation Sanitization:** Linear-time execution in **<0.03 ms**.
  - **Zero Regression:** 53/53 scenario eval verified (100% Top-5 agreement, 0% MRR drop).
  - **Serverless Ready:** Binary artifacts bundled for Vercel deployment with dynamic module resolution and isolated panic hooks.
* **Key Artifacts:** [`rust/crates/biblelm-wasm/src/lib.rs`](file:///home/sanjeev/Downloads/bibleLM/rust/crates/biblelm-wasm/src/lib.rs), [`lib/rust-bridge.ts`](file:///home/sanjeev/Downloads/bibleLM/lib/rust-bridge.ts), [`scripts/verification/independent-verification.ts`](file:///home/sanjeev/Downloads/bibleLM/scripts/verification/independent-verification.ts), [`scripts/verification/verify-real-queries.ts`](file:///home/sanjeev/Downloads/bibleLM/scripts/verification/verify-real-queries.ts).

---

## 10. Rust Full-Graph Port, Strong's v2 & Parity Hardening
* **Category:** Retrieval Parity Completion & Binary Format v2
* **Description:** Closes the gaps found in the post-merge review of §§8–9:
  - **Full multi-source graph in Rust** (`FullGraphBuilder`): ports §2–§4 of `scripts/build-graph-index.ts` (cluster hubs, verse topics, topic-verse index) alongside TSK edges, with first-wins node kinds, keep-max edge semantics, round-before-sort top-20 pruning across all kinds, and `parseInt`-exact vote parsing. New `BLMG v2` binary stores node/edge kinds; `decode_graph_bytes` still loads legacy v1 TSK-only binaries. `biblelm-build verify` now asserts **exact** adjacency equality (ids, order, weights, kinds) over all 30,730 nodes plus node-kind agreement.
  - **Strong's `BLMS v2`:** preserves all dictionary fields (`lexeme`, `transliteration`, `pronunciation`, `short_definition`) instead of transliteration-only; single shared encoder between CLI and library; trailing-byte rejection on all decoders.
  - **Calibration contract:** GraphRAG score calibration is now integer round-half-up on both sides (`Math.round(x*10000)/10000` in TS, `(x*10000).round()/10000` in Rust) — `toFixed(4)` is banned because it disagrees by 1ulp on 4th-decimal halfway cases.
  - **BM25 `BLM1 v2`:** drops the duplicated posting-count field; enables `serde_json preserve_order` so Rust doc numbering follows file order exactly like TS `Object.entries`.
* **Decisions:**
  - **WASM phrase-text hydration (keep):** `initRustEngine` still parses `bible-full-index.json` (~11.6 MB) on cold start for phrase-boost quality, accepting the cold-start cost the lean `bm25-state.json` path avoids. Guarded by `tests/unit/rust-lean-parity.test.ts` (WASM-vs-lean-fallback agreement in CI). Revisit by baking texts into the binary if cold starts regress.
  - **Morph parsers (deferred):** Hebrew/Greek parsers marked experimental subset; full parity port deferred until a production caller exists.
* **Empirical Impact:**
  - **Graph verify:** 30,730 nodes, 0 neighbor mismatches, 0 kind disagreements vs `data/graph-index.json`.
  - **GraphRAG live parity:** 6/6 seed sets bit-exact (ids, order, scores) vs TypeScript at production defaults.
  - **BM25 eval:** still 53/53 zero-diff top-5 after the v2/doc-order changes.
* **Key Artifacts:** [`rust/crates/biblelm-graph/src/lib.rs`](file:///home/sanjeev/Downloads/bibleLM/rust/crates/biblelm-graph/src/lib.rs), [`rust/crates/biblelm-morph/src/lib.rs`](file:///home/sanjeev/Downloads/bibleLM/rust/crates/biblelm-morph/src/lib.rs), [`tests/unit/rust-lean-parity.test.ts`](file:///home/sanjeev/Downloads/bibleLM/tests/unit/rust-lean-parity.test.ts).

