# BibleLM Evaluation Method & Rollout Guardrails

## Scope
This benchmark currently evaluates retrieval quality and retrieval latency.

- Retrieval quality metrics: `hit_at_1`, `hit_at_5`, `mrr`, `precision_at_5`
- Grounding safety metric: `citation_validity_rate`
- Latency metrics: `total_latency_ms`, `retrieval_latency_ms`, `p50_latency`, `p95_latency`

`llm_latency_ms` is currently `0` in live mode because live benchmarking is retrieval-only.

## Scenario Set
Source of truth:
- `tests/benchmark/fixtures/scenarios.json`

Current categories (9) include:
- `passage`
- `topical`
- `exegesis`
- `theology`
- `ethics`
- `original_language`
- `multiturn`
- `adversarial`
- `graphrag`

## How Scoring Works
For each scenario:
1. Run retrieval for the query + translation.
2. Collect top-5 references from returned verses.
3. Compare against `expectedTopRefs`.

Metrics:
- `hit_at_1`: 1 if first retrieved ref matches any expected ref; else 0.
- `hit_at_5`: 1 if any top-5 ref matches any expected ref; else 0.
- `mrr`: reciprocal rank of first matching ref (0 if no match).
- `precision_at_5`: matched refs in top-5 divided by number of returned top refs (up to 5).

Matching is case-insensitive and accepts ranged references that start with the expected ref (e.g. `JAS 1:2-4` matches expected `JAS 1:2-4`).

## Regression Gates

- `precision_at_5` must not drop beyond tolerance.
- `hit_at_5` must not drop beyond tolerance.
- `mrr` must not drop beyond tolerance.
- `p95_latency` must not increase beyond tolerance.
- `citation_validity_rate` must remain grounded.

## Rollout Flags

- `ENABLE_SEMANTIC_RERANKER`
  - Enables optional semantic reranking.
- `ENABLE_TSK_EXPANSION_GATING`
  - Enables TSK expansion gating.
- `ENABLE_RETRIEVAL_DEBUG`
  - Enables retrieval/debug diagnostics across the route and retrieval pipeline.

These flags support safe rollback and controlled production rollout. They can also be used to separate cohorts for simple A/B validation.

## Commands
- `npm run benchmark:sample`
  - Generates a stable benchmark report from the committed sample fixture set.
  - Writes: `docs/benchmark/latest-report.json` and `docs/benchmark/latest-report.md`
  - Compare against the tracked baseline snapshots: `docs/benchmark/live-report-2026-09-04.json` and `docs/benchmark/heldout-report-2026-09-04.json`
- `npm run benchmark:live`
  - Executes real retrieval calls using the scenario fixture set.
  - Runs in JSON-only benchmark mode (`BIBLELM_DISABLE_DB=1`, `BIBLELM_DISABLE_EXTERNAL_FALLBACK=1`) for deterministic local results without PostgreSQL or external APIs.
- `npm run benchmark:regression`
  - Fails on retrieval, latency, or citation-grounding regressions.
- `npm run benchmark:flags`
  - Prints the active retrieval rollout flags.

## Outputs
Generated reports:
- `docs/benchmark/latest-report.json`
- `docs/benchmark/latest-report.md`

Dated baseline snapshots:
- `docs/benchmark/live-report-2026-09-04.json` / `docs/benchmark/live-report-2026-09-04.md`
- `docs/benchmark/heldout-report-2026-09-04.json` / `docs/benchmark/heldout-report-2026-09-04.md`

## Known Limitations
- Ground-truth references are curated and still limited in coverage.
- Live mode currently benchmarks retrieval only, not full model answer generation quality.
- Some topical queries may have multiple acceptable verse sets; expected refs are not exhaustive.
