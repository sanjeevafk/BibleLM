# BibleLM Golden Benchmark Report

Generated: 2026-09-04T12:12:44.417Z
Mode: live
Scenarios Evaluated: 53

- Retrieval-quality benchmark: real retrieveContextForQuery calls, no LLM.
- Baseline = cacheMode miss (cold), Optimized = cacheMode hit (cache warmed first).
- Delta ~0 with no cache backend configured honestly reflects no cache.
- llm_latency_ms is 0 by design — this benchmark targets retrieval only.
- DB mode: lexical-only (BIBLELM_DISABLE_DB=1).

## Aggregate Metrics

| Metric | Baseline | Optimized | Delta |
| --- | ---: | ---: | ---: |
| total_latency_ms | 191.45 | 70.53 | -120.92 |
| retrieval_latency_ms | 191.43 | 32.43 | -159 |
| llm_latency_ms | 0 | 0 | 0 |
| p50_latency | 52 | 58 | 6 |
| p95_latency | 603 | 203 | -400 |
| precision_at_5 | 0.15 | 0.15 | 0 |
| citation_validity_rate | 1 | 1 | 0 |
| hit_at_1 | 0.25 | 0.25 | 0 |
| hit_at_5 | 0.4 | 0.4 | 0 |
| mrr | 0.31 | 0.31 | 0 |

## Scenario Breakdown

| Scenario | Category | Cache | Baseline Total | Optimized Total | Delta | Precision@5 | Hit@5 | MRR | Citation Validity |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PSG-01 | passage | miss | 4216 | 35 | -4181 | 0.8 | 1 | 1 | 1 |
| PSG-02 | passage | miss | 827 | 87 | -740 | 0.2 | 1 | 1 | 1 |
| PSG-03 | passage | miss | 482 | 138 | -344 | 0.2 | 1 | 0.25 | 1 |
| PSG-04 | passage | miss | 603 | 54 | -549 | 0 | 0 | 0 | 1 |
| PSG-05 | passage | miss | 272 | 9 | -263 | 0.2 | 1 | 1 | 1 |
| PSG-06 | passage | miss | 174 | 46 | -128 | 0 | 0 | 0 | 1 |
| PSG-07 | passage | miss | 250 | 55 | -195 | 0 | 0 | 0 | 1 |
| PSG-08 | passage | miss | 273 | 318 | 45 | 0 | 0 | 0 | 1 |
| TOP-01 | topical | miss | 169 | 102 | -67 | 0.6 | 1 | 1 | 1 |
| TOP-02 | topical | miss | 76 | 26 | -50 | 0.2 | 1 | 0.5 | 1 |
| TOP-03 | topical | miss | 20 | 19 | -1 | 0 | 0 | 0 | 1 |
| TOP-04 | topical | miss | 54 | 10 | -44 | 0.2 | 1 | 0.5 | 1 |
| TOP-05 | topical | miss | 157 | 32 | -125 | 0 | 0 | 0 | 1 |
| TOP-06 | topical | miss | 445 | 5 | -440 | 0 | 0 | 0 | 1 |
| TOP-07 | topical | miss | 50 | 74 | 24 | 0 | 0 | 0 | 1 |
| TOP-08 | topical | miss | 73 | 108 | 35 | 0 | 0 | 0 | 1 |
| EXG-01 | exegesis | miss | 48 | 65 | 17 | 0 | 0 | 0 | 1 |
| EXG-02 | exegesis | miss | 69 | 135 | 66 | 0.2 | 1 | 1 | 1 |
| EXG-03 | exegesis | miss | 48 | 69 | 21 | 0 | 0 | 0 | 1 |
| EXG-04 | exegesis | miss | 27 | 58 | 31 | 0 | 0 | 0 | 1 |
| EXG-05 | exegesis | miss | 42 | 60 | 18 | 0 | 0 | 0 | 1 |
| EXG-06 | exegesis | miss | 51 | 99 | 48 | 0 | 0 | 0 | 1 |
| EXG-07 | exegesis | miss | 104 | 99 | -5 | 0.2 | 1 | 0.5 | 1 |
| EXG-08 | exegesis | miss | 31 | 70 | 39 | 0.2 | 1 | 1 | 1 |
| THL-01 | theology | miss | 57 | 95 | 38 | 0.6 | 1 | 1 | 1 |
| THL-02 | theology | miss | 38 | 98 | 60 | 0 | 0 | 0 | 1 |
| THL-03 | theology | miss | 2 | 5 | 3 | 0 | 0 | 0 | 1 |
| THL-04 | theology | miss | 38 | 78 | 40 | 0 | 0 | 0 | 1 |
| THL-05 | theology | miss | 42 | 61 | 19 | 0 | 0 | 0 | 1 |
| THL-06 | theology | miss | 57 | 52 | -5 | 0.2 | 1 | 1 | 1 |
| ETH-01 | ethics | miss | 11 | 23 | 12 | 0 | 0 | 0 | 1 |
| ETH-02 | ethics | miss | 9 | 16 | 7 | 0.5 | 1 | 0.33 | 1 |
| ETH-03 | ethics | miss | 52 | 68 | 16 | 0 | 0 | 0 | 1 |
| ETH-04 | ethics | miss | 2 | 5 | 3 | 1 | 1 | 1 | 1 |
| ETH-05 | ethics | miss | 36 | 31 | -5 | 0 | 0 | 0 | 1 |
| LNG-01 | original_language | miss | 144 | 6 | -138 | 0.25 | 1 | 1 | 1 |
| LNG-02 | original_language | miss | 2 | 5 | 3 | 0 | 0 | 0 | 1 |
| LNG-03 | original_language | miss | 35 | 51 | 16 | 0 | 0 | 0 | 1 |
| LNG-04 | original_language | miss | 123 | 85 | -38 | 0 | 0 | 0 | 1 |
| LNG-05 | original_language | miss | 56 | 81 | 25 | 0 | 0 | 0 | 1 |
| MLT-01 | multiturn | miss | 97 | 188 | 91 | 0 | 0 | 0 | 1 |
| MLT-02 | multiturn | miss | 107 | 203 | 96 | 0.25 | 1 | 0.5 | 1 |
| MLT-03 | multiturn | miss | 36 | 7 | -29 | 0 | 0 | 0 | 1 |
| MLT-04 | multiturn | miss | 105 | 169 | 64 | 0.4 | 1 | 1 | 1 |
| MLT-05 | multiturn | miss | 88 | 201 | 113 | 0.4 | 1 | 0.5 | 1 |
| ADV-01 | adversarial | miss | 45 | 12 | -33 | 0 | 0 | 0 | 1 |
| ADV-02 | adversarial | miss | 13 | 34 | 21 | 0 | 0 | 0 | 1 |
| ADV-03 | adversarial | miss | 28 | 67 | 39 | 0 | 0 | 0 | 1 |
| ADV-04 | adversarial | miss | 334 | 300 | -34 | 0.2 | 1 | 1 | 1 |
| ADV-05 | adversarial | miss | 2 | 3 | 1 | 1 | 1 | 1 | 1 |
| GRG-01 | graphrag | miss | 20 | 12 | -8 | 0.2 | 1 | 0.5 | 1 |
| GRG-02 | graphrag | miss | 2 | 5 | 3 | 0 | 0 | 0 | 1 |
| GRG-03 | graphrag | miss | 5 | 4 | -1 | 0 | 0 | 0 | 1 |
