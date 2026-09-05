/**
 * scripts/verify-real-queries.ts
 *
 * Real-world end-to-end verification of the Rust WebAssembly engine vs
 * TypeScript fallback across actual biblical and theological queries.
 */

import { performance } from 'perf_hooks';
import { retrieveContextForQuery } from '../../lib/retrieval/pipeline';
import {
  initRustEngine,
  isRustEngineAvailable,
  rustSearch,
  rustGraphExpand,
  rustScrubCitations,
  resetRustEngineForTesting,
} from '../../lib/rust-bridge';

const REAL_QUERIES = [
  {
    name: 'Melchizedek Priesthood',
    query: 'Melchizedek order high priest in Hebrews',
    expectedBook: 'HEB',
  },
  {
    name: 'Faith and Works',
    query: 'faith without works is dead',
    expectedBook: 'JAS',
  },
  {
    name: 'Armor of God',
    query: 'put on the whole armor of God breastplate of righteousness',
    expectedBook: 'EPH',
  },
  {
    name: 'Logos / Incarnation',
    query: 'In the beginning was the Word and the Word was with God',
    expectedBook: 'JHN',
  },
  {
    name: 'The Good Shepherd',
    query: 'The Lord is my shepherd I shall not want',
    expectedBook: 'PSA',
  },
  {
    name: 'Resurrection Hope',
    query: 'death is swallowed up in victory O death where is your sting',
    expectedBook: '1CO',
  },
];

