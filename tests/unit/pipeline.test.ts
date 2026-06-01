/**
 * Unit tests for retrieval pipeline utilities.
 * Tests focus on the deterministic, pure logic — no I/O, no DB calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Semantic gate tests (pure logic, no external deps)
// ---------------------------------------------------------------------------

import {
  detectMatchedTopics,
  isLowRetrievalConfidence,
  clearTopicEmbeddingCache,
} from '@/lib/retrieval/semantic-gate';

// Mock embedQuery so no real embedding model is called.
vi.mock('@/lib/retrieval/semantic', () => ({
  embedQuery: vi.fn().mockResolvedValue(null),
}));

const MOCK_TOPICS = [
  { id: 'salvation', label: 'Salvation', synonyms: ['saved', 'redemption', 'grace'] },
  { id: 'faith',    label: 'Faith',     synonyms: ['belief', 'trust', 'hope'] },
  { id: 'prayer',   label: 'Prayer',    synonyms: ['intercession', 'supplication'] },
];

describe('detectMatchedTopics', () => {
  beforeEach(() => clearTopicEmbeddingCache());

  it('returns empty set for empty query', async () => {
    const result = await detectMatchedTopics('', MOCK_TOPICS);
    expect(result.size).toBe(0);
  });

  it('returns empty set when topics list is empty', async () => {
    const result = await detectMatchedTopics('salvation', []);
    expect(result.size).toBe(0);
  });

  it('matches a topic by strong lexical overlap', async () => {
    const result = await detectMatchedTopics('what does the bible say about salvation grace', MOCK_TOPICS);
    expect(result.has('salvation')).toBe(true);
  });

  it('matches faith-related query', async () => {
    const result = await detectMatchedTopics('how should believers trust and hope in god', MOCK_TOPICS);
    expect(result.has('faith')).toBe(true);
  });

  it('returns at most 3 matched topics', async () => {
    const result = await detectMatchedTopics(
      'salvation redemption faith trust prayer supplication intercession',
      MOCK_TOPICS
    );
    expect(result.size).toBeLessThanOrEqual(3);
  });

  it('resets topicEmbeddingCachePromise on embedQuery failure, allowing retries', async () => {
    const { embedQuery } = await import('@/lib/retrieval/semantic');
    
    // 1. Force the first embedding call to fail
    (embedQuery as any).mockRejectedValueOnce(new Error('API quota exceeded'));
    
    // First attempt should reject (use a query that avoids early lexical match)
    await expect(detectMatchedTopics('unknownword', MOCK_TOPICS)).rejects.toThrow('API quota exceeded');

    // 2. Setup the next call to succeed
    (embedQuery as any).mockResolvedValueOnce([0.1, 0.2, 0.3]);
    
    // Second attempt should re-initialize the cache and succeed without throwing
    const result = await detectMatchedTopics('unknownword', MOCK_TOPICS);
    expect(result).toBeInstanceOf(Set);
  });
});

// ---------------------------------------------------------------------------
// isLowRetrievalConfidence tests
// ---------------------------------------------------------------------------

describe('isLowRetrievalConfidence', () => {
  it('returns true for empty results', () => {
    expect(isLowRetrievalConfidence([], 5, 0.75)).toBe(true);
  });

  it('returns true when average score is below threshold', () => {
    const results = [{ score: 0.5 }, { score: 0.4 }, { score: 0.3 }];
    expect(isLowRetrievalConfidence(results, 5, 0.75)).toBe(true);
  });

  it('returns false when average score meets threshold', () => {
    const results = [{ score: 0.9 }, { score: 0.85 }, { score: 0.8 }];
    expect(isLowRetrievalConfidence(results, 5, 0.75)).toBe(false);
  });

  it('uses only the top-K entries (max 5)', () => {
    // First 5 entries are high-confidence, rest are low — should return false.
    const results = [
      { score: 0.9 }, { score: 0.9 }, { score: 0.9 }, { score: 0.9 }, { score: 0.9 },
      { score: 0.1 }, { score: 0.1 },
    ];
    expect(isLowRetrievalConfidence(results, 10, 0.75)).toBe(false);
  });

  it('treats missing score as 0', () => {
    const results = [{}, {}, {}] as Array<{ score?: number }>;
    expect(isLowRetrievalConfidence(results, 5, 0.75)).toBe(true);
  });
});
