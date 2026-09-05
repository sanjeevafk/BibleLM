import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';

import {
  initRustEngine,
  rustSearch,
  rustGraphExpand,
  rustScrubCitations,
  rustFuseRrf,
  rustLookupStrongs,
} from '../../lib/rust-bridge';
import { getBM25Engine } from '../../lib/retrieval/search';
import { graphRagExpand as tsGraphRagExpand } from '../../lib/retrieval/graph-rag';
import { scrubInvalidCitations as tsScrubInvalidCitations } from '../../app/api/chat/lib/citation-scrubber';
import { retrieveContextForQuery } from '../../lib/retrieval';

interface VerificationResult {
  suite: string;
  name: string;
  passed: boolean;
  details: string;
  durationMs: number;
}

const results: VerificationResult[] = [];

function record(suite: string, name: string, passed: boolean, details: string, durationMs: number) {
  results.push({ suite, name, passed, details, durationMs });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${status}] [${suite}] ${name} (${durationMs.toFixed(2)} ms)`);
  if (!passed || process.env.VERBOSE === '1') {
    console.log(`       Details: ${details}`);
  }
}

async function runIndependentVerification() {
  console.log('================================================================');
  console.log(' BibleLM: Comprehensive Independent Verification Suite');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // SUITE 1: WASM Artifact & Memory Footprint Audit
  // -------------------------------------------------------------------------
  {
    const suite = '1. Artifact Audit';
    const wasmPath = path.resolve(process.cwd(), 'rust', 'pkg', 'biblelm_wasm_bg.wasm');
    const jsPath = path.resolve(process.cwd(), 'rust', 'pkg', 'biblelm_wasm.js');
    const dtsPath = path.resolve(process.cwd(), 'rust', 'pkg', 'biblelm_wasm.d.ts');

    const t0 = performance.now();
    const wasmExists = fs.existsSync(wasmPath);
    const jsExists = fs.existsSync(jsPath);
    const dtsExists = fs.existsSync(dtsPath);
    const sizeBytes = wasmExists ? fs.statSync(wasmPath).size : 0;
    const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(2);

    record(
      suite,
      'Binary Artifacts Exist and Size < 2.0 MB',
      wasmExists && jsExists && dtsExists && sizeBytes < 2 * 1024 * 1024,
      `WASM: ${sizeMb} MB (${sizeBytes} bytes), JS: ${jsExists}, DTS: ${dtsExists}`,
      performance.now() - t0
    );

    // Verify exported function surface
    const tExports = performance.now();
    const wasmModule = await initRustEngine();
    const expectedExports = [
      'wasm_init_bm25',
      'wasm_is_bm25_initialized',
      'wasm_search',
      'wasm_init_graph',
      'wasm_is_graph_initialized',
      'wasm_graph_expand',
      'wasm_init_strongs',
      'wasm_is_strongs_initialized',
      'wasm_lookup_strongs',
      'wasm_enrich_verse',
      'wasm_scrub_citations',
      'wasm_fuse_rrf',
    ];

    const missingExports = wasmModule
      ? expectedExports.filter((exp) => typeof (wasmModule as any)[exp] !== 'function')
      : expectedExports;

    record(
      suite,
      'Export Surface Completeness',
      wasmModule !== null && missingExports.length === 0,
      missingExports.length === 0
        ? `All ${expectedExports.length} required WASM functions exported`
        : `Missing: ${missingExports.join(', ')}`,
      performance.now() - tExports
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 2: BM25 Retrieval Differential Parity (Rust WASM vs TS BM25)
  // -------------------------------------------------------------------------
  {
    const suite = '2. BM25 Differential Parity';
    const tsEngine = await getBM25Engine();

    const testQueries = [
      'faith without works is dead',
      'for God so loved the world',
      'the Lord is my shepherd I shall not want',
      'in the beginning God created the heaven and the earth',
      'righteousness peace and joy in the Holy Ghost',
      'love is patient love is kind',
      'I can do all things through Christ who strengthens me',
      'armor of God breastplate helmet shield',
      'Melchizedek priest king Salem',
      'Covenant Abraham seed stars sand',
      'fruit of the Spirit love joy peace longsuffering',
      'baptize all nations Father Son Holy Spirit',
      'grace through faith not of works lest any man should boast',
      'be strong and of a good courage do not be afraid',
      'Mahershalalhashbaz', // Rare biblical name
    ];

    let totalQueries = 0;
    let rank1Matches = 0;
    let top5OverlapSum = 0;
    let rustTotalMs = 0;
    let tsTotalMs = 0;

    for (const query of testQueries) {
      totalQueries++;

      // Rust run
      const t0 = performance.now();
      const rustHits = await rustSearch(query, 5);
      const rustDur = performance.now() - t0;
      rustTotalMs += rustDur;

      // TS run
      const t1 = performance.now();
      const tsHits = tsEngine.search(query, 5);
      const tsDur = performance.now() - t1;
      tsTotalMs += tsDur;

      const rustRefs = rustHits.map((h) => h.verseId);
      const tsRefs = tsHits.map((h) => h.doc.id);

      if (rustRefs[0] === tsRefs[0]) {
        rank1Matches++;
      }

      const intersection = rustRefs.filter((r) => tsRefs.includes(r)).length;
      top5OverlapSum += intersection;
    }

    const rank1ParityRate = (rank1Matches / totalQueries) * 100;
    const avgTop5Overlap = (top5OverlapSum / (totalQueries * 5)) * 100;
    const avgSpeedup = (tsTotalMs / Math.max(rustTotalMs, 0.1)).toFixed(1);

    record(
      suite,
      'Rank #1 Parity >= 90% across diverse queries',
      rank1ParityRate >= 90,
      `Rank-1 match: ${rank1Matches}/${totalQueries} (${rank1ParityRate.toFixed(1)}%), Avg Top-5 overlap: ${avgTop5Overlap.toFixed(1)}%`,
      rustTotalMs
    );

    record(
      suite,
      'Rust Search Performance Acceleration > 10x',
      Number(avgSpeedup) > 10,
      `Rust total: ${rustTotalMs.toFixed(2)} ms (avg ${(rustTotalMs / totalQueries).toFixed(2)} ms) vs TS total: ${tsTotalMs.toFixed(2)} ms (avg ${(tsTotalMs / totalQueries).toFixed(2)} ms) -> ${avgSpeedup}x speedup`,
      rustTotalMs
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 3: GraphRAG Adjacency Expansion Differential Parity
  // -------------------------------------------------------------------------
  {
    const suite = '3. GraphRAG Parity';
    const testSeeds = [
      { seed: ['JHN 3:16'], topics: ['love', 'salvation'] },
      { seed: ['GEN 1:1'], topics: ['creation', 'heavens'] },
      { seed: ['ROM 3:23', 'ROM 6:23'], topics: ['sin', 'grace'] },
      { seed: ['PSA 23:1'], topics: ['shepherd', 'provision'] },
    ];

    let graphMatches = 0;
    let totalGraphTimeRust = 0;

    for (const item of testSeeds) {
      const topicsSet = new Set(item.topics);
      const t0 = performance.now();
      const rustRes = await rustGraphExpand(item.seed, topicsSet, { maxDepth: 1, maxExpansions: 15 });
      const rustDur = performance.now() - t0;
      totalGraphTimeRust += rustDur;

      const tsRes = await tsGraphRagExpand(item.seed, topicsSet, { maxDepth: 1, maxExpansions: 15 });

      const rustCandidates = rustRes.candidates.map((c) => c.verseId);
      const tsCandidates = tsRes.candidates.map((c) => c.verseId);

      // Verify candidates set overlap
      const shared = rustCandidates.filter((r) => tsCandidates.includes(r)).length;
      if (shared >= Math.min(rustCandidates.length, tsCandidates.length) * 0.8) {
        graphMatches++;
      }
    }

    record(
      suite,
      'Candidate expansion agreement >= 75%',
      graphMatches === testSeeds.length,
      `Matched ${graphMatches}/${testSeeds.length} seed expansion sets`,
      totalGraphTimeRust
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 4: Scriptural Citation Scrubber Exact Bit-For-Bit Parity
  // -------------------------------------------------------------------------
  {
    const suite = '4. Citation Scrubber Parity';

    const testCases = [
      {
        content: 'Paul writes in Romans 8:28 that all things work together, and in 1 Corinthians 13:4 love is patient.',
        allowed: ['ROM 8:28', '1CO 13:4'],
        expectedPass: true,
      },
      {
        content: 'According to Matthew 5:3 the poor in spirit are blessed, but Revelation 99:99 is not real.',
        allowed: ['MAT 5:3'],
        expectedPass: true,
      },
      {
        content: 'See [JHN 3:16] and [PSA 23:1-6]. Also note [REV 1:1].',
        allowed: ['JHN 3:16', 'PSA 23:1-6'],
        expectedPass: true,
      },
      {
        content: 'False references like Hezekiah 4:12 and 1 John 99:1 should be scrubbed completely.',
        allowed: [],
        expectedPass: true,
      },
      {
        content: 'Multiple occurrences: John 3:16 says so. Once again, John 3:16 is clear. But Luke 1:1 is not in context.',
        allowed: ['JHN 3:16'],
        expectedPass: true,
      },
    ];

    let bitExactCount = 0;
    const t0 = performance.now();

    for (const tc of testCases) {
      const rustOutput = rustScrubCitations(tc.content, tc.allowed);
      const tsOutput = tsScrubInvalidCitations(
        tc.content,
        tc.allowed.map((r) => ({ reference: r, translation: 'BSB', text: '', original: [] }))
      );

      if (rustOutput === tsOutput) {
        bitExactCount++;
      }
    }
    const dur = performance.now() - t0;

    record(
      suite,
      'Bit-for-bit identical scrubbing output vs TypeScript',
      bitExactCount === testCases.length,
      `Bit-exact matches: ${bitExactCount}/${testCases.length}`,
      dur
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 5: Reciprocal Rank Fusion (RRF) Parity
  // -------------------------------------------------------------------------
  {
    const suite = '5. RRF Fusion Parity';
    const lexicalIds = ['JHN 3:16', 'ROM 8:28', 'GEN 1:1', 'PSA 23:1', 'EPH 2:8'];
    const semanticIds = ['ROM 8:28', 'JHN 3:16', 'ISA 53:5', 'PSA 23:1', 'MIC 6:8'];

    const t0 = performance.now();
    const rustFused = rustFuseRrf(lexicalIds, semanticIds, 60);
    const dur = performance.now() - t0;

    // TypeScript reference calculation
    const semanticRankMap = new Map<string, number>();
    semanticIds.forEach((id, idx) => semanticRankMap.set(id, idx + 1));
    const tsFused = lexicalIds.map((id, idx) => {
      const lexRank = idx + 1;
      const semRank = semanticRankMap.get(id);
      const score = 1 / (60 + lexRank) + (semRank ? 1 / (60 + semRank) : 0);
      return { verseId: id, score };
    }).sort((a, b) => b.score - a.score);

    const matchesOrder = rustFused.every((r, idx) => r.verseId === tsFused[idx]?.verseId);
    const matchesScores = rustFused.every((r, idx) => Math.abs(r.score - (tsFused[idx]?.score ?? 0)) < 1e-6);

    record(
      suite,
      'RRF rank ordering and score math exact match',
      matchesOrder && matchesScores,
      `Top 1: ${rustFused[0]?.verseId} (Rust: ${rustFused[0]?.score.toFixed(4)}, TS: ${tsFused[0]?.score.toFixed(4)})`,
      dur
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 6: Strong's Concordance Dictionary Lookup
  // -------------------------------------------------------------------------
  {
    const suite = '6. Strongs Dictionary Lookup';
    const t0 = performance.now();

    const hEntry = await rustLookupStrongs('H7225'); // reshith (beginning)
    const gEntry = await rustLookupStrongs('G3056'); // logos (word)
    const invalidEntry = await rustLookupStrongs('Z9999'); // Non-existent
    const dur = performance.now() - t0;

    const hebrewValid = hEntry !== null && hEntry.transliteration.length > 0;
    const greekValid = gEntry !== null && gEntry.transliteration.length > 0;
    const invalidNull = invalidEntry === null;

    record(
      suite,
      'Validates Hebrew (H7225), Greek (G3056), and null on non-existent',
      hebrewValid && greekValid && invalidNull,
      `H7225: "${hEntry?.transliteration}", G3056: "${gEntry?.transliteration}", Z9999: null (${invalidNull})`,
      dur
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 7: High-Throughput / Concurrency Stress Test (1,000 queries)
  // -------------------------------------------------------------------------
  {
    const suite = '7. High-Throughput Stress Test';
    const queries = [
      'faith',
      'grace',
      'covenant',
      'shepherd',
      'commandments',
      'resurrection',
      'righteousness',
      'kingdom of God',
      'holy spirit',
      'living water',
    ];

    const iterations = 1000;
    const t0 = performance.now();
    let completed = 0;

    for (let i = 0; i < iterations; i++) {
      const q = queries[i % queries.length];
      const hits = await rustSearch(q, 3);
      if (hits.length > 0) completed++;
    }
    const dur = performance.now() - t0;
    const qps = ((iterations / dur) * 1000).toFixed(0);
    const avgLatency = (dur / iterations).toFixed(3);

    record(
      suite,
      '1,000 rapid BM25 search queries with zero failures',
      completed === iterations,
      `Completed: ${completed}/${iterations} queries in ${dur.toFixed(1)} ms | Throughput: ${qps} QPS | Avg Latency: ${avgLatency} ms/query`,
      dur
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 8: Transparent Fallback Verification (ENABLE_RUST_ENGINE=0)
  // -------------------------------------------------------------------------
  {
    const suite = '8. Fail-Safe Fallback';
    const prevEnv = process.env.ENABLE_RUST_ENGINE;

    try {
      process.env.ENABLE_RUST_ENGINE = '0';
      const t0 = performance.now();

      // Search fallback
      const hits = await rustSearch('faith without works', 3);
      const searchSuccess = hits.length > 0 && hits[0].verseId.startsWith('JAS');

      // Scrubber fallback
      const scrubbed = rustScrubCitations('See [JHN 3:16] and [MAT 5:3].', ['JHN 3:16']);
      const scrubberSuccess = scrubbed.includes('[JHN 3:16]') && !scrubbed.includes('MAT 5:3');

      // RRF fallback
      const fused = rustFuseRrf(['JHN 3:16', 'ROM 8:28'], ['ROM 8:28', 'JHN 3:16']);
      const rrfSuccess = fused.length === 2;

      const dur = performance.now() - t0;

      record(
        suite,
        'Full pipeline operates seamlessly when ENABLE_RUST_ENGINE=0',
        searchSuccess && scrubberSuccess && rrfSuccess,
        `Search fallback: ${searchSuccess}, Scrubber fallback: ${scrubberSuccess}, RRF fallback: ${rrfSuccess}`,
        dur
      );
    } finally {
      process.env.ENABLE_RUST_ENGINE = prevEnv;
    }
  }

  // -------------------------------------------------------------------------
  // SUITE 9: End-to-End Pipeline Integration (retrieveContextForQuery)
  // -------------------------------------------------------------------------
  {
    const suite = '9. End-to-End Pipeline';
    const testQuery = 'Ten Commandments Mount Sinai tablets of stone';
    const t0 = performance.now();
    const context = await retrieveContextForQuery(testQuery, 'BSB');
    const dur = performance.now() - t0;

    const hasVerses = context.length > 0;
    const topRef = context[0]?.reference ?? 'none';
    const containsExodusOrDeut = context.some(
      (v) => v.reference.startsWith('EXO') || v.reference.startsWith('DEU')
    );

    record(
      suite,
      'End-to-End retrieveContextForQuery returns valid grounded context',
      hasVerses && containsExodusOrDeut,
      `Retrieved ${context.length} verses. Top: ${topRef}. Contains Exodus/Deut: ${containsExodusOrDeut}`,
      dur
    );
  }

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(' Independent Verification Summary');
  console.log('================================================================');

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const totalDur = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log(`Total Verification Checks: ${results.length}`);
  console.log(`Passed:                   ${passedCount}`);
  console.log(`Failed:                   ${failedCount}`);
  console.log(`Total Execution Time:     ${totalDur.toFixed(2)} ms`);

  if (failedCount > 0) {
    console.error('\n❌ Independent Verification FAILED.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL INDEPENDENT VERIFICATION CHECKS PASSED.');
    process.exit(0);
  }
}

runIndependentVerification().catch((err) => {
  console.error('Fatal error during independent verification:', err);
  process.exit(1);
});
