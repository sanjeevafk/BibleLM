/**
 * Independent A/B Verification: Token Budget Optimization
 *
 * Runs the SAME 5 queries TWICE in the same process:
 *   ARM A (BASELINE):  maxTokens=2048, conciseness rule stripped from prompt
 *   ARM B (OPTIMIZED): maxTokens=600,  conciseness rule present (current codebase)
 *
 * Independently measures for each arm:
 *   1. Generation Latency (ms)
 *   2. Output Word Count
 *   3. Citation Grounding Score
 *   4. Retrieval: Hit@1, Hit@5, MRR (shared retrieval — should be identical)
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { retrieveContextForQuery } from '../lib/retrieval';
import { extractDirectReferences } from '../lib/retrieval/verse-fetch';
import { buildContextPrompt } from '../lib/prompts';
import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import type { VerseContext } from '../lib/bible-fetch';

const groqApiKey = process.env.GROQ_API_KEY;
if (!groqApiKey) throw new Error('GROQ_API_KEY not set');
const groq = createGroq({ apiKey: groqApiKey });

interface Query { id: string; label: string; query: string; expectedRefs: string[]; }

const QUERIES: Query[] = [
  {
    id: 'Q1', label: 'Topical – Anxiety & Peace',
    query: 'What does the Bible say about anxiety and peace of mind?',
    expectedRefs: ['PHP 4:6', 'PHP 4:7', '1PE 5:7', 'MAT 6:25', 'MAT 6:34'],
  },
  {
    id: 'Q2', label: 'Exegesis – John 1:1 Logos',
    query: 'Explain John 1:1 and what the Word (Logos) means in Greek',
    expectedRefs: ['JHN 1:1', 'JHN 1:14', '1JN 1:1'],
  },
  {
    id: 'Q3', label: 'Ethics – Love Your Enemy',
    query: 'How should a Christian treat their enemies according to Jesus?',
    expectedRefs: ['MAT 5:44', 'LUK 6:27', 'ROM 12:20'],
  },
  {
    id: 'Q4', label: 'Theology – Faith vs Works',
    query: 'Is salvation by faith alone or do works matter?',
    expectedRefs: ['EPH 2:8', 'JAS 2:14', 'ROM 3:28'],
  },
  {
    id: 'Q5', label: 'Passage – Ten Commandments',
    query: 'What are the Ten Commandments given in Exodus 20?',
    expectedRefs: ['EXO 20:1', 'EXO 20:2', 'EXO 20:3'],
  },
];

/** Strip conciseness rule to simulate the old baseline prompt. */
function withoutConciseness(prompt: string): string {
  return prompt.replace(
    /7\. Keep your response focused[^\n]*\n?/,
    ''
  );
}

