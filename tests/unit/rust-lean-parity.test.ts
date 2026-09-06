/**
 * tests/unit/rust-lean-parity.test.ts
 *
 * Guards WASM-vs-production-fallback agreement in CI.
 *
 * `rustSearch` (WASM, hydrated with verse texts for phrase boost) must agree
 * with the lean production fallback (`getBM25Engine`, empty texts, no phrase
 * boost) on rank-1 and top-5 overlap. This is the comparison the offline
 * `biblelm-build eval` does NOT cover (it uses full texts on both sides).
 * See the hydration tradeoff note in `lib/rust-bridge.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initRustEngine, rustSearch, resetRustEngineForTesting } from '../../lib/rust-bridge';
import { getBM25Engine } from '../../lib/retrieval/search';

const QUERIES = [
  'faith without works is dead',
  'for God so loved the world',
  'the Lord is my shepherd I shall not want',
  'in the beginning God created the heaven and the earth',
  'love is patient love is kind',
  'armor of God breastplate helmet shield',
  'Melchizedek priest king Salem',
  'grace through faith not of works lest any man should boast',
  'fruit of the Spirit love joy peace longsuffering',
  'be strong and of a good courage do not be afraid',
];

describe('Rust WASM vs lean-TS production fallback parity', () => {
  beforeEach(() => {
    delete process.env.ENABLE_RUST_ENGINE;
    resetRustEngineForTesting();
  });

  afterEach(() => {
    delete process.env.ENABLE_RUST_ENGINE;
    resetRustEngineForTesting();
  });

  it('agrees on rank-1 (>=90%) with high top-5 overlap (>=80% mean)', async () => {
    const wasm = await initRustEngine();
    expect(wasm?.wasm_is_bm25_initialized()).toBe(true);
    const tsEngine = await getBM25Engine();

    let rank1Matches = 0;
    let overlapSum = 0;

    for (const query of QUERIES) {
      const rustRefs = (await rustSearch(query, 5)).map((h) => h.verseId);
      const tsRefs = tsEngine.search(query, 5).map((h) => h.doc.id);
      if (rustRefs[0] === tsRefs[0]) rank1Matches++;
      overlapSum += rustRefs.filter((r) => tsRefs.includes(r)).length;
    }

    expect(rank1Matches / QUERIES.length).toBeGreaterThanOrEqual(0.9);
    expect(overlapSum / (QUERIES.length * 5)).toBeGreaterThanOrEqual(0.8);
  }, 60000);
});