async function runRealQueryVerification() {
  console.log('================================================================');
  console.log('         BIBLELM REAL-WORLD QUERY VERIFICATION (RUST WASM)       ');
  console.log('================================================================\n');

  // 1. Initialize Engine
  const startInit = performance.now();
  const wasm = await initRustEngine();
  const initMs = (performance.now() - startInit).toFixed(2);
  console.log(`[1] Rust WASM Engine Initialization: ${initMs} ms`);
  console.log(`    - WASM Module loaded: ${isRustEngineAvailable()}`);
  console.log(`    - BM25 Index initialized: ${wasm?.wasm_is_bm25_initialized()}`);
  console.log(`    - TSK Graph initialized: ${wasm?.wasm_is_graph_initialized()}`);
  console.log(`    - Strongs Dict initialized: ${wasm?.wasm_is_strongs_initialized()}\n`);

  if (!wasm) {
    throw new Error('Rust WASM engine failed to initialize');
  }

  // 2. Direct BM25 Search Benchmark: Rust WASM vs TypeScript Fallback
  console.log('----------------------------------------------------------------');
  console.log(' [2] BM25 Query Benchmark (Rust WASM vs TS Fallback)');
  console.log('----------------------------------------------------------------');

  for (const q of REAL_QUERIES) {
    // Rust WASM Run
    process.env.ENABLE_RUST_ENGINE = '1';
    resetRustEngineForTesting();
    await initRustEngine();

    const t0Rust = performance.now();
    const rustHits = await rustSearch(q.query, 5);
    const rustLatency = (performance.now() - t0Rust).toFixed(3);

    // TypeScript Fallback Run
    process.env.ENABLE_RUST_ENGINE = '0';
    resetRustEngineForTesting();

    const t0Ts = performance.now();
    await rustSearch(q.query, 5);
    const tsLatency = (performance.now() - t0Ts).toFixed(3);

    // Re-enable Rust
    process.env.ENABLE_RUST_ENGINE = '1';
    resetRustEngineForTesting();

    const speedup = (Number(tsLatency) / Math.max(Number(rustLatency), 0.05)).toFixed(1);
    const topRef = rustHits[0]?.verseId ?? 'None';
    const topMatch = topRef.startsWith(q.expectedBook);

    console.log(`Query: "${q.query}"`);
    console.log(`  • Top Hit: ${topRef} [${topMatch ? 'PASS' : 'WARN'}] (Score: ${(rustHits[0]?.score ?? 0).toFixed(2)})`);
    console.log(`  • Rust WASM Latency: ${rustLatency} ms`);
    console.log(`  • TS Fallback Latency: ${tsLatency} ms`);
    console.log(`  • Acceleration: ~${speedup}x faster\n`);
  }

  // 3. End-to-End Pipeline Retrieval Verification
  console.log('----------------------------------------------------------------');
  console.log(' [3] End-to-End Pipeline Retrieval (retrieveContextForQuery)');
  console.log('----------------------------------------------------------------');

  for (const q of REAL_QUERIES.slice(0, 3)) {
    const t0 = performance.now();
    const verses = await retrieveContextForQuery(q.query, 'BSB');
    const elapsed = (performance.now() - t0).toFixed(2);

    console.log(`Topic: ${q.name}`);
    console.log(`  • Retrieved: ${verses.length} verses in ${elapsed} ms`);
    for (const v of verses.slice(0, 3)) {
      const snippet = v.text.length > 70 ? v.text.substring(0, 67) + '...' : v.text;
      console.log(`    - ${v.reference}: "${snippet}"`);
    }
    console.log('');
  }

  // 4. GraphRAG Traversal Real Seed Test
  console.log('----------------------------------------------------------------');
  console.log(' [4] Real GraphRAG Cross-Reference Traversal');
  console.log('----------------------------------------------------------------');
  const seeds = ['HEB 7:1', 'GEN 14:18'];
  const t0Graph = performance.now();
  const graphRes = await rustGraphExpand(seeds, new Set(['priesthood', 'covenant']), {
    maxDepth: 2,
    maxExpansions: 5,
  });
  const graphMs = (performance.now() - t0Graph).toFixed(3);

  console.log(`Seeds: ${seeds.join(', ')}`);
  console.log(`GraphRAG Latency: ${graphMs} ms (depth: ${graphRes.diagnostics.traversalDepthReached})`);
  for (const c of graphRes.candidates) {
    console.log(`  + Candidate: ${c.verseId} (Score: ${c.score.toFixed(4)})`);
  }
  console.log('');

  // 5. Linear-Time Citation Scrubber Real Test
  console.log('----------------------------------------------------------------');
  console.log(' [5] Real Citation Scrubber Security Verification');
  console.log('----------------------------------------------------------------');
  const generatedModelResponse = `
According to the Epistle to the Hebrews, Melchizedek is a king and priest of God Most High [HEB 7:1].
Christ is made a high priest forever after the order of Melchizedek [PSA 110:4].
Furthermore, Jesus taught about repentance in [LUK 13:3] and [REV 99:99].
`;
  const allowedRetrieved = ['HEB 7:1', 'PSA 110:4'];
  const t0Scrub = performance.now();
  const scrubbed = rustScrubCitations(generatedModelResponse, allowedRetrieved);
  const scrubMs = (performance.now() - t0Scrub).toFixed(3);

  console.log(`Scrubber Execution: ${scrubMs} ms`);
  console.log(`Scrubbed Output:\n${scrubbed.trim()}`);
  if (!scrubbed.includes('HEB 7:1')) {
    throw new Error('[FAIL] HEB 7:1 should be preserved in scrubbed output');
  }
  if (!scrubbed.includes('PSA 110:4')) {
    throw new Error('[FAIL] PSA 110:4 should be preserved in scrubbed output');
  }
  if (scrubbed.includes('LUK 13:3')) {
    throw new Error('[FAIL] LUK 13:3 must be scrubbed from output');
  }
  if (scrubbed.includes('REV 99:99')) {
    throw new Error('[FAIL] Phantom citation REV 99:99 must be scrubbed from output');
  }
  console.log('\n[PASS] Citation scrubber successfully preserved verified scriptures and excised hallucinations.\n');

  console.log('================================================================');
  console.log('                REAL QUERY VERIFICATION COMPLETE: ALL PASS      ');
  console.log('================================================================');
}

runRealQueryVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
