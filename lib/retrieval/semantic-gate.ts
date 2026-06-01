/**
 * Semantic gate and topic-matching utilities for the retrieval pipeline.
 *
 * Extracted from pipeline.ts to isolate the embedding-dependent logic
 * and make it independently testable without loading the full pipeline.
 */

import { embedQuery } from './semantic';

// ---------------------------------------------------------------------------
// Constants (mirrored from pipeline.ts to avoid coupling)
// ---------------------------------------------------------------------------

const TOPIC_EMBED_THRESHOLD = 0.35;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TopicDatasetItem = {
  id: string;
  label: string;
  synonyms: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

function tokenOverlapScore(queryTokens: Set<string>, candidateTokens: Set<string>): number {
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;
  let hits = 0;
  for (const token of candidateTokens) {
    if (queryTokens.has(token)) hits += 1;
  }
  return hits / candidateTokens.size;
}

// ---------------------------------------------------------------------------
// Topic embedding cache (module-level singleton)
// ---------------------------------------------------------------------------

let topicEmbeddingCachePromise: Promise<Map<string, number[]> | null> | null = null;

/** Clears the topic embedding cache. Useful in tests. */
export function clearTopicEmbeddingCache(): void {
  topicEmbeddingCachePromise = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detects which topics from the topic dataset match the given normalised query,
 * using lexical overlap first and falling back to vector similarity if needed.
 *
 * Returns a Set of matched topic IDs (empty if no match or topics unavailable).
 */
export async function detectMatchedTopics(
  normalizedQuery: string,
  topics: TopicDatasetItem[]
): Promise<Set<string>> {
  if (!topics || topics.length === 0) return new Set();

  const queryTokens = new Set(tokenize(normalizedQuery));

  // --- Stage 1: Lexical overlap ---
  const lexicalMatches: Array<{ id: string; score: number }> = [];
  for (const topic of topics) {
    const candidateTokens = new Set(tokenize(`${topic.label} ${topic.synonyms.join(' ')}`));
    const score = tokenOverlapScore(queryTokens, candidateTokens);
    if (score > 0) lexicalMatches.push({ id: topic.id, score });
  }

  lexicalMatches.sort((a, b) => b.score - a.score);

  const strongLexical = lexicalMatches.filter((m) => m.score >= 0.4).slice(0, 3);
  if (strongLexical.length > 0) return new Set(strongLexical.map((m) => m.id));

  const weakLexical = lexicalMatches.slice(0, 3);
  if (weakLexical.length > 0 && weakLexical[0].score >= 0.2) {
    return new Set(weakLexical.map((m) => m.id));
  }

  // --- Stage 2: Embedding similarity fallback ---
  const queryEmbedding = await embedQuery(normalizedQuery);
  if (!queryEmbedding) return new Set();

  if (!topicEmbeddingCachePromise) {
    topicEmbeddingCachePromise = (async () => {
      try {
        const cache = new Map<string, number[]>();
        for (const topic of topics) {
          const embedding = await embedQuery(`${topic.label}. ${topic.synonyms.slice(0, 4).join(', ')}`);
          if (embedding && embedding.length > 0) cache.set(topic.id, embedding);
        }
        return cache;
      } catch (err) {
        // Reset so the next call can retry instead of awaiting a poisoned promise.
        topicEmbeddingCachePromise = null;
        throw err;
      }
    })();
  }

  const topicEmbeddings = await topicEmbeddingCachePromise;
  if (!topicEmbeddings || topicEmbeddings.size === 0) return new Set();

  const scored: Array<{ id: string; score: number }> = [];
  for (const topic of topics) {
    const embedding = topicEmbeddings.get(topic.id);
    if (!embedding || embedding.length !== queryEmbedding.length) continue;
    let dot = 0;
    for (let i = 0; i < embedding.length; i += 1) dot += queryEmbedding[i] * embedding[i];
    scored.push({ id: topic.id, score: dot });
  }

  return new Set(
    scored
      .filter((entry) => entry.score >= TOPIC_EMBED_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.id)
  );
}

/**
 * Returns true if the average score of the top-K hybrid results
 * falls below the minimum retrieval confidence threshold.
 */
export function isLowRetrievalConfidence(
  hybridResults: Array<{ score?: number }>,
  topK: number,
  minConfidence: number
): boolean {
  if (hybridResults.length === 0) return true;
  const top = hybridResults.slice(0, Math.min(topK, 5));
  if (top.length === 0) return true;
  const avg = top.reduce((sum, row) => sum + (typeof row.score === 'number' ? row.score : 0), 0) / top.length;
  return avg < minConfidence;
}
