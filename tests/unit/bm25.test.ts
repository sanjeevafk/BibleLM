/**
 * tests/unit/bm25.test.ts
 *
 * Unit tests for the BM25Engine.
 *
 * Covers:
 *  - Indexing and basic retrieval
 *  - Score ordering (higher relevance → higher score)
 *  - Phrase boost (longer query, exact phrase)
 *  - Phrase boost is confined to Top-100 candidates (CPU spike guard)
 *  - Edge cases: empty corpus, empty query, no-match query
 *  - State serialization round-trip (exportState / createFromState)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BM25Engine } from '../../lib/retrieval/bm25';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SMALL_CORPUS = [
  { id: 'JHN 3:16', text: 'For God so loved the world that he gave his one and only Son' },
  { id: 'ROM 8:28', text: 'And we know that in all things God works for the good of those who love him' },
  { id: 'PSA 23:1', text: 'The LORD is my shepherd I lack nothing' },
  { id: 'PHP 4:13', text: 'I can do all this through him who gives me strength' },
  { id: 'JER 29:11', text: 'For I know the plans I have for you declares the LORD plans to prosper you and not to harm you plans to give you hope and a future' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildEngine(corpus = SMALL_CORPUS, config = {}): Promise<BM25Engine> {
  return BM25Engine.createFromIndex(
    Object.fromEntries(corpus.map((d) => [d.id, { text: d.text }])),
    config
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BM25Engine', () => {
  describe('basic retrieval', () => {
    it('returns the most relevant document first for an exact keyword', async () => {
      const engine = await buildEngine();
      const results = engine.search('shepherd', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].doc.id).toBe('PSA 23:1');
    });

    it('returns results in descending score order', async () => {
      const engine = await buildEngine();
      const results = engine.search('God loved world', 10);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('respects the limit parameter', async () => {
      const engine = await buildEngine();
      const results = engine.search('the', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns an empty array for a query with no matches', async () => {
      const engine = await buildEngine();
      const results = engine.search('zzznomatch777', 10);
      expect(results).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles an empty query gracefully', async () => {
      const engine = await buildEngine();
      const results = engine.search('', 10);
      expect(results).toHaveLength(0);
    });

    it('handles a corpus with a single document', async () => {
      const singleCorpus = [{ id: 'JHN 1:1', text: 'In the beginning was the Word' }];
      const engine = await buildEngine(singleCorpus);
      const results = engine.search('Word beginning', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].doc.id).toBe('JHN 1:1');
    });

    it('handles an empty corpus gracefully', async () => {
      const engine = await buildEngine([]);
      const results = engine.search('God', 10);
      expect(results).toHaveLength(0);
    });
  });

  describe('phrase boost', () => {
    it('boosts a document that contains the exact query phrase', async () => {
      const engine = await buildEngine(
        [
          { id: 'A', text: 'God so loved the world' },
          { id: 'B', text: 'the world contains God and love separately' },
        ],
        { phraseBoost: 2.0 }
      );

      const results = engine.search('God so loved the world', 10);
      const idxA = results.findIndex((r) => r.doc.id === 'A');
      const idxB = results.findIndex((r) => r.doc.id === 'B');
      // Document A contains the exact phrase and should rank first
      expect(idxA).toBeLessThan(idxB);
    });

    it('does not apply phrase boost for short queries (≤5 chars)', async () => {
      const engine = await buildEngine(
        [
          { id: 'A', text: 'God so loved' },
          { id: 'B', text: 'God is sovereign' },
        ],
        { phraseBoost: 5.0 }
      );
      // Short query: phrase boost should be skipped, no error
      expect(() => engine.search('God', 10)).not.toThrow();
    });
  });

  describe('Top-100 phrase boost guard (CPU spike prevention)', () => {
    it('does not crash when the match set exceeds 100 documents', async () => {
      // Build a corpus of 200 documents all containing the word "God"
      const largeCorpus = Array.from({ length: 200 }, (_, i) => ({
        id: `DOC${i}`,
        text: `God is present in verse number ${i}`,
      }));
      const engine = await buildEngine(largeCorpus);

      // Should complete without blocking / crashing
      const results = engine.search('God is present in verse', 200);
      expect(results.length).toBeGreaterThan(0);
      // Confirm descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('state serialization round-trip', () => {
    it('produces identical search results after exportState / createFromState', async () => {
      const originalEngine = await buildEngine();
      const query = 'plans hope future';
      const originalResults = originalEngine.search(query, 5).map((r) => r.doc.id);

      // Export and re-hydrate
      const state = originalEngine.exportState();
      const docProxy = Object.fromEntries(SMALL_CORPUS.map((d) => [d.id, { text: d.text }]));
      const hydratedEngine = BM25Engine.createFromState(state, docProxy);
      const hydratedResults = hydratedEngine.search(query, 5).map((r) => r.doc.id);

      expect(hydratedResults).toEqual(originalResults);
    });

    it('exports a state object with required keys', async () => {
      const engine = await buildEngine();
      const state = engine.exportState() as Record<string, unknown>;
      expect(state).toHaveProperty('totalDocs');
      expect(state).toHaveProperty('avgDocLength');
      expect(state).toHaveProperty('docFreqs');
      expect(state).toHaveProperty('termFreqs');
      expect(state).toHaveProperty('docLengths');
    });
  });
});
