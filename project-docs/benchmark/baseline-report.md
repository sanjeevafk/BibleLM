# Benchmark Report

Generated: 2026-03-14T07:45:23.002Z
Mode: sample

## Aggregate Metrics

| Metric | Baseline | Optimized | Delta |
| --- | ---: | ---: | ---: |
| total_latency_ms | 1434 | 1120 | -314 |
| retrieval_latency_ms | 484.8 | 292.07 | -192.73 |
| llm_latency_ms | 702.47 | 599.47 | -103 |
| p50_latency | 1180 | 950 | -230 |
| p95_latency | 2740 | 2160 | -580 |
| precision_at_5 | 0.8 | 0.88 | 0.08 |
| citation_validity_rate | 0.98 | 1 | 0.02 |

## Scenario Breakdown

| Scenario | Category | Cache | Baseline Total | Optimized Total | Delta | Precision@5 | Citation Validity |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| direct-verse-cache-miss | direct_verse_query | miss | 1176.67 | 950 | -226.67 | 1 | 1 |
| direct-verse-cache-hit | direct_verse_query | hit | 420 | 290 | -130 | 1 | 1 |
| verse-explanation | verse_explanation_query | miss | 1990 | 1593.33 | -396.67 | 0.8 | 1 |
| topical-cache-miss | topical_query | miss | 2703.33 | 2130 | -573.33 | 0.8 | 1 |
| topical-cache-hit | topical_query | hit | 880 | 636.67 | -243.33 | 0.8 | 1 |