function checkRefMatch(actual: string, expected: string[]): boolean {
  const normA = actual.trim().toUpperCase();
  const m = normA.match(/^([1-3]?\s?[A-Z]{3})\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return expected.some(e => normA.includes(e.toUpperCase()));
  const [, aBook, aChap, aS, aE] = m;
  const aStart = parseInt(aS, 10); const aEnd = aE ? parseInt(aE, 10) : aStart;
  return expected.some(exp => {
    const me = exp.trim().toUpperCase().match(/^([1-3]?\s?[A-Z]{3})\s+(\d+):(\d+)(?:-(\d+))?$/);
    if (!me) return normA === exp.toUpperCase();
    const [, eBook, eChap, eS2, eE2] = me;
    if (aBook !== eBook || aChap !== eChap) return false;
    const eStart = parseInt(eS2, 10); const eEnd = eE2 ? parseInt(eE2, 10) : eStart;
    return Math.max(aStart, eStart) <= Math.min(aEnd, eEnd);
  });
}

function citationGrounding(responseText: string, verses: VerseContext[]): number {
  const refs = extractDirectReferences(responseText);
  if (refs.length === 0) return 1;
  const retrievedSet = new Set(verses.map(v => v.reference.toUpperCase()));
  const grounded = refs.filter(r => {
    const key = `${r.book} ${r.chapter}:${r.verse}`.toUpperCase();
    return Array.from(retrievedSet).some(ret => ret === key || ret.startsWith(key + '-') || key.startsWith(ret));
  });
  return grounded.length / refs.length;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function gen(prompt: string, maxTok: number): Promise<{ text: string; latencyMs: number }> {
  const start = Date.now();
  const result = await (generateText as any)({
    model: groq('llama-3.1-8b-instant'),
    prompt,
    temperature: 0.1,
    maxTokens: maxTok,
  });
  return { text: result.text as string, latencyMs: Date.now() - start };
}

interface ArmResult {
  arm: 'BASELINE' | 'OPTIMIZED';
  queryId: string;
  genLatencyMs: number;
  wordCnt: number;
  grounding: number;
  hit1: number;
  hit5: number;
  mrr: number;
}

async function run() {
  console.log('='.repeat(80));
  console.log('  INDEPENDENT A/B VERIFICATION — TOKEN BUDGET OPTIMIZATION');
  console.log('  ARM A: maxTokens=2048  (no conciseness rule)  ← BASELINE');
  console.log('  ARM B: maxTokens=600   (conciseness rule)     ← OPTIMIZED');
  console.log('='.repeat(80) + '\n');

  const results: ArmResult[] = [];

  for (const q of QUERIES) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`[${q.id}] ${q.label}`);
    console.log(`Query: "${q.query}"`);
    console.log('─'.repeat(80));

    // 1. Retrieval — shared between both arms
    const retStart = Date.now();
    const verses = await retrieveContextForQuery(q.query, 'BSB') as VerseContext[];
    const retMs = Date.now() - retStart;
    const top5 = verses.slice(0, 5).map(v => v.reference);
    const hit1 = top5.length > 0 && checkRefMatch(top5[0], q.expectedRefs) ? 1 : 0;
    const hit5 = top5.some(r => checkRefMatch(r, q.expectedRefs)) ? 1 : 0;
    let firstRank = 0;
    for (let i = 0; i < top5.length; i++) { if (checkRefMatch(top5[i], q.expectedRefs)) { firstRank = i + 1; break; } }
    const mrr = firstRank > 0 ? 1 / firstRank : 0;

    console.log(`\n[Retrieval — identical for both arms]`);
    console.log(`  Latency : ${retMs} ms`);
    console.log(`  Top-5   : ${top5.join(', ')}`);
    console.log(`  Hit@1   : ${hit1 ? 'YES' : 'NO'}  Hit@5: ${hit5 ? 'YES' : 'NO'}  MRR: ${mrr.toFixed(3)}`);

    const promptFull = buildContextPrompt(q.query, verses, 'BSB');

    // 2. ARM A — BASELINE
    await new Promise(r => setTimeout(r, 1500));
    const basePrompt = withoutConciseness(promptFull);
    const base = await gen(basePrompt, 2048);
    const baseGround = citationGrounding(base.text, verses);
    const baseWords = wordCount(base.text);
    console.log(`\n[ARM A — BASELINE  | maxTokens=2048]`);
    console.log(`  Latency   : ${base.latencyMs} ms`);
    console.log(`  Word Count: ${baseWords} words`);
    console.log(`  Grounding : ${(baseGround * 100).toFixed(0)}%`);
    results.push({ arm: 'BASELINE', queryId: q.id, genLatencyMs: base.latencyMs, wordCnt: baseWords, grounding: baseGround, hit1, hit5, mrr });

    // 3. ARM B — OPTIMIZED
    await new Promise(r => setTimeout(r, 1500));
    const opt = await gen(promptFull, 900); // conciseness rule already in prompt
    const optGround = citationGrounding(opt.text, verses);
    const optWords = wordCount(opt.text);
    console.log(`\n[ARM B — OPTIMIZED | maxTokens=900 + conciseness rule]`);
    console.log(`  Latency   : ${opt.latencyMs} ms`);
    console.log(`  Word Count: ${optWords} words`);
    console.log(`  Grounding : ${(optGround * 100).toFixed(0)}%`);
    results.push({ arm: 'OPTIMIZED', queryId: q.id, genLatencyMs: opt.latencyMs, wordCnt: optWords, grounding: optGround, hit1, hit5, mrr });

    const latDiff = base.latencyMs - opt.latencyMs;
    const speedup = ((latDiff / base.latencyMs) * 100).toFixed(1);
    console.log(`\n[Delta]  Latency: ${latDiff > 0 ? '▼' : '▲'} ${Math.abs(latDiff)} ms (${speedup}% ${latDiff > 0 ? 'faster' : 'slower'})   Words: ${baseWords - optWords > 0 ? '▼' : '▲'} ${Math.abs(baseWords - optWords)}`);
  }

  // ── Aggregate ─────────────────────────────────────────────────────────
  function avg(arm: 'BASELINE' | 'OPTIMIZED', key: keyof ArmResult): number {
    const rows = results.filter(r => r.arm === arm);
    return rows.reduce((s, r) => s + (r[key] as number), 0) / rows.length;
  }

  const metrics: { label: string; key: keyof ArmResult; fmt: (v: number) => string; better: 'lower' | 'higher' }[] = [
    { label: 'Avg Generation Latency', key: 'genLatencyMs', fmt: v => `${v.toFixed(0)} ms`,   better: 'lower'  },
    { label: 'Avg Word Count',         key: 'wordCnt',      fmt: v => `${v.toFixed(0)} words`, better: 'lower'  },
    { label: 'Citation Grounding',     key: 'grounding',    fmt: v => `${(v*100).toFixed(1)}%`, better: 'higher' },
    { label: 'Hit @ 1',               key: 'hit1',         fmt: v => `${(v*100).toFixed(0)}%`, better: 'higher' },
    { label: 'Hit @ 5',               key: 'hit5',         fmt: v => `${(v*100).toFixed(0)}%`, better: 'higher' },
    { label: 'MRR',                   key: 'mrr',          fmt: v => v.toFixed(3),             better: 'higher' },
  ];

  console.log('\n' + '='.repeat(80));
  console.log('  AGGREGATE SUMMARY');
  console.log('='.repeat(80));
  console.log(`${'Metric'.padEnd(28)} ${'BASELINE'.padEnd(18)} ${'OPTIMIZED'.padEnd(18)} ${'Delta'.padEnd(20)} Verdict`);
  console.log('─'.repeat(80));

  for (const m of metrics) {
    const b = avg('BASELINE', m.key);
    const o = avg('OPTIMIZED', m.key);
    const delta = o - b;
    const sign = delta > 0 ? '+' : '';
    const isImproved = m.better === 'lower' ? delta < 0 : delta > 0;
    const verdict = isImproved ? '✅ BETTER' : (delta === 0 ? '➡ SAME' : '⚠ WORSE');
    const deltaFmt = m.key === 'genLatencyMs'
      ? `${sign}${delta.toFixed(0)} ms`
      : m.key === 'wordCnt'
        ? `${sign}${delta.toFixed(0)} words`
        : m.key === 'mrr'
          ? `${sign}${delta.toFixed(3)}`
          : `${sign}${(delta * 100).toFixed(1)}%`;
    console.log(`${m.label.padEnd(28)} ${m.fmt(b).padEnd(18)} ${m.fmt(o).padEnd(18)} ${deltaFmt.padEnd(20)} ${verdict}`);
  }
  console.log('='.repeat(80));
  console.log('\nVerification complete.\n');
}

run().catch(err => { console.error(err); process.exit(1); });
