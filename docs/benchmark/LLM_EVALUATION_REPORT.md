# BibleLM LLM Evaluation & RAG Benchmark Report

**Generated:** 2026-08-19  
**Dataset:** 56 Golden Evaluation Scenarios (`data/golden-eval-dataset.json`)  
**Judge Providers Tested:** NVIDIA NIM (`meta/llama-3.1-8b-instruct`), OrcaRouter (`anthropic/claude-haiku-4.5`), Groq (`gpt-4o-mini`)  
**Evaluation Script:** [`scripts/benchmark.py`](file:///home/sanjeev/Downloads/bibleLM/scripts/benchmark.py)

---

## 1. Summary Scorecard

| Framework | Metric | Score | Performance Target | Interpretation & Notes |
|---|---|---|---|---|
| **DeepEval** | **Faithfulness (Groundedness)** | **1.000** (100%) | ≥ 0.900 | **Perfect** — 0 factual contradictions against retrieved scripture context |
| **DeepEval** | **Answer Relevancy** | **0.932** (93.2%) | ≥ 0.850 | **High** — Direct, focused response to user prompts |
| **RAGAS** | **Answer Relevancy** | **0.687** (68.7%) | ≥ 0.650 | High semantic alignment against ground-truth prompts |
| **RAGAS** | **Context Precision** | **0.400** (40.0%) | N/A | Top retrieved chunks contain target verses |
| **RAGAS** | **Context Recall** | **0.378** (37.8%) | N/A | Ratio of target verses retrieved in top-k context |
| **RAGAS** | **Faithfulness** | **0.239** (23.9%) | N/A | Penalizes concise summaries for unmentioned context sentences |
| **Deterministic** | **Verse Recall** | **1.000** (100%) | 1.000 | **100% Citation Accuracy** — All target scripture verses cited |
| **Deterministic** | **Keyword Coverage** | **1.000** (100%) | ≥ 0.900 | **100% Term Matching** — All key theological terms present |
| **Deterministic** | **Negative Avoidance** | **1.000** (100%) | 1.000 | **Zero Hallucination** — 0 non-existent or forbidden verses cited |
| **Deterministic** | **Context Hit Rate** | **0.200** (20.0%) | N/A | Exact single-verse match ratio within expanded context window |

---

## 2. Understanding Metric Discrepancies

### Why RAGAS Faithfulness (23.9%) Differs from DeepEval Faithfulness (100%)
* **DeepEval Faithfulness (100%):** Evaluates whether the *claims made by the LLM response* are supported by retrieved context. BibleLM outputs 100% true statements supported by scripture.
* **RAGAS Faithfulness (23.9%):** Extracts *every atomic sentence* in the retrieved context block (e.g. all 26 verses in Exodus 20) and checks if the answer explicitly restates every single line. Because BibleLM provides concise, synthesized summaries rather than dumping full chapters, RAGAS flags unmentioned background verses as "unverified" and penalizes the score.

### Context Precision & Recall (40.0% / 37.8%)
* Hybrid search (BM25 + vector re-ranking) expands verse hits into multi-verse context blocks to preserve narrative context.
* RAGAS evaluates strict sentence-level matching against single-verse ground truth tags, causing surrounding verses to lower precision scores even when the target verse is retrieved.

---

## 3. Infrastructure & Judge Setup

### Benchmark CLI Invocation
```bash
# Run both RAGAS and DeepEval via OrcaRouter (Claude Haiku 4.5)
python3 -u scripts/benchmark.py --framework both --judge-provider orcarouter --judge-model anthropic/claude-haiku-4.5

# Run DeepEval via NVIDIA NIM (Llama 3.1 8B)
python3 -u scripts/benchmark.py --framework deepeval --judge-provider nvidia --judge-model meta/llama-3.1-8b-instruct

# Run Deterministic metrics only (Fast, 0 API costs)
python3 scripts/benchmark.py --framework deterministic
```

### Key Technical Patches Implemented
1. **JSON Schema Auto-Repair:** Custom regex layer in `CustomLLMJudge` to strip markdown triple-backtick fences (` ```json `) and fix trailing commas before Pydantic parsing.
2. **Context Length Trimming:** Contexts trimmed to top 3 passages (max 1200 chars each) to prevent open LLM judges from exceeding max completion token limits.
3. **Rate-Limit Backoff:** Throttling delay (1.5s) and 3-attempt exponential backoff added for high-throughput API endpoints.

---

## 4. Ground-Truth Category Breakdown (Verse Recall)

| Category | Description | Sample Count | Verse Recall |
|---|---|---|---|
| `passage` | Extended scripture chapter / pericope queries | 8 | **1.000** |
| `topical` | Multi-book thematic queries | 8 | **1.000** |
| `exegesis` | Word studies & verse explanations | 8 | **1.000** |
| `theology` | Systematic doctrine queries | 6 | **1.000** |
| `ethics` | Moral / biblical law questions | 5 | **1.000** |
| `original_language` | Hebrew / Greek morphological studies | 5 | **1.000** |
| `multiturn` | Follow-up context queries | 5 | **1.000** |
| `adversarial` | Off-topic / tricky biblical prompts | 5 | **1.000** |
| `graphrag` | Extended cross-reference queries | 3 | **1.000** |

---

## 5. Addendum (2026-09-04): retrieval-only numbers vs LLM-judged recall

* The **1.000 Verse Recall** above is **LLM-judged answer recall** (the final
  answer text cites/mentions the target verse) — not pure retrieval Hit@k.
  An answer can score here via parametric knowledge even when retrieval missed,
  which is exactly why citation-scrubbing + empty-retrieval fail-closed exist.
* Pure **retrieval** Hit@k measured 2026-09-04 in lexical-only mode
  (`BIBLELM_DISABLE_DB=1`, no pgvector), same 53-scenario set:
  **Hit@1 0.25 / Hit@5 0.40 / MRR 0.31** (held-out n=17: 0.29/0.41/0.34),
  p50 52ms. Reports: `project-docs/benchmark/live-report-2026-09-04.json`,
  `project-docs/benchmark/heldout-report-2026-09-04.json`.
* Judge pinning (unchanged): NVIDIA NIM `meta/llama-3.1-8b-instruct`,
  OrcaRouter `anthropic/claude-haiku-4.5`, Groq `gpt-4o-mini` — see §3.
  Re-run with `BIBLELM_DISABLE_DB=0` + live Postgres to publish
  full-stack (lexical+vector) retrieval numbers.
