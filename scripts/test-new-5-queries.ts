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
const groq = createGroq({ apiKey: groqApiKey });

interface QueryBenchmarkItem {
  id: string;
  category: string;
  query: string;
  translation: string;
  expectedKeyVerses: string[];
}

const testQueries: QueryBenchmarkItem[] = [
  {
    id: "query-1-good-samaritan",
    category: "Parable / Narrative",
    query: "What is the Parable of the Good Samaritan and its lesson?",
    translation: "BSB",
    expectedKeyVerses: ["LUK 10:25", "LUK 10:30", "LUK 10:33", "LUK 10:37"]
  },
  {
    id: "query-2-suffering-servant",
    category: "Messianic Prophecy",
    query: "Where is the Suffering Servant prophesied in Isaiah?",
    translation: "BSB",
    expectedKeyVerses: ["ISA 53:1", "ISA 53:3", "ISA 53:5", "ISA 53:6", "ISA 52:13"]
  },
  {
    id: "query-3-fruit-of-spirit",
    category: "Christian Character / Ethics",
    query: "What are the fruits of the Spirit listed by Paul?",
    translation: "BSB",
    expectedKeyVerses: ["GAL 5:22", "GAL 5:23", "GAL 5:24", "GAL 5:25"]
  },
  {
    id: "query-4-job-suffering",
    category: "Theodicy / Hard Questions",
    query: "Why do the righteous suffer according to the book of Job?",
    translation: "BSB",
    expectedKeyVerses: ["JOB 1:21", "JOB 2:10", "JOB 38:1", "JOB 42:2", "JOB 42:5"]
  },
  {
    id: "query-5-love-chapter",
    category: "Original Language / Exegesis",
    query: "Explain 1 Corinthians 13 and what agape love means",
    translation: "BSB",
    expectedKeyVerses: ["1CO 13:1", "1CO 13:4", "1CO 13:8", "1CO 13:13"]
  }
];

function checkRefMatch(actualRef: string, expectedRefs: string[]): boolean {
  const normActual = actualRef.trim().toUpperCase();
  const actualMatch = normActual.match(/^([1-3]?\s?[A-Z]{3})\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!actualMatch) {
    return expectedRefs.some(exp => normActual.includes(exp.toUpperCase()));
  }
  const [, aBook, aChap, aStartStr, aEndStr] = actualMatch;
  const aStart = parseInt(aStartStr, 10);
  const aEnd = aEndStr ? parseInt(aEndStr, 10) : aStart;

  return expectedRefs.some(exp => {
    const normExp = exp.trim().toUpperCase();
    const expMatch = normExp.match(/^([1-3]?\s?[A-Z]{3})\s+(\d+):(\d+)(?:-(\d+))?$/);
    if (!expMatch) return normActual === normExp || normActual.includes(normExp);
    const [, eBook, eChap, eStartStr, eEndStr] = expMatch;
    if (aBook !== eBook || aChap !== eChap) return false;
    const eStart = parseInt(eStartStr, 10);
    const eEnd = eEndStr ? parseInt(eEndStr, 10) : eStart;
    return Math.max(aStart, eStart) <= Math.min(aEnd, eEnd);
  });
}

