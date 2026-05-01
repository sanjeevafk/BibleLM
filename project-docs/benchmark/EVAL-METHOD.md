# BibleLM Evaluation Method

## Scope
This benchmark currently evaluates retrieval quality and retrieval latency.

- Retrieval quality metrics: `hit_at_1`, `hit_at_5`, `mrr`, `precision_at_5`
- Grounding safety metric: `citation_validity_rate`
- Latency metrics: `total_latency_ms`, `retrieval_latency_ms`, `p50_latency`, `p95_latency`

`llm_latency_ms` is currently `0` in live mode because live benchmarking is retrieval-only in this phase.

## Scenario Set
Source of truth:
- `tests/benchmark/fixtures/scenarios.json`

Current categories include:
- direct verse
- verse explanation
- topical
- teaching
- theology
- narrative
- passage
- psalm

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

## Commands
- `npm run benchmark:sample`
- `npm run benchmark:live`
- `npm run benchmark:regression`
- `npm run benchmark:flags`

`benchmark:live` runs in JSON-only mode by default:
- `BIBLELM_DISABLE_DB=1`
- `BIBLELM_DISABLE_EXTERNAL_FALLBACK=1`

## Outputs
Generated reports:
- `project-docs/benchmark/latest-report.json`
- `project-docs/benchmark/latest-report.md`

Baselines for comparison:
- `project-docs/benchmark/baseline-report.json`
- `project-docs/benchmark/baseline-report.md`

## Known Limitations
- Ground-truth references are curated and still limited in coverage.
- Live mode currently benchmarks retrieval only, not full model answer generation quality.
- Some topical queries may have multiple acceptable verse sets; expected refs are not exhaustive.
