import * as fs from 'fs';
import * as path from 'path';
import type { Client } from '@libsql/client';
import { getTursoClient } from '../db';
import {
  GRAPH_RAG_MAX_DEPTH,
  GRAPH_RAG_MAX_EXPANSIONS,
  GRAPH_RAG_MAX_NEIGHBORS_PER_SEED,
  GRAPH_RAG_EDGE_MIN_WEIGHT
} from '../feature-flags';

export type GraphRagResult = {
  expandedIds: string[];
  candidates: Array<{ verseId: string; score: number }>;
  diagnostics: {
    seedCount: number;
    expandedCount: number;
    traversalDepthReached: number;
    graphLatencyMs: number;
    graphContributionTopK: number;
  };
};

type GraphIndex = {
  version: string;
  nodes: Array<{ id: string; kind: 'verse' | 'topic' }>;
  adjacency: Record<string, Array<{ id: string; weight: number; kind: string }>>;
  metadata: { sourceFiles: string[]; totalEdges: number };
};

let cachedIndex: GraphIndex | null = null;
let hasAttemptedLoad = false;

/**
 * Lazy loads the graph index from data/graph-index.json.
 * Caches it in memory to avoid repetitive disk I/O.
 */
function loadGraphIndex(): GraphIndex | null {
  if (hasAttemptedLoad) return cachedIndex;
  hasAttemptedLoad = true;

  try {
    const indexPath = path.resolve(process.cwd(), 'data', 'graph-index.json');
    if (typeof fs?.existsSync === 'function' && fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8');
      cachedIndex = JSON.parse(content) as GraphIndex;
    } else {
      console.warn(`[GraphRAG] Graph index file not found at ${indexPath}`);
      cachedIndex = null;
    }
  } catch (error) {
    console.warn('[GraphRAG] Failed to load graph index', error);
    cachedIndex = null;
  }

  return cachedIndex;
}

/**
 * Executes BFS GraphRAG expansion directly via Turso SQL.
 * Zero-memory footprint on edge workers (no 20MB JSON file in memory).
 */
async function expandViaTurso(
  client: Client,
  seedVerseIds: string[],
  queryTopicIds: Set<string>,
  opts: {
    maxDepth: number;
    maxExpansions: number;
    maxNeighborsPerSeed: number;
    edgeMinWeight: number;
  },
  startMs: number
): Promise<GraphRagResult> {
  const seedCount = seedVerseIds.length;
  const seedSet = new Set(seedVerseIds.map((id) => id.toUpperCase()));
  let frontier = Array.from(seedSet);
  const visited = new Set<string>(frontier);

  let depthReached = 0;
  let expandedTotalCount = 0;
  const nodeScores = new Map<string, number>();

  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    if (frontier.length === 0) break;
    depthReached = depth;

    const placeholders = frontier.map(() => '?').join(',');
    const res = await client.execute({
      sql: `SELECT source_id, target_id, weight, kind FROM graph_edges WHERE source_id IN (${placeholders}) AND weight >= ? ORDER BY source_id, weight DESC`,
      args: [...frontier, opts.edgeMinWeight],
    });

    const currentCandidates = new Map<string, { score: number; kind: string }>();
    const neighborsBySource = new Map<string, Array<{ target_id: string; weight: number; kind: string }>>();

    for (const row of res.rows as unknown as Array<{ source_id: string; target_id: string; weight: number; kind: string }>) {
      let list = neighborsBySource.get(row.source_id);
      if (!list) {
        list = [];
        neighborsBySource.set(row.source_id, list);
      }
      list.push(row);
    }

    for (const nodeId of frontier) {
      const neighbors = neighborsBySource.get(nodeId) || [];
      const validNeighbors = neighbors
        .filter((n) => !visited.has(n.target_id))
        .slice(0, opts.maxNeighborsPerSeed);

      for (const neighbor of validNeighbors) {
        let topicBonus = 0;
        if (neighbor.kind === 'topic') {
          if (queryTopicIds.has(neighbor.target_id)) {
            topicBonus = 1;
          }
        }

        const score = Number(neighbor.weight) + (0.2 * topicBonus) + ((1 / depth) * 0.1);
        const existing = currentCandidates.get(neighbor.target_id);
        if (!existing || score > existing.score) {
          currentCandidates.set(neighbor.target_id, { score, kind: neighbor.kind });
        }
      }
    }

    if (currentCandidates.size === 0) break;

    const sortedCandidates = Array.from(currentCandidates.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.score - a.score);

    const acceptedCandidates = sortedCandidates.slice(0, opts.maxExpansions);
    frontier = [];
    for (const c of acceptedCandidates) {
      if (expandedTotalCount >= opts.maxExpansions) break;
      visited.add(c.id);
      frontier.push(c.id);
      nodeScores.set(c.id, c.score);
      expandedTotalCount++;
    }

    if (expandedTotalCount >= opts.maxExpansions || frontier.length === 0) break;
  }

  // Finalize results: exclude seeds and non-verse nodes
  const isVerseId = (id: string): boolean => /(?:[1-3]\s+)?[A-Z0-9]{2,4}\s+\d+:\d+/i.test(id);

  const expandedIds = Array.from(visited)
    .filter((id) => !seedSet.has(id))
    .filter((id) => isVerseId(id))
    .sort((a, b) => (nodeScores.get(b) || 0) - (nodeScores.get(a) || 0));

  const candidates = expandedIds.map((id) => {
    const rawScore = nodeScores.get(id) || 0.5;
    const calibratedScore = Math.min(0.85, Math.max(0.40, Math.round(rawScore * 0.65 * 10000) / 10000));
    return { verseId: id, score: calibratedScore };
  });

  return {
    expandedIds,
    candidates,
    diagnostics: {
      seedCount,
      expandedCount: expandedIds.length,
      traversalDepthReached: depthReached,
      graphLatencyMs: performance.now() - startMs,
      graphContributionTopK: expandedIds.length,
    },
  };
}

