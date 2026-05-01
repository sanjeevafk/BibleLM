# Benchmark Changelog

## 2026-05-01

### Added
- Live benchmark mode now executes real retrieval calls and computes metrics from expected references.
- New quality metrics in reports: `hit_at_1`, `hit_at_5`, `mrr`.
- Regression gates now include `hit_at_5` and `mrr` deltas.
- Scenario set expanded to 20 benchmark scenarios across multiple query categories.
- Evaluation method document added: `EVAL-METHOD.md`.

### Notes
- Live mode is retrieval-focused in this phase. `llm_latency_ms` is set to `0`.
