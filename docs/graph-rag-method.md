# GraphRAG V1 — Technical Method

## Overview

GraphRAG V1 adds graph-based retrieval expansion to the existing JSON-first pipeline. It traverses a pre-computed knowledge graph of cross-references and topic relationships to surface contextually related verses that BM25/hybrid search might miss.

**Key constraint:** ≤ 30 ms added p95 latency. No database dependency. No response contract change.

## Graph Schema

### Node Kinds

| Kind | Source | Example |
|---|---|---|
| `verse` | All verse IDs from TSK + topic datasets | `GEN 1:1`, `JOHN 3:16` |
| `topic` | Topic IDs from verse-topics + virtual cluster hubs | `creation`, `cluster:cluster-adulterer-57` |

### Edge Kinds

| Kind | Source | Weight Semantics |
|---|---|---|
| `cluster` | `tsk-clusters.json` | `1 / √(cluster_size)` — hub-and-spoke model |
| `topic` | `verse-topics.json` + `topic-verse-index.json` | `confidence` score (0–1) |

### Hub-and-Spoke Model

TSK clusters use a hub-and-spoke architecture instead of all-pairs edges. Each cluster becomes a virtual hub node, and member verses connect to it. This prevents O(n²) edge explosion on large clusters (the largest has 14,127 members).

## Adjacency Pruning

Each node's adjacency list is pruned to the **top 20 neighbors** by weight descending during the offline build step.

## BFS Traversal Policy

```
1. Load graph-index.json once (lazy, cached in module-level singleton).
2. frontier = seedVerseIds (top 10 from hybrid search, uppercase-normalized).
3. visited = Set(frontier).
4. For depth 1..GRAPH_RAG_MAX_DEPTH:
   a. For each node in frontier:
      - Get neighbors from adjacency map
      - Filter: weight >= GRAPH_RAG_EDGE_MIN_WEIGHT; not in visited
      - Take top GRAPH_RAG_MAX_NEIGHBORS_PER_SEED
      - Score: edge.weight + 0.2 * topicOverlapBonus + (1/depth) * 0.1
   b. Sort all candidates desc by score, take top GRAPH_RAG_MAX_EXPANSIONS
   c. Add to visited; set as next frontier
5. Filter out non-verse nodes (topics, cluster hubs)
6. Return expanded (visited - seeds), ranked by score
```

### Edge Weight Floor

`GRAPH_RAG_EDGE_MIN_WEIGHT` (default `0.1`) filters out low-confidence edges during traversal. This prevents noise from weak topic associations.

### Topic Overlap Scoring

When `queryTopicIds` (detected upstream by the topic classifier) overlaps with a candidate's topic edges, a `0.2` bonus is added to its score. This biases expansion toward thematically relevant cross-references.

## Feature Flag Reference

| Flag | Default | Description |
|---|---|---|
| `ENABLE_GRAPH_RAG` | `0` (off) | Master toggle for graph expansion |
| `GRAPH_RAG_MAX_DEPTH` | `2` | BFS depth limit |
| `GRAPH_RAG_MAX_EXPANSIONS` | `30` | Max expanded candidates total |
| `GRAPH_RAG_MAX_NEIGHBORS_PER_SEED` | `10` | Per-node neighbor cap |
| `GRAPH_RAG_EDGE_MIN_WEIGHT` | `0.1` | Minimum edge weight threshold |

## Building the Graph Index

```bash
# Rebuild the offline graph index from source data
npm run build:graph-index

# Verify output
node -e "const g = require('./data/graph-index.json'); console.log(g.metadata);"
```

Source files consumed:
- `data/tsk-clusters.json` — TSK cross-reference clusters
- `data/verse-topics.json` — verse→topic assignments with confidence
- `data/topic-verse-index.json` — topic→verse reverse index

Output: `data/graph-index.json` (~5.7 MB, 25,457 nodes, 35,644 edges)

## Safety Invariants

1. Missing or corrupt `graph-index.json` → empty expansion, never throws
2. Empty graph → seed-only behavior
3. Total expanded candidates hard-capped at `GRAPH_RAG_MAX_EXPANSIONS`
4. Graph-expanded candidates enter the reranker at `score=0` — reranker signals determine final rank
5. Flag defaults OFF — production traffic unaffected until benchmarks pass
