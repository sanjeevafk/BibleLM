# Benchmark And Rollout Guardrails

## Benchmark Commands

- `npm run benchmark:sample`
  - Generates a stable benchmark report from the committed sample fixture set.
  - Writes:
    - `project-docs/benchmark/latest-report.json`
    - `project-docs/benchmark/latest-report.md`
  - Compare against the tracked baseline snapshots:
    - `project-docs/benchmark/baseline-report.json`
    - `project-docs/benchmark/baseline-report.md`
- `npm run benchmark:live`
  - Executes real retrieval calls using the scenario fixture set.
  - Computes `hit_at_1`, `hit_at_5`, `mrr`, `precision_at_5` from `expectedTopRefs`.
  - Runs in JSON-only benchmark mode (`BIBLELM_DISABLE_DB=1`, `BIBLELM_DISABLE_EXTERNAL_FALLBACK=1`) for deterministic local results without PostgreSQL or external APIs.
- `npm run benchmark:regression`
  - Fails on retrieval, latency, or citation-grounding regressions.
- `npm run benchmark:flags`
  - Prints the active retrieval rollout flags.

## Benchmark Scenarios

- direct verse queries
- verse explanation queries
- topical queries
- narrative / teaching / theology queries
- cache-hit scenarios
- cache-miss scenarios

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