async function runNewQueriesBenchmark() {
  console.log("================================================================================");
  console.log("       BIBLELM EVALUATION: 5 NEW DISTINCT QUERY-RESPONSE TESTS                  ");
  console.log("================================================================================\n");

  const results: any[] = [];

  for (const [index, item] of testQueries.entries()) {
    console.log(`\n================================================================================`);
    console.log(`[QUERY ${index + 1}/${testQueries.length}] Category: ${item.category}`);
    console.log(`User Question: "${item.query}"`);
    console.log(`Target Translation: ${item.translation}`);
    console.log(`================================================================================`);

    // 1. Measure Retrieval
    const retrievalStart = Date.now();
    const verses: VerseContext[] = await retrieveContextForQuery(item.query, item.translation);
    const retrievalLatency = Date.now() - retrievalStart;

    const top5Refs = verses.slice(0, 5).map(v => v.reference);
    const top1Ref = top5Refs[0] || "NONE";

    const hitAt1 = checkRefMatch(top1Ref, item.expectedKeyVerses) ? 1 : 0;
    const hitAt5 = top5Refs.some(r => checkRefMatch(r, item.expectedKeyVerses)) ? 1 : 0;

    let firstMatchRank = 0;
    for (let r = 0; r < top5Refs.length; r++) {
      if (checkRefMatch(top5Refs[r], item.expectedKeyVerses)) {
        firstMatchRank = r + 1;
        break;
      }
    }
    const mrr = firstMatchRank > 0 ? 1 / firstMatchRank : 0;
    const precisionAt5 = top5Refs.filter(r => checkRefMatch(r, item.expectedKeyVerses)).length / Math.max(1, top5Refs.length);

    console.log(`\n--- 1. Retrieval Metrics ---`);
    console.log(`• Latency: ${retrievalLatency}ms`);
    console.log(`• Hit@1: ${hitAt1 ? 'YES' : 'NO'} (${top1Ref})`);
    console.log(`• Hit@5: ${hitAt5 ? 'YES' : 'NO'}`);
    console.log(`• MRR: ${mrr.toFixed(3)} (Rank: ${firstMatchRank || 'N/A'})`);
    console.log(`• Precision@5: ${(precisionAt5 * 100).toFixed(0)}%`);
    console.log(`• Verses Retrieved (${verses.length} total):`);
    verses.slice(0, 5).forEach((v, i) => {
      console.log(`   [${i + 1}] ${v.reference} - "${v.text.slice(0, 80)}..."`);
    });

    // 2. Build Prompt & LLM Generation
    const prompt = buildContextPrompt(item.query, verses, item.translation);
    console.log(`\n--- 2. Generation Execution (Groq Llama 3.1 8B Instant) ---`);
    
    await new Promise((r) => setTimeout(r, 1500));
    let llmStart = Date.now();
    let responseText = "";
    let llmLatency = 0;

    try {
      const llmResult = await generateText({
        model: groq('llama-3.1-8b-instant'),
        prompt: prompt,
        temperature: 0.1,
      });
      llmLatency = Date.now() - llmStart;
      responseText = llmResult.text;
    } catch (err: any) {
      console.error("LLM Generation Error:", err.message);
      responseText = "ERROR: " + err.message;
    }

    console.log(`• Generation Latency: ${llmLatency}ms`);
    console.log(`• Total End-to-End Latency: ${retrievalLatency + llmLatency}ms`);
    console.log(`\n--- 3. Generated Assistant Response ---`);
    console.log(responseText);

    // 3. Citation Validity Check
    const extractedRefs = extractDirectReferences(responseText);
    const citationStrings = extractedRefs.map(r => `${r.book} ${r.chapter}:${r.verse}`);
    const retrievedSet = new Set(verses.map(v => v.reference.toUpperCase()));
    const validCitations = citationStrings.filter(c => {
      return checkRefMatch(c, Array.from(retrievedSet));
    });
    const citationValidity = citationStrings.length === 0 ? 1 : validCitations.length / citationStrings.length;

    console.log(`\n--- 4. Citation Grounding Audit ---`);
    console.log(`• Citations Extracted from Answer: ${citationStrings.join(', ') || 'None explicit'}`);
    console.log(`• Grounded Citations (in context): ${validCitations.join(', ') || 'None'}`);
    console.log(`• Grounding Score: ${(citationValidity * 100).toFixed(0)}%`);

    results.push({
      id: item.id,
      category: item.category,
      query: item.query,
      retrievalLatency,
      llmLatency,
      totalLatency: retrievalLatency + llmLatency,
      hitAt1,
      hitAt5,
      mrr,
      precisionAt5,
      citationValidity,
    });
  }

  // Summary
  const avgRetrieval = results.reduce((acc, r) => acc + r.retrievalLatency, 0) / results.length;
  const avgLLM = results.reduce((acc, r) => acc + r.llmLatency, 0) / results.length;
  const avgTotal = results.reduce((acc, r) => acc + r.totalLatency, 0) / results.length;
  const hit1Rate = results.reduce((acc, r) => acc + r.hitAt1, 0) / results.length;
  const hit5Rate = results.reduce((acc, r) => acc + r.hitAt5, 0) / results.length;
  const meanMRR = results.reduce((acc, r) => acc + r.mrr, 0) / results.length;
  const meanPrec5 = results.reduce((acc, r) => acc + r.precisionAt5, 0) / results.length;
  const meanCitation = results.reduce((acc, r) => acc + r.citationValidity, 0) / results.length;

  console.log(`\n================================================================================`);
  console.log(`                  NEW 5-QUERY BENCHMARK AGGREGATE SUMMARY                       `);
  console.log(`================================================================================\n`);
  console.log(`Metric                          | Value`);
  console.log(`--------------------------------|-------------------------`);
  console.log(`Average Retrieval Latency       | ${avgRetrieval.toFixed(1)} ms`);
  console.log(`Average LLM Generation Latency  | ${avgLLM.toFixed(1)} ms`);
  console.log(`Average End-to-End Latency      | ${avgTotal.toFixed(1)} ms`);
  console.log(`Hit @ 1                         | ${(hit1Rate * 100).toFixed(1)}%`);
  console.log(`Hit @ 5                         | ${(hit5Rate * 100).toFixed(1)}%`);
  console.log(`Mean Reciprocal Rank (MRR)      | ${meanMRR.toFixed(3)}`);
  console.log(`Precision @ 5                   | ${(meanPrec5 * 100).toFixed(1)}%`);
  console.log(`Citation Validity Rate          | ${(meanCitation * 100).toFixed(1)}%`);
  console.log(`\n================================================================================`);
}

runNewQueriesBenchmark().catch(console.error);
