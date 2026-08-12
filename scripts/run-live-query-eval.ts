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
    id: "query-1-anxiety",
    category: "Topical / Life Advice",
    query: "What does the Bible say about anxiety and peace of mind?",
    translation: "BSB",
    expectedKeyVerses: ["PHP 4:6", "PHP 4:7", "1PE 5:7", "MAT 6:25", "MAT 6:34", "PSA 55:22"]
  },
  {
    id: "query-2-exegesis",
    category: "Original Language / Exegesis",
    query: "Explain John 1:1 and what the Word (Logos) means in Greek",
    translation: "BSB",
    expectedKeyVerses: ["JHN 1:1", "JHN 1:2", "JHN 1:14", "1JN 1:1", "REV 19:13"]
  },
  {
    id: "query-3-ethics",
    category: "Ethical / Behavioral Teaching",
    query: "How should a Christian treat their enemies according to Jesus?",
    translation: "BSB",
    expectedKeyVerses: ["MAT 5:44", "LUK 6:27", "LUK 6:35", "ROM 12:20", "PRO 25:21"]
  },
  {
    id: "query-4-theology",
    category: "Theological Controversy",
    query: "Is salvation by faith alone or do works matter?",
    translation: "BSB",
    expectedKeyVerses: ["EPH 2:8", "EPH 2:9", "JAS 2:14", "JAS 2:24", "ROM 3:28", "GAL 2:16"]
  },
  {
    id: "query-5-commandments",
    category: "Passage / Direct Text",
    query: "What are the Ten Commandments given in Exodus 20?",
    translation: "BSB",
    expectedKeyVerses: ["EXO 20:1", "EXO 20:2", "EXO 20:3", "EXO 20:4", "DEU 5:6"]
  }
];

function checkRefMatch(actualRef: string, expectedRefs: string[]): boolean {
  const normActual = actualRef.trim().toUpperCase();
  return expectedRefs.some(exp => {
    const normExp = exp.trim().toUpperCase();
    return normActual === normExp || normActual.startsWith(normExp + "-") || normExp.startsWith(normActual);
  });
}

function extractCitations(text: string): string[] {
  const matches = text.match(/\b([1-3]?\s?[A-Z][a-z]+|\b[1-3]?\s?[A-Z]{3})\s+\d+:\d+(?:-\d+)?\b/g) || [];
  return Array.from(new Set(matches));
}

async function runBenchmark() {
  console.log("================================================================================");
  console.log("           BIBLELM END-TO-END QUERY BENCHMARK & EVALUATION                      ");
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
      const upper = c.toUpperCase();
      return Array.from(retrievedSet).some(ret => ret === upper || ret.startsWith(upper + "-") || upper.startsWith(ret));
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
      topRefs: top5Refs,
      response: responseText
    });
  }

  // Summary Table
  console.log("\n================================================================================");
  console.log("                          BENCHMARK AGGREGATE SUMMARY                           ");
  console.log("================================================================================");
  const avgRetrievalLat = results.reduce((acc, r) => acc + r.retrievalLatency, 0) / results.length;
  const avgLlmLat = results.reduce((acc, r) => acc + r.llmLatency, 0) / results.length;
  const avgTotalLat = results.reduce((acc, r) => acc + r.totalLatency, 0) / results.length;
  const avgHit1 = results.reduce((acc, r) => acc + r.hitAt1, 0) / results.length;
  const avgHit5 = results.reduce((acc, r) => acc + r.hitAt5, 0) / results.length;
  const avgMRR = results.reduce((acc, r) => acc + r.mrr, 0) / results.length;
  const avgPrec5 = results.reduce((acc, r) => acc + r.precisionAt5, 0) / results.length;
  const avgCitationVal = results.reduce((acc, r) => acc + r.citationValidity, 0) / results.length;

  console.log(`\nMetric                          | Value`);
  console.log(`--------------------------------|-------------------------`);
  console.log(`Average Retrieval Latency       | ${avgRetrievalLat.toFixed(1)} ms`);
  console.log(`Average LLM Generation Latency  | ${avgLlmLat.toFixed(1)} ms`);
  console.log(`Average End-to-End Latency      | ${avgTotalLat.toFixed(1)} ms`);
  console.log(`Hit @ 1                         | ${(avgHit1 * 100).toFixed(1)}%`);
  console.log(`Hit @ 5                         | ${(avgHit5 * 100).toFixed(1)}%`);
  console.log(`Mean Reciprocal Rank (MRR)      | ${avgMRR.toFixed(3)}`);
  console.log(`Precision @ 5                   | ${(avgPrec5 * 100).toFixed(1)}%`);
  console.log(`Citation Validity Rate          | ${(avgCitationVal * 100).toFixed(1)}%`);
}

runBenchmark().catch(console.error);