/**
 * Expands a set of seed verses using GraphRAG BFS traversal on the knowledge graph.
 */
export async function graphRagExpand(
  seedVerseIds: string[],
  queryTopicIds: Set<string>,
  opts?: {
    maxDepth?: number;
    maxExpansions?: number;
    maxNeighborsPerSeed?: number;
    edgeMinWeight?: number;
  }
): Promise<GraphRagResult> {
  const startMs = performance.now();
  const seedCount = seedVerseIds.length;
  
  const emptyResult = (diagnostics: Partial<GraphRagResult['diagnostics']> = {}): GraphRagResult => ({
    expandedIds: [],
    candidates: [],
    diagnostics: {
      seedCount,
      expandedCount: 0,
      traversalDepthReached: 0,
      graphLatencyMs: performance.now() - startMs,
      graphContributionTopK: 0,
      ...diagnostics
    }
  });

  if (seedCount === 0) {
    return emptyResult();
  }

  const maxDepth = opts?.maxDepth ?? GRAPH_RAG_MAX_DEPTH;
  const maxExpansions = opts?.maxExpansions ?? GRAPH_RAG_MAX_EXPANSIONS;
  const maxNeighborsPerSeed = opts?.maxNeighborsPerSeed ?? GRAPH_RAG_MAX_NEIGHBORS_PER_SEED;
  const edgeMinWeight = opts?.edgeMinWeight ?? GRAPH_RAG_EDGE_MIN_WEIGHT;

  // Primary edge path: query Turso SQL directly if available
  const tursoClient = getTursoClient();
  if (tursoClient) {
    try {
      return await expandViaTurso(
        tursoClient,
        seedVerseIds,
        queryTopicIds,
        { maxDepth, maxExpansions, maxNeighborsPerSeed, edgeMinWeight },
        startMs
      );
    } catch (err) {
      console.warn('[GraphRAG] Turso query failed; falling back to local graph index:', err);
    }
  }

  // Fallback: local in-memory index
  const index = loadGraphIndex();
  if (!index) {
    return emptyResult();
  }

  // Initialize frontier with normalized, deduplicated seeds
  const seedSet = new Set(seedVerseIds.map(id => id.toUpperCase()));
  let frontier = Array.from(seedSet);
  const visited = new Set<string>(frontier);
  
  // Build a lookup from the index's nodes array for correct node kind filtering
  const nodeKindMap = new Map<string, string>();
  for (const node of index.nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  let depthReached = 0;
  let expandedTotalCount = 0;
  const nodeScores = new Map<string, number>();

  // Bounded BFS Traversal
  for (let depth = 1; depth <= maxDepth; depth++) {
    depthReached = depth;
    
    // Collect candidates for this depth step
    const currentCandidates = new Map<string, { score: number, kind: string }>();

    for (const nodeId of frontier) {
      const neighbors = index.adjacency[nodeId];
      if (!neighbors) continue;

      // Filter: weight >= edgeMinWeight; not in visited; take top maxNeighborsPerSeed
      const validNeighbors = neighbors
        .filter(n => n.weight >= edgeMinWeight && !visited.has(n.id))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, maxNeighborsPerSeed);

      for (const neighbor of validNeighbors) {
        let topicBonus = 0;
        
        // Query topic overlap bonus
        if (neighbor.kind === 'topic') {
          if (queryTopicIds.has(neighbor.id)) {
            topicBonus = 1;
          }
        } else if (neighbor.kind === 'verse') {
          const nNeighbors = index.adjacency[neighbor.id];
          if (nNeighbors) {
            const hasMatchingTopic = nNeighbors.some(
              nn => nn.kind === 'topic' && queryTopicIds.has(nn.id)
            );
            if (hasMatchingTopic) {
              topicBonus = 1;
            }
          }
        }

        // Score formulation
        const score = neighbor.weight + (0.2 * topicBonus) + ((1 / depth) * 0.1);
        
        const existing = currentCandidates.get(neighbor.id);
        if (!existing || score > existing.score) {
          currentCandidates.set(neighbor.id, { score, kind: neighbor.kind });
        }
      }
    }

    if (currentCandidates.size === 0) break;

    // Sort descending by score and take top maxExpansions for this depth step
    const sortedCandidates = Array.from(currentCandidates.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.score - a.score);
    
    const acceptedCandidates = sortedCandidates.slice(0, maxExpansions);
    
    frontier = [];
    for (const c of acceptedCandidates) {
      if (expandedTotalCount >= maxExpansions) {
        break; // Hard cap on total expanded candidates across all depths
      }
      
      visited.add(c.id);
      frontier.push(c.id);
      nodeScores.set(c.id, c.score);
      
      expandedTotalCount++;
    }
    
    if (expandedTotalCount >= maxExpansions || frontier.length === 0) {
      break;
    }
  }

  // Finalize results: exclude seeds and non-verse nodes
  const expandedIds = Array.from(visited)
    .filter(id => !seedSet.has(id))
    .filter(id => nodeKindMap.get(id) === 'verse')
    .sort((a, b) => (nodeScores.get(b) || 0) - (nodeScores.get(a) || 0));

  // Calibrate raw graph scores to fusedScore scale [0.45, 0.85]
  const candidates = expandedIds.map((id) => {
    const rawScore = nodeScores.get(id) || 0.5;
    // Map rawScore (typically 0.3 - 1.5) to a fair base score that can compete in reranker.
    // Round-half-up via integer math — NOT Number.toFixed(4): toFixed rounds
    // the exact binary value while Rust rounds (x*10000), which disagree by
    // 1ulp on 4th-decimal halfway cases (e.g. 0.53755 → 0.5375 vs 0.5376).
    // This form is bit-identical to the Rust port by construction (same
    // IEEE754 doubles, same op order).
    const calibratedScore = Math.min(0.85, Math.max(0.40, Math.round(rawScore * 0.65 * 10000) / 10000));
    return { verseId: id, score: calibratedScore };
  });

  const latencyMs = performance.now() - startMs;

  return {
    expandedIds,
    candidates,
    diagnostics: {
      seedCount,
      expandedCount: expandedIds.length,
      traversalDepthReached: depthReached,
      graphLatencyMs: latencyMs,
      graphContributionTopK: expandedIds.length
    }
  };
}
