# Benchmark Report

Generated: 2026-08-12T08:18:09.634Z
Mode: live

- Live report executes real retrieval pipeline calls and computes metrics from expectedTopRefs.
- llm_latency_ms is set to 0 in live mode because this benchmark currently targets retrieval quality and retrieval latency only.

## Aggregate Metrics

| Metric | Baseline | Optimized | Delta |
| --- | ---: | ---: | ---: |
| total_latency_ms | 135.07 | 16.45 | -118.62 |
| retrieval_latency_ms | 135.07 | 16.45 | -118.62 |
| llm_latency_ms | 0 | 0 | 0 |
| p50_latency | 28 | 5 | -23 |
| p95_latency | 424 | 42 | -382 |
| precision_at_5 | 0.08 | 0.08 | 0 |
| citation_validity_rate | 1 | 1 | 0 |
| hit_at_1 | 0.15 | 0.15 | 0 |
| hit_at_5 | 0.2 | 0.2 | 0 |
| mrr | 0.16 | 0.16 | 0 |

## Scenario Breakdown

| Scenario | Category | Cache | Baseline Total | Optimized Total | Delta | Precision@5 | Hit@5 | MRR | Citation Validity |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| direct-verse-cache-miss | direct_verse_query | miss | 1157.5 | 2 | -1155.5 | 0 | 0 | 0 | 1 |
| direct-verse-cache-hit | direct_verse_query | hit | 2 | 8.5 | 6.5 | 0 | 0 | 0 | 1 |
| verse-explanation | verse_explanation_query | miss | 20 | 0.5 | -19.5 | 1 | 1 | 1 | 1 |
| topical-cache-miss | topical_query | miss | 212.5 | 1 | -211.5 | 0 | 0 | 0 | 1 |
| topical-cache-hit | topical_query | hit | 0.5 | 0.5 | 0 | 0 | 0 | 0 | 1 |
| faith-vs-works | topical_query | miss | 190.5 | 48.5 | -142 | 0 | 0 | 0 | 1 |
| love-your-enemies | teaching_query | miss | 125 | 22.5 | -102.5 | 0 | 0 | 0 | 1 |
| ten-commandments | law_query | miss | 288 | 2 | -286 | 0 | 0 | 0 | 1 |
| jesus-wept | direct_verse_query | miss | 89.5 | 4.5 | -85 | 0 | 0 | 0 | 1 |
| damascus-conversion | narrative_query | miss | 151 | 33.5 | -117.5 | 0 | 0 | 0 | 1 |
| creation-account | passage_query | miss | 11 | 0.5 | -10.5 | 0 | 0 | 0 | 1 |
| great-commission | teaching_query | miss | 56.5 | 7 | -49.5 | 0 | 0 | 0 | 1 |
| fruit-of-spirit | topical_query | miss | 106.5 | 36.5 | -70 | 0 | 0 | 0 | 1 |
| armor-of-god | topical_query | miss | 91.5 | 41 | -50.5 | 0.2 | 1 | 0.25 | 1 |
| lord-is-shepherd | psalm_query | miss | 65.5 | 41 | -24.5 | 0.2 | 1 | 1 | 1 |
| new-covenant | theology_query | miss | 10 | 2 | -8 | 0 | 0 | 0 | 1 |
| resurrection-hope | theology_query | miss | 46.5 | 35 | -11.5 | 0 | 0 | 0 | 1 |
| beatitudes | teaching_query | miss | 54.5 | 31.5 | -23 | 0 | 0 | 0 | 1 |
| greatest-commandment | teaching_query | miss | 7.5 | 1 | -6.5 | 0.2 | 1 | 1 | 1 |
| just-shall-live-by-faith | theology_query | miss | 15.5 | 10 | -5.5 | 0 | 0 | 0 | 1 |
