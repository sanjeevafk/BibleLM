# BibleLM Golden Benchmark Report

Generated: 2026-09-04T12:11:56.499Z
Mode: heldout
Scenarios Evaluated: 17

- Held-out subset: 17/53 scenarios (every 4th + all adversarial).
- Reserved from tuning — cite THESE numbers as the quality claim, not full-set.
- Baseline = miss (cold), Optimized = hit (warmed). llm_latency_ms = 0 by design.
- DB mode: lexical-only (BIBLELM_DISABLE_DB=1).

## Aggregate Metrics

| Metric | Baseline | Optimized | Delta |
| --- | ---: | ---: | ---: |
| total_latency_ms | 387.71 | 89.88 | -297.83 |
| retrieval_latency_ms | 387.65 | 39.59 | -348.06 |
| llm_latency_ms | 0 | 0 | 0 |
| p50_latency | 159 | 67 | -92 |
| p95_latency | 2735 | 421 | -2314 |
| precision_at_5 | 0.16 | 0.16 | 0 |
| citation_validity_rate | 1 | 1 | 0 |
| hit_at_1 | 0.29 | 0.29 | 0 |
| hit_at_5 | 0.41 | 0.41 | 0 |
| mrr | 0.34 | 0.34 | 0 |

## Scenario Breakdown

| Scenario | Category | Cache | Baseline Total | Optimized Total | Delta | Precision@5 | Hit@5 | MRR | Citation Validity |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PSG-04 | passage | miss | 2735 | 80 | -2655 | 0 | 0 | 0 | 1 |
| PSG-08 | passage | miss | 1140 | 317 | -823 | 0 | 0 | 0 | 1 |
| TOP-04 | topical | miss | 159 | 13 | -146 | 0.2 | 1 | 0.5 | 1 |
| TOP-08 | topical | miss | 510 | 67 | -443 | 0 | 0 | 0 | 1 |
| EXG-04 | exegesis | miss | 83 | 68 | -15 | 0 | 0 | 0 | 1 |
| EXG-08 | exegesis | miss | 225 | 110 | -115 | 0.2 | 1 | 1 | 1 |
| THL-04 | theology | miss | 244 | 86 | -158 | 0 | 0 | 0 | 1 |
| ETH-02 | ethics | miss | 34 | 14 | -20 | 0.5 | 1 | 0.33 | 1 |
| LNG-01 | original_language | miss | 115 | 26 | -89 | 0.25 | 1 | 1 | 1 |
| LNG-05 | original_language | miss | 192 | 69 | -123 | 0 | 0 | 0 | 1 |
| MLT-04 | multiturn | miss | 117 | 136 | 19 | 0.4 | 1 | 1 | 1 |
| ADV-01 | adversarial | miss | 152 | 25 | -127 | 0 | 0 | 0 | 1 |
| ADV-02 | adversarial | miss | 49 | 22 | -27 | 0 | 0 | 0 | 1 |
| ADV-03 | adversarial | miss | 23 | 46 | 23 | 0 | 0 | 0 | 1 |
| ADV-04 | adversarial | miss | 612 | 421 | -191 | 0.2 | 1 | 1 | 1 |
| ADV-05 | adversarial | miss | 11 | 4 | -7 | 1 | 1 | 1 | 1 |
| GRG-02 | graphrag | miss | 190 | 24 | -166 | 0 | 0 | 0 | 1 |
