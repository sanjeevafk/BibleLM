/**
 * Unit tests for conditional neural re-ranking.
 * Covers gating (skip vs trigger) and graceful RRF fallback.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  RERANK_MAX_CANDIDATES,
  RERANK_MODEL,
  rerankCandidates,
  shouldRerank,
} from '@/lib/retrieval/reranker';
import type { RankedVerse } from '@/lib/retrieval/types';

function ranked(scores: number[], similarities?: number[]): RankedVerse[] {
  return scores.map((score, index) => ({
    verseId: `GEN 1:${index + 1}`,
    score,
    rankLexical: index + 1,
    ...(similarities ? { semanticSimilarity: similarities[index] } : {}),
  }));
}

const TEXTS = new Map([
  ['GEN 1:1', 'In the beginning God created the heavens and the earth.'],
  ['GEN 1:2', 'Now the earth was formless and void.'],
  ['GEN 1:3', 'And God said, Let there be light.'],
]);

// ---------------------------------------------------------------------------
// shouldRerank — skips
// ---------------------------------------------------------------------------

describe('shouldRerank skips', () => {
  it('direct citation queries skip re-ranking', () => {
    const candidates = ranked([0.5, 0.48, 0.47, 0.46, 0.45, 0.44]);
    expect(shouldRerank('John 3:16', candidates, 'DIRECT_REFERENCE')).toBe(false);
    expect(shouldRerank('1 Corinthians 13:4-7', candidates, 'DIRECT_REFERENCE')).toBe(false);
    expect(shouldRerank('what does Romans 8:28 mean?', candidates, 'VERSE_EXPLANATION')).toBe(false);
  });

  it('single keyword queries skip re-ranking', () => {
    const candidates = ranked([0.5, 0.48, 0.47, 0.46, 0.45, 0.44]);
    expect(shouldRerank('faith', candidates, 'TOPICAL_QUERY')).toBe(false);
  });

  it('short queries (≤4 words) skip re-ranking', () => {
    const candidates = ranked([0.5, 0.48, 0.47, 0.46, 0.45, 0.44]);
    expect(shouldRerank('love hope faith peace', candidates, 'TOPICAL_QUERY')).toBe(false);
  });

  it('strong top-1 confidence skips re-ranking', () => {
    // top-1 0.90 with 0.10 margin over rank 2.
    const candidates = ranked([0.9, 0.8, 0.5, 0.4, 0.3, 0.2]);
    expect(
      shouldRerank('what does the bible teach about forgiveness and mercy', candidates, 'TOPICAL_QUERY')
    ).toBe(false);
  });

  it('needs at least two candidates to rank', () => {
    expect(shouldRerank('what does the bible teach about forgiveness', ranked([0.5]), 'TOPICAL_QUERY')).toBe(false);
    expect(shouldRerank('', [], 'TOPICAL_QUERY')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldRerank — triggers
// ---------------------------------------------------------------------------

describe('shouldRerank triggers', () => {
  it('thematic queries trigger re-ranking', () => {
    const candidates = ranked([0.6, 0.55, 0.5, 0.45, 0.4, 0.35]);
    expect(
      shouldRerank('what does the bible teach about forgiveness and mercy', candidates, 'TOPICAL_QUERY')
    ).toBe(true);
  });

  it('weak top-1 vector similarity triggers re-ranking', () => {
    const candidates = ranked(
      [0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
      [0.7, 0.65, 0.6, 0.55, 0.5, 0.45]
    );
    expect(
      shouldRerank('how should believers handle anxiety about the future', candidates, 'VERSE_EXPLANATION')
    ).toBe(true);
  });

  it('ambiguous top-5 spread triggers re-ranking', () => {
    // Spread 0.02 < 0.04 with no strong top-1.
    const candidates = ranked([0.5, 0.495, 0.49, 0.485, 0.48, 0.3]);
    expect(
      shouldRerank('explain the meaning of walking in the spirit daily', candidates, 'VERSE_EXPLANATION')
    ).toBe(true);
  });

  it('defaults to no rerank without a positive trigger', () => {
    // Decisive spread, no topic intent, no weak similarity.
    const candidates = ranked(
      [0.7, 0.55, 0.4, 0.3, 0.2, 0.1],
      [0.9, 0.85, 0.8, 0.79, 0.78, 0.77]
    );
    expect(
      shouldRerank('explain the meaning of walking in the spirit daily', candidates, 'VERSE_EXPLANATION')
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rerankCandidates — model path and fallbacks
// ---------------------------------------------------------------------------

describe('rerankCandidates', () => {
  it('reorders by softmax probabilities and stamps relevanceScore', async () => {
    const run = vi.fn().mockResolvedValue({
      response: [
        { id: 0, score: 0.1 },
        { id: 1, score: 2.0 },
        { id: 2, score: 0.5 },
      ],
    });
    const { ranked: result, applied } = await rerankCandidates(
      'let there be light',
      ranked([0.5, 0.48, 0.47]),
      TEXTS,
      { run }
    );
    expect(applied).toBe(true);
    expect(run).toHaveBeenCalledWith(
      RERANK_MODEL,
      expect.objectContaining({ query: 'let there be light' })
    );
    expect(result.map((c) => c.verseId)).toEqual(['GEN 1:2', 'GEN 1:3', 'GEN 1:1']);
    const total = result.reduce((sum, c) => sum + (c.relevanceScore ?? 0), 0);
    expect(total).toBeCloseTo(1, 5);
    for (const candidate of result) {
      expect(candidate.score).toBe(candidate.relevanceScore);
    }
    // Original input untouched.
    expect(result).not.toHaveLength(0);
  });

  it('caps model input at the top 12 candidates', async () => {
    const run = vi.fn().mockResolvedValue({
      response: Array.from({ length: 12 }, (_, index) => ({ id: index, score: 12 - index })),
    });
    const many = Array.from({ length: 20 }, (_, i) => ({
      verseId: `GEN 1:${i + 1}`,
      score: 0.9 - i * 0.01,
      rankLexical: i + 1,
    }));
    const texts = new Map(many.map((c) => [c.verseId, `text for ${c.verseId}`]));
    const { ranked: result, applied } = await rerankCandidates('a sufficiently long thematic query here', many, texts, { run });
    expect(run.mock.calls[0][1].contexts).toHaveLength(RERANK_MAX_CANDIDATES);
    expect(result).toHaveLength(20);
    expect(applied).toBe(true);
  });

  it('falls back to RRF order when aiBinding is undefined', async () => {
    const input = ranked([0.5, 0.48, 0.47]);
    const { ranked: result, applied } = await rerankCandidates('let there be light', input, TEXTS, undefined);
    expect(applied).toBe(false);
    expect(result.map((c) => c.verseId)).toEqual(input.map((c) => c.verseId));
  });

  it('falls back to RRF order when the binding throws', async () => {
    const run = vi.fn().mockRejectedValue(new Error('rate limited'));
    const input = ranked([0.5, 0.48, 0.47]);
    const { ranked: result, applied } = await rerankCandidates('let there be light', input, TEXTS, { run });
    expect(applied).toBe(false);
    expect(result.map((c) => c.verseId)).toEqual(input.map((c) => c.verseId));
  });

  it('falls back to RRF order on malformed model responses', async () => {
    const input = ranked([0.5, 0.48, 0.47]);
    for (const bad of [{ nope: true }, { response: [{ index: 0 }] }, { response: [] }, null]) {
      const run = vi.fn().mockResolvedValue(bad);
      const { ranked: result, applied } = await rerankCandidates('let there be light', input, TEXTS, { run });
      expect(applied).toBe(false);
      expect(result.map((c) => c.verseId)).toEqual(input.map((c) => c.verseId));
    }
  });

  it('falls back when all verse texts are missing', async () => {
    const run = vi.fn();
    const input = ranked([0.5, 0.48, 0.47]);
    const { ranked: result, applied } = await rerankCandidates('let there be light', input, new Map(), { run });
    expect(run).not.toHaveBeenCalled();
    expect(applied).toBe(false);
    expect(result.map((c) => c.verseId)).toEqual(input.map((c) => c.verseId));
  });

  it('drops textless candidates from the model call but keeps them in order', async () => {
    const run = vi.fn().mockResolvedValue({
      response: [
        { id: 0, score: 0.2 },
        { id: 1, score: 1.5 },
      ],
    });
    const input = ranked([0.5, 0.48, 0.47]);
    const partial = new Map([['GEN 1:1', 'text one'], ['GEN 1:3', 'text three']]);
    const { ranked: result, applied } = await rerankCandidates('let there be light', input, partial, { run });
    expect(applied).toBe(true);
    // Only the two text-bearing candidates were sent…
    expect(run.mock.calls[0][1].contexts).toHaveLength(2);
    // …the textless GEN 1:2 keeps its relative place behind them.
    expect(result.map((c) => c.verseId)).toEqual(['GEN 1:3', 'GEN 1:1', 'GEN 1:2']);
  });

  it('returns empty for empty input', async () => {
    await expect(rerankCandidates('query query query query query', [], TEXTS, undefined)).resolves.toEqual({
      ranked: [],
      applied: false,
    });
  });
});
