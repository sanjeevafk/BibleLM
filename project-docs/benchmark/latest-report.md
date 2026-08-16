# BibleLM Golden Benchmark Report

Generated: 2026-08-16T14:29:59.886Z
Mode: live
Scenarios Evaluated: 53

- Golden eval dataset benchmark report covering 50 evaluation items.
- Executes real retrieval pipeline calls and computes metrics from expectedVerses, mustContainVerses, and parallelVerses.
- llm_latency_ms is set to 0 in live mode because this benchmark targets retrieval quality and retrieval latency only.

## Aggregate Metrics

| Metric | Baseline | Optimized | Delta |
| --- | ---: | ---: | ---: |
| total_latency_ms | 32.49 | 11.96 | -20.53 |
| retrieval_latency_ms | 32.49 | 11.96 | -20.53 |
| llm_latency_ms | 0 | 0 | 0 |
| p50_latency | 13 | 9 | -4 |
| p95_latency | 93 | 32 | -61 |
| precision_at_5 | 0.17 | 0.17 | 0 |
| citation_validity_rate | 1 | 1 | 0 |
| hit_at_1 | 0.25 | 0.25 | 0 |
| hit_at_5 | 0.4 | 0.4 | 0 |
| mrr | 0.31 | 0.31 | 0 |

## Scenario Breakdown

| Scenario | Category | Cache | Baseline Total | Optimized Total | Delta | Precision@5 | Hit@5 | MRR | Citation Validity |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PSG-01 | passage | miss | 610 | 7 | -603 | 0.8 | 1 | 1 | 1 |
| PSG-02 | passage | miss | 92 | 34 | -58 | 0.2 | 1 | 1 | 1 |
| PSG-03 | passage | miss | 41 | 13 | -28 | 0.2 | 1 | 0.5 | 1 |
| PSG-04 | passage | miss | 17 | 11 | -6 | 0 | 0 | 0 | 1 |
| PSG-05 | passage | miss | 27 | 5 | -22 | 0 | 0 | 0 | 1 |
| PSG-06 | passage | miss | 93 | 22 | -71 | 0 | 0 | 0 | 1 |
| PSG-07 | passage | miss | 68 | 20 | -48 | 0 | 0 | 0 | 1 |
| PSG-08 | passage | miss | 43 | 16 | -27 | 0 | 0 | 0 | 1 |
| TOP-01 | topical | miss | 112 | 26 | -86 | 0.6 | 1 | 1 | 1 |
| TOP-02 | topical | miss | 48 | 7 | -41 | 0.2 | 1 | 0.5 | 1 |
| TOP-03 | topical | miss | 11 | 5 | -6 | 0 | 0 | 0 | 1 |
| TOP-04 | topical | miss | 34 | 6 | -28 | 0.2 | 1 | 0.5 | 1 |
| TOP-05 | topical | miss | 5 | 4 | -1 | 0 | 0 | 0 | 1 |
| TOP-06 | topical | miss | 6 | 6 | 0 | 0 | 0 | 0 | 1 |
| TOP-07 | topical | miss | 6 | 5 | -1 | 0 | 0 | 0 | 1 |
| TOP-08 | topical | miss | 21 | 14 | -7 | 0 | 0 | 0 | 1 |
| EXG-01 | exegesis | miss | 11 | 17 | 6 | 0 | 0 | 0 | 1 |
| EXG-02 | exegesis | miss | 20 | 26 | 6 | 0.2 | 1 | 1 | 1 |
| EXG-03 | exegesis | miss | 19 | 9 | -10 | 0 | 0 | 0 | 1 |
| EXG-04 | exegesis | miss | 15 | 12 | -3 | 0 | 0 | 0 | 1 |
| EXG-05 | exegesis | miss | 14 | 9 | -5 | 0 | 0 | 0 | 1 |
| EXG-06 | exegesis | miss | 22 | 22 | 0 | 0 | 0 | 0 | 1 |
| EXG-07 | exegesis | miss | 17 | 18 | 1 | 0.2 | 1 | 0.5 | 1 |
| EXG-08 | exegesis | miss | 12 | 13 | 1 | 0.2 | 1 | 1 | 1 |
| THL-01 | theology | miss | 19 | 13 | -6 | 0.6 | 1 | 1 | 1 |
| THL-02 | theology | miss | 19 | 17 | -2 | 0 | 0 | 0 | 1 |
| THL-03 | theology | miss | 6 | 1 | -5 | 0 | 0 | 0 | 1 |
| THL-04 | theology | miss | 14 | 14 | 0 | 0 | 0 | 0 | 1 |
| THL-05 | theology | miss | 10 | 10 | 0 | 0.2 | 1 | 0.33 | 1 |
| THL-06 | theology | miss | 11 | 8 | -3 | 0.4 | 1 | 1 | 1 |
| ETH-01 | ethics | miss | 6 | 5 | -1 | 0 | 0 | 0 | 1 |
| ETH-02 | ethics | miss | 5 | 6 | 1 | 0.2 | 1 | 0.2 | 1 |
| ETH-03 | ethics | miss | 9 | 8 | -1 | 0 | 0 | 0 | 1 |
| ETH-04 | ethics | miss | 0 | 1 | 1 | 1 | 1 | 1 | 1 |
| ETH-05 | ethics | miss | 12 | 6 | -6 | 0 | 0 | 0 | 1 |
| LNG-01 | original_language | miss | 1 | 1 | 0 | 1 | 1 | 1 | 1 |
| LNG-02 | original_language | miss | 0 | 1 | 1 | 0 | 0 | 0 | 1 |
| LNG-03 | original_language | miss | 4 | 4 | 0 | 0 | 0 | 0 | 1 |
| LNG-04 | original_language | miss | 13 | 7 | -6 | 0 | 0 | 0 | 1 |
| LNG-05 | original_language | miss | 11 | 13 | 2 | 0 | 0 | 0 | 1 |
| MLT-01 | multiturn | miss | 22 | 16 | -6 | 0 | 0 | 0 | 1 |
| MLT-02 | multiturn | miss | 28 | 27 | -1 | 0 | 0 | 0 | 1 |
| MLT-03 | multiturn | miss | 2 | 0 | -2 | 0 | 0 | 0 | 1 |
| MLT-04 | multiturn | miss | 24 | 23 | -1 | 0.2 | 1 | 1 | 1 |
| MLT-05 | multiturn | miss | 26 | 32 | 6 | 0.2 | 1 | 0.5 | 1 |
| ADV-01 | adversarial | miss | 4 | 4 | 0 | 0 | 0 | 0 | 1 |
| ADV-02 | adversarial | miss | 10 | 6 | -4 | 1 | 1 | 1 | 1 |
| ADV-03 | adversarial | miss | 10 | 8 | -2 | 0 | 0 | 0 | 1 |
| ADV-04 | adversarial | miss | 76 | 58 | -18 | 0.2 | 1 | 1 | 1 |
| ADV-05 | adversarial | miss | 2 | 0 | -2 | 1 | 1 | 1 | 1 |
| GRG-01 | graphrag | miss | 5 | 9 | 4 | 0.2 | 1 | 0.5 | 1 |
| GRG-02 | graphrag | miss | 5 | 5 | 0 | 0 | 0 | 0 | 1 |
| GRG-03 | graphrag | miss | 4 | 4 | 0 | 0 | 0 | 0 | 1 |
