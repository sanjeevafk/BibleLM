# BibleLM Golden Benchmark Report

Generated: 2026-08-16T11:31:52.698Z
Mode: live
Scenarios Evaluated: 50

- Golden eval dataset benchmark report covering 50 evaluation items.
- Executes real retrieval pipeline calls and computes metrics from expectedVerses, mustContainVerses, and parallelVerses.
- llm_latency_ms is set to 0 in live mode because this benchmark targets retrieval quality and retrieval latency only.

## Aggregate Metrics

| Metric | Baseline | Optimized | Delta |
| --- | ---: | ---: | ---: |
| total_latency_ms | 151.42 | 29.12 | -122.3 |
| retrieval_latency_ms | 151.42 | 29.12 | -122.3 |
| llm_latency_ms | 0 | 0 | 0 |
| p50_latency | 41 | 20 | -21 |
| p95_latency | 428 | 97 | -331 |
| precision_at_5 | 0.19 | 0.19 | 0 |
| citation_validity_rate | 1 | 1 | 0 |
| hit_at_1 | 0.32 | 0.32 | 0 |
| hit_at_5 | 0.46 | 0.46 | 0 |
| mrr | 0.37 | 0.37 | 0 |

## Scenario Breakdown

| Scenario | Category | Cache | Baseline Total | Optimized Total | Delta | Precision@5 | Hit@5 | MRR | Citation Validity |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PSG-01 | passage | miss | 2991 | 21 | -2970 | 0.8 | 1 | 1 | 1 |
| PSG-02 | passage | miss | 428 | 102 | -326 | 0.2 | 1 | 1 | 1 |
| PSG-03 | passage | miss | 27 | 13 | -14 | 0.2 | 1 | 0.5 | 1 |
| PSG-04 | passage | miss | 406 | 17 | -389 | 0 | 0 | 0 | 1 |
| PSG-05 | passage | miss | 97 | 5 | -92 | 0 | 0 | 0 | 1 |
| PSG-06 | passage | miss | 117 | 8 | -109 | 0 | 0 | 0 | 1 |
| PSG-07 | passage | miss | 323 | 38 | -285 | 0 | 0 | 0 | 1 |
| PSG-08 | passage | miss | 362 | 49 | -313 | 0 | 0 | 0 | 1 |
| TOP-01 | topical | miss | 68 | 27 | -41 | 0.6 | 1 | 1 | 1 |
| TOP-02 | topical | miss | 76 | 10 | -66 | 0.2 | 1 | 0.2 | 1 |
| TOP-03 | topical | miss | 33 | 6 | -27 | 0 | 0 | 0 | 1 |
| TOP-04 | topical | miss | 36 | 8 | -28 | 0.2 | 1 | 0.33 | 1 |
| TOP-05 | topical | miss | 257 | 7 | -250 | 0 | 0 | 0 | 1 |
| TOP-06 | topical | miss | 209 | 4 | -205 | 0 | 0 | 0 | 1 |
| TOP-07 | topical | miss | 5 | 4 | -1 | 0 | 0 | 0 | 1 |
| TOP-08 | topical | miss | 24 | 30 | 6 | 0 | 0 | 0 | 1 |
| EXG-01 | exegesis | miss | 30 | 37 | 7 | 0 | 0 | 0 | 1 |
| EXG-02 | exegesis | miss | 49 | 58 | 9 | 0.2 | 1 | 1 | 1 |
| EXG-03 | exegesis | miss | 20 | 33 | 13 | 0.2 | 1 | 0.2 | 1 |
| EXG-04 | exegesis | miss | 24 | 26 | 2 | 0 | 0 | 0 | 1 |
| EXG-05 | exegesis | miss | 42 | 27 | -15 | 0 | 0 | 0 | 1 |
| EXG-06 | exegesis | miss | 50 | 49 | -1 | 0.2 | 1 | 1 | 1 |
| EXG-07 | exegesis | miss | 26 | 36 | 10 | 0.2 | 1 | 0.33 | 1 |
| EXG-08 | exegesis | miss | 54 | 18 | -36 | 0.2 | 1 | 1 | 1 |
| THL-01 | theology | miss | 41 | 97 | 56 | 0.6 | 1 | 1 | 1 |
| THL-02 | theology | miss | 58 | 49 | -9 | 0 | 0 | 0 | 1 |
| THL-03 | theology | miss | 3 | 9 | 6 | 0 | 0 | 0 | 1 |
| THL-04 | theology | miss | 157 | 50 | -107 | 0 | 0 | 0 | 1 |
| THL-05 | theology | miss | 39 | 15 | -24 | 0.2 | 1 | 1 | 1 |
| THL-06 | theology | miss | 15 | 31 | 16 | 0.2 | 1 | 1 | 1 |
| ETH-01 | ethics | miss | 154 | 35 | -119 | 0 | 0 | 0 | 1 |
| ETH-02 | ethics | miss | 6 | 28 | 22 | 0.2 | 1 | 0.25 | 1 |
| ETH-03 | ethics | miss | 20 | 19 | -1 | 0 | 0 | 0 | 1 |
| ETH-04 | ethics | miss | 2 | 2 | 0 | 1 | 1 | 1 | 1 |
| ETH-05 | ethics | miss | 32 | 16 | -16 | 0 | 0 | 0 | 1 |
| LNG-01 | original_language | miss | 134 | 3 | -131 | 0.25 | 1 | 1 | 1 |
| LNG-02 | original_language | miss | 2 | 1 | -1 | 0 | 0 | 0 | 1 |
| LNG-03 | original_language | miss | 7 | 19 | 12 | 0 | 0 | 0 | 1 |
| LNG-04 | original_language | miss | 16 | 20 | 4 | 0 | 0 | 0 | 1 |
| LNG-05 | original_language | miss | 29 | 27 | -2 | 0 | 0 | 0 | 1 |
| MLT-01 | multiturn | miss | 57 | 49 | -8 | 0 | 0 | 0 | 1 |
| MLT-02 | multiturn | miss | 68 | 64 | -4 | 0.4 | 1 | 1 | 1 |
| MLT-03 | multiturn | miss | 4 | 5 | 1 | 0 | 0 | 0 | 1 |
| MLT-04 | multiturn | miss | 66 | 69 | 3 | 0.8 | 1 | 1 | 1 |
| MLT-05 | multiturn | miss | 58 | 63 | 5 | 0.4 | 1 | 0.5 | 1 |
| ADV-01 | adversarial | miss | 39 | 5 | -34 | 0 | 0 | 0 | 1 |
| ADV-02 | adversarial | miss | 638 | 5 | -633 | 1 | 1 | 1 | 1 |
| ADV-03 | adversarial | miss | 32 | 19 | -13 | 0 | 0 | 0 | 1 |
| ADV-04 | adversarial | miss | 139 | 121 | -18 | 0.2 | 1 | 1 | 1 |
| ADV-05 | adversarial | miss | 1 | 2 | 1 | 1 | 1 | 1 | 1 |
