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
  - Reserved for environment-backed benchmarking.
  - Requires production-like dependencies and credentials.
- `npm run benchmark:regression`
  - Fails on retrieval, latency, or citation-grounding regressions.
- `npm run benchmark:flags`
  - Prints the active retrieval rollout flags.

## Benchmark Scenarios

- direct verse queries
- verse explanation queries
- topical queries
- cache-hit scenarios
- cache-miss scenarios

## Regression Gates

- `precision_at_5` must not drop beyond tolerance.
- `p95_latency` must not increase beyond tolerance.
- `citation_validity_rate` must remain grounded.

## Rollout Flags

| Flag | Default | Scope | Rollback command |
|---|---|---|---|
| `ENABLE_SEMANTIC_RERANKER` | `0` | Optional semantic reranking in hybrid retrieval | `ENABLE_SEMANTIC_RERANKER=0` |
| `ENABLE_DETERMINISTIC_RERANKER` | `1` | Deterministic weighted second-pass reranker | `ENABLE_DETERMINISTIC_RERANKER=0` |
| `ENABLE_TOPIC_RETRIEVAL_BOOST` | `0` | Topic-to-verse signal (`+0.10 * topic_signal`) | `ENABLE_TOPIC_RETRIEVAL_BOOST=0` |
| `ENABLE_PASSAGE_RETRIEVAL` | `0` | Passage retrieval + passage signal (`+0.08 * passage_signal`) | `ENABLE_PASSAGE_RETRIEVAL=0` |
| `ENABLE_TSK_CLUSTER_BOOST` | `0` | TSK cluster reranking signal (`+0.06 * cluster_signal`) | `ENABLE_TSK_CLUSTER_BOOST=0` |
| `ENABLE_TSK_EXPANSION_GATING` | `1` | Gating logic for TSK expansion safety | `ENABLE_TSK_EXPANSION_GATING=0` |
| `ENABLE_RETRIEVAL_DEBUG` / `RETRIEVAL_DEBUG` / `DEBUG_LLM` | `0` | Retrieval diagnostics + decision traces | `ENABLE_RETRIEVAL_DEBUG=0 RETRIEVAL_DEBUG=0 DEBUG_LLM=0` |

## Enable Order

1. `ENABLE_DETERMINISTIC_RERANKER=1`
2. `ENABLE_TOPIC_RETRIEVAL_BOOST=1`
3. `ENABLE_PASSAGE_RETRIEVAL=1`
4. `ENABLE_TSK_CLUSTER_BOOST=1`
5. `ENABLE_SEMANTIC_RERANKER=1`
6. `ENABLE_RETRIEVAL_DEBUG=1` only during investigation windows

## Rollback Sequence

1. Disable newest enrichment first: `ENABLE_TSK_CLUSTER_BOOST=0`.
2. Disable passage signal/retrieval next: `ENABLE_PASSAGE_RETRIEVAL=0`.
3. Disable topic signal next: `ENABLE_TOPIC_RETRIEVAL_BOOST=0`.
4. Disable semantic reranking if latency/regression persists: `ENABLE_SEMANTIC_RERANKER=0`.
5. Last resort baseline fallback: `ENABLE_DETERMINISTIC_RERANKER=0`.
