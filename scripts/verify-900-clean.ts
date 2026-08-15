/**
 * Clean grounding test: maxTokens=900 vs maxTokens=2048
 * - Uses generateWithFallback directly (the actual production function)
 * - No conciseness rule in either arm (already reverted from prompt)
 * - Measures: citation grounding, word count, per-query
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
  { id: 'Q1', query: 'What does the Bible say about anxiety and peace of mind?',    expectedRefs: ['PHP 4:6','PHP 4:7','1PE 5:7','MAT 6:25'] },
  { id: 'Q2', query: 'Explain John 1:1 and what the Word (Logos) means in Greek',    expectedRefs: ['JHN 1:1','JHN 1:14','1JN 1:1'] },
  { id: 'Q3', query: 'How should a Christian treat their enemies according to Jesus?', expectedRefs: ['MAT 5:44','LUK 6:27','ROM 12:20'] },
  { id: 'Q4', query: 'Is salvation by faith alone or do works matter?',               expectedRefs: ['EPH 2:8','JAS 2:14','ROM 3:28'] },
  { id: 'Q5', query: 'What are the Ten Commandments given in Exodus 20?',             expectedRefs: ['EXO 20:1','EXO 20:2','EXO 20:3'] },
];

function grounding(text: string, verses: VerseContext[]): number {
  const refs = extractDirectReferences(text);
  if (refs.length === 0) return 1;
  const ctx = new Set(verses.map(v => v.reference.toUpperCase()));
  const hit = refs.filter(r => {
    const k = `${r.book} ${r.chapter}:${r.verse}`.toUpperCase();
    return Array.from(ctx).some(c => c === k || c.startsWith(k + '-') || k.startsWith(c));
  });
  return hit.length / refs.length;
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function run() {
  console.log('='.repeat(72));
  console.log('  CLEAN CITATION GROUNDING TEST  |  900 tokens vs 2048 tokens');
  console.log('  Using generateWithFallback (real production function)');
  console.log('  No conciseness rule in either arm');
  console.log('='.repeat(72) + '\n');

  const rows: { id: string; g2048: number; g900: number; w2048: number; w900: number }[] = [];

  for (const q of QUERIES) {
    console.log(`\n── ${q.id}: ${q.query.slice(0, 60)}...`);
    const verses = await retrieveContextForQuery(q.query, 'BSB') as VerseContext[];
    const prompt = buildContextPrompt(q.query, verses, 'BSB');
    console.log(`   Retrieved ${verses.length} verses`);

    // ARM A — 2048
    await new Promise(r => setTimeout(r, 2000));
    const r2048 = await generateWithFallback(prompt, { maxTokens: 2048, temperature: 0.1 });
    const g2048 = grounding(r2048.content, verses);
    const w2048 = words(r2048.content);
    console.log(`   [2048]  ${w2048} words  |  grounding: ${(g2048 * 100).toFixed(0)}%`);

    // ARM B — 900
    await new Promise(r => setTimeout(r, 2000));
    const r900 = await generateWithFallback(prompt, { maxTokens: 900, temperature: 0.1 });
    const g900 = grounding(r900.content, verses);
    const w900 = words(r900.content);
    console.log(`   [900]   ${w900} words  |  grounding: ${(g900 * 100).toFixed(0)}%`);

    rows.push({ id: q.id, g2048, g900, w2048, w900 });
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log('\n' + '='.repeat(72));
  console.log('  RESULTS');
  console.log('='.repeat(72));
  console.log(`${'Query'.padEnd(6)} ${'2048 words'.padEnd(12)} ${'900 words'.padEnd(12)} ${'2048 grnd'.padEnd(12)} ${'900 grnd'.padEnd(12)}`);
  console.log('─'.repeat(60));
  for (const r of rows) {
    console.log(`${r.id.padEnd(6)} ${String(r.w2048).padEnd(12)} ${String(r.w900).padEnd(12)} ${(r.g2048*100).toFixed(0).padEnd(11)}% ${(r.g900*100).toFixed(0)}%`);
  }
  console.log('─'.repeat(60));
  const ag2048 = avg(rows.map(r => r.g2048));
  const ag900  = avg(rows.map(r => r.g900));
  const aw2048 = avg(rows.map(r => r.w2048));
  const aw900  = avg(rows.map(r => r.w900));
  console.log(`${'AVG'.padEnd(6)} ${aw2048.toFixed(0).padEnd(12)} ${aw900.toFixed(0).padEnd(12)} ${(ag2048*100).toFixed(1).padEnd(11)}% ${(ag900*100).toFixed(1)}%`);
  console.log('='.repeat(72));
  const delta = ag900 - ag2048;
  console.log(`\nCitation Grounding Delta: ${delta >= 0 ? '+' : ''}${(delta*100).toFixed(1)}% at maxTokens=900 vs 2048`);
  console.log(`Word Count Delta:         ${(aw900 - aw2048).toFixed(0)} words`);
  console.log('\nDone.\n');
}

run().catch(err => { console.error(err); process.exit(1); });
