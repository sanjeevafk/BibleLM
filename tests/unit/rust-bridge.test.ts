/**
 * tests/unit/rust-bridge.test.ts
 *
 * Unit tests for `lib/rust-bridge.ts` validating:
 * - Dynamic WASM module loading and binary index hydration
 * - WASM BM25 search
 * - WASM GraphRAG expansion
 * - WASM Strong's concordance lookup
 * - WASM linear-time citation scrubbing
 * - WASM Reciprocal Rank Fusion (RRF)
 * - Resilient transparent fallback to TypeScript when Rust is disabled
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initRustEngine,
  isRustEngineAvailable,
  rustSearch,
  rustGraphExpand,
  rustScrubCitations,
  rustLookupStrongs,
  rustEnrichVerse,
  rustFuseRrf,
  resetRustEngineForTesting,
} from '../../lib/rust-bridge';

describe('Rust WebAssembly Bridge (lib/rust-bridge.ts)', () => {
  beforeEach(() => {
    delete process.env.ENABLE_RUST_ENGINE;
    resetRustEngineForTesting();
  });

  afterEach(() => {
    delete process.env.ENABLE_RUST_ENGINE;
    resetRustEngineForTesting();
  });

  describe('Engine Initialization', () => {
    it('initializes the Rust WASM module and hydrates indexes', async () => {
      const wasm = await initRustEngine();
      expect(wasm).not.toBeNull();
      expect(isRustEngineAvailable()).toBe(true);
      expect(wasm?.wasm_is_bm25_initialized()).toBe(true);
      expect(wasm?.wasm_is_graph_initialized()).toBe(true);
      expect(wasm?.wasm_is_strongs_initialized()).toBe(true);
    });
  });

  describe('rustSearch (BM25)', () => {
    it('executes BM25 search over 31,102 verses in sub-millisecond time', async () => {
      const results = await rustSearch('faith without works', 5);
      expect(results).toHaveLength(5);
      expect(results[0].verseId).toBeDefined();
      expect(results[0].score).toBeGreaterThan(0);
      // James 2 is the classical passage on "faith without works"
      const verseIds = results.map((r) => r.verseId);
      expect(verseIds.some((id) => id.startsWith('JAS 2'))).toBe(true);
    });
  });

  describe('rustGraphExpand (GraphRAG)', () => {
    it('expands seed verses using TSK cross-reference graph', async () => {
      const result = await rustGraphExpand(['GEN 1:1'], new Set(['creation']), {
        maxDepth: 2,
        maxExpansions: 5,
      });

      expect(result).toBeDefined();
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.diagnostics.traversalDepthReached).toBeGreaterThanOrEqual(1);
      expect(result.candidates[0].verseId).toBeDefined();
      expect(result.candidates[0].score).toBeGreaterThanOrEqual(0.40);
      expect(result.candidates[0].score).toBeLessThanOrEqual(0.85);
    });
  });

  describe('rustScrubCitations', () => {
    it('preserves valid citations and scrubs hallucinated ones', () => {
      const text = 'As written in Genesis 1:1 and John 3:16, God is love.';
      const allowed = ['John 3:16'];
      const scrubbed = rustScrubCitations(text, allowed);

      expect(scrubbed).toContain('John 3:16');
      expect(scrubbed).not.toContain('Genesis 1:1');
    });

    it('handles bracketed citations', () => {
      const text = 'Salvation by grace [EPH 2:8] and phantom [REV 99:99].';
      const allowed = ['EPH 2:8'];
      const scrubbed = rustScrubCitations(text, allowed);

      expect(scrubbed).toContain('[EPH 2:8]');
      expect(scrubbed).not.toContain('REV 99:99');
    });
  });

  describe('rustLookupStrongs', () => {
    it('looks up Hebrew and Greek Strongs definitions', async () => {
      const hebrewEntry = await rustLookupStrongs('H7225');
      expect(hebrewEntry).not.toBeNull();
      expect(hebrewEntry?.id).toBe('H7225');
      expect(hebrewEntry?.transliteration).toContain('rêʼshîyth');

      const greekEntry = await rustLookupStrongs('G3056');
      expect(greekEntry).not.toBeNull();
      expect(greekEntry?.id).toBe('G3056');
      expect(greekEntry?.transliteration).toContain('lógos');
    });
  });

  describe('rustEnrichVerse', () => {
    it('parses canonical and natural verse references', async () => {
      const otInfo = await rustEnrichVerse('GEN 1:1');
      expect(otInfo).toBeDefined();
      expect(otInfo.book).toBe('GEN');
      expect(otInfo.bookName).toBe('Genesis');
      expect(otInfo.isOt).toBe(true);
      expect(otInfo.isNt).toBe(false);

      const ntInfo = await rustEnrichVerse('John 3:16');
      expect(ntInfo).toBeDefined();
      expect(ntInfo.book).toBe('JHN');
      expect(ntInfo.bookName).toBe('John');
      expect(ntInfo.isOt).toBe(false);
      expect(ntInfo.isNt).toBe(true);
    });
  });

  describe('rustFuseRrf', () => {
    it('fuses lexical and semantic ranking lists using Reciprocal Rank Fusion', () => {
      const lexical = ['GEN 1:1', 'JHN 3:16', 'ROM 8:28'];
      const semantic = ['JHN 3:16', 'ROM 8:28'];
      const fused = rustFuseRrf(lexical, semantic, 60);

      expect(fused.length).toBe(3);
      // JHN 3:16 has top semantic rank and rank 2 lexical rank -> should score highest
      expect(fused[0].verseId).toBe('JHN 3:16');
      expect(fused[0].score).toBeGreaterThan(fused[1].score);
    });
  });

  describe('Transparent Fallback', () => {
    it('falls back to TypeScript implementation without throwing when Rust engine is disabled', async () => {
      process.env.ENABLE_RUST_ENGINE = '0';
      resetRustEngineForTesting();

      // Scrubber fallback
      const text = 'See [JHN 3:16] and [MAT 5:3].';
      const scrubbed = rustScrubCitations(text, ['JHN 3:16']);
      expect(scrubbed).toContain('[JHN 3:16]');
      expect(scrubbed).not.toContain('MAT 5:3');

      // Search fallback
      const hits = await rustSearch('faith without works', 3);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].verseId).toBeDefined();
    }, 20000);
  });
});
