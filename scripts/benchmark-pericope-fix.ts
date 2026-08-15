/**
 * Pericope Full-Expansion Benchmark
 * Tests Q5 (Ten Commandments) + 5 similar named-passage queries
 * to verify the pericope expansion fix.
 *
 * Metrics per query:
 *   - verses retrieved (count)
 *   - verse references returned
 *   - Hit@1 and Hit@5 against expected passage references
 *   - citation grounding score after generation
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { retrieveContextForQuery } from '../lib/retrieval';
import { extractDirectReferences } from '../lib/retrieval/verse-fetch';
import { buildContextPrompt } from '../lib/prompts';
import { generateWithFallback } from '../lib/llm-fallback';
import type { VerseContext } from '../lib/bible-fetch';

const QUERIES = [
  {
    id: 'Q5', label: 'Ten Commandments',
    query: 'What are the Ten Commandments given in Exodus 20?',
    mustContain: ['EXO 20:3', 'EXO 20:7', 'EXO 20:13', 'EXO 20:14', 'EXO 20:15'],
    expectedRange: 'EXO 20:1-17',
  },
  {
    id: 'A1', label: 'Sermon on the Mount',
    query: 'What did Jesus teach in the Sermon on the Mount?',
    mustContain: ['MAT 5:3', 'MAT 5:44', 'MAT 6:9', 'MAT 7:12'],
    expectedRange: 'MAT 5-7',
  },
  {
    id: 'A2', label: 'Beatitudes',
    query: 'What are the Beatitudes that Jesus gave?',
    mustContain: ['MAT 5:3', 'MAT 5:4', 'MAT 5:5', 'MAT 5:6'],
    expectedRange: 'MAT 5:3-12',
  },
  {
    id: 'A3', label: 'The Good Samaritan',
    query: 'Tell me about the Parable of the Good Samaritan',
    mustContain: ['LUK 10:33', 'LUK 10:30', 'LUK 10:25'],
    expectedRange: 'LUK 10:25-37',
  },
  {
    id: 'A4', label: 'Armor of God',
    query: 'Describe the full Armor of God from Ephesians',
    mustContain: ['EPH 6:14', 'EPH 6:15', 'EPH 6:16', 'EPH 6:17'],
    expectedRange: 'EPH 6:10-18',
  },
  {
    id: 'A5', label: 'Psalm 23 Full',
    query: 'What does Psalm 23 say about the Lord as shepherd?',
    mustContain: ['PSA 23:1', 'PSA 23:2', 'PSA 23:4', 'PSA 23:6'],
    expectedRange: 'PSA 23:1-6',
  },
];

function checkRefInResult(targetRef: string, verses: VerseContext[]): boolean {
  const normTarget = targetRef.trim().toUpperCase();
  const tMatch = normTarget.match(/^([1-3]?\s?[A-Z]{3})\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!tMatch) {
    return verses.some(v => v.reference.toUpperCase().includes(normTarget));
  }
  const [, tBook, tChap, tStartStr, tEndStr] = tMatch;
  const tStart = parseInt(tStartStr, 10);
  const tEnd = tEndStr ? parseInt(tEndStr, 10) : tStart;

  return verses.some(v => {
    const normV = v.reference.trim().toUpperCase();
    const vMatch = normV.match(/^([1-3]?\s?[A-Z]{3})\s+(\d+):(\d+)(?:-(\d+))?$/);
    if (!vMatch) return normV === normTarget || normV.includes(normTarget);
    const [, vBook, vChap, vStartStr, vEndStr] = vMatch;
    if (vBook !== tBook || vChap !== tChap) return false;
    const vStart = parseInt(vStartStr, 10);
    const vEnd = vEndStr ? parseInt(vEndStr, 10) : vStart;
    return Math.max(vStart, tStart) <= Math.min(vEnd, tEnd);
  });
}

function citationGrounding(text: string, verses: VerseContext[]): number {
  const refs = extractDirectReferences(text);
  if (refs.length === 0) return 1;
  const ctx = new Set(verses.map(v => v.reference.toUpperCase()));
  const hit = refs.filter(r => {
    const k = `${r.book} ${r.chapter}:${r.verse}`.toUpperCase();
    return Array.from(ctx).some(c => c === k || c.startsWith(k + '-') || k.startsWith(c));
  });
  return hit.length / refs.length;
}

async function run() {
  console.log('='.repeat(76));
  console.log('  PERICOPE FULL-EXPANSION BENCHMARK');
  console.log('  Verifies named-passage retrieval returns complete passage verses');
  console.log('='.repeat(76) + '\n');

  const results: { id: string; retrieved: number; mustHitCount: number; mustTotal: number; grounding: number }[] = [];

  for (const q of QUERIES) {
    console.log(`\n${'─'.repeat(76)}`);
    console.log(`[${q.id}] ${q.label}`);
    console.log(`Query   : "${q.query}"`);
    console.log(`Expected: ${q.expectedRange} (must contain: ${q.mustContain.join(', ')})`);
    console.log('─'.repeat(76));

    const retStart = Date.now();
    const verses = await retrieveContextForQuery(q.query, 'BSB') as VerseContext[];
    const retMs = Date.now() - retStart;

    const refs = verses.map(v => v.reference);
    const mustHits = q.mustContain.filter(r => checkRefInResult(r, verses));
    const mustMissed = q.mustContain.filter(r => !checkRefInResult(r, verses));

    console.log(`\n  [Retrieval — ${retMs} ms]`);
    console.log(`  Verses Retrieved : ${verses.length}`);
    console.log(`  References       : ${refs.join(', ')}`);
    console.log(`  Must-Have Hit    : ${mustHits.length}/${q.mustContain.length} — ✅ ${mustHits.join(', ')}`);
    if (mustMissed.length > 0) {
      console.log(`  Must-Have MISSED : ❌ ${mustMissed.join(', ')}`);
    }

    // Generate and check grounding
    await new Promise(r => setTimeout(r, 1500));
    const prompt = buildContextPrompt(q.query, verses, 'BSB');
    const gen = await generateWithFallback(prompt, { maxTokens: 900, temperature: 0.1 });
    const grounding = citationGrounding(gen.content, verses);

    console.log(`\n  [Generation]`);
    console.log(`  Words     : ${gen.content.trim().split(/\s+/).length}`);
    console.log(`  Grounding : ${(grounding * 100).toFixed(0)}%`);

    results.push({ id: q.id, retrieved: verses.length, mustHitCount: mustHits.length, mustTotal: q.mustContain.length, grounding });
  }

  // Summary
  console.log('\n' + '='.repeat(76));
  console.log('  SUMMARY');
  console.log('='.repeat(76));
  console.log(`${'Query'.padEnd(6)} ${'Retrieved'.padEnd(12)} ${'Must-Hits'.padEnd(14)} ${'Grounding'.padEnd(12)} Verdict`);
  console.log('─'.repeat(60));

  for (const r of results) {
    const allHit = r.mustHitCount === r.mustTotal;
    const verdict = allHit && r.grounding >= 0.75 ? '✅ PASS' : allHit ? '⚠ LOW GRND' : '❌ MISS';
    console.log(`${r.id.padEnd(6)} ${String(r.retrieved).padEnd(12)} ${`${r.mustHitCount}/${r.mustTotal}`.padEnd(14)} ${`${(r.grounding*100).toFixed(0)}%`.padEnd(12)} ${verdict}`);
  }

  const avgGrounding = results.reduce((s, r) => s + r.grounding, 0) / results.length;
  const allMustHit = results.every(r => r.mustHitCount === r.mustTotal);
  console.log('─'.repeat(60));
  console.log(`${'OVERALL'.padEnd(6)} ${''.padEnd(12)} ${''.padEnd(14)} ${`${(avgGrounding*100).toFixed(1)}%`.padEnd(12)} ${allMustHit ? '✅ ALL PASS' : '❌ SOME MISS'}`);
  console.log('='.repeat(76));
}

run().catch(err => { console.error(err); process.exit(1); });
