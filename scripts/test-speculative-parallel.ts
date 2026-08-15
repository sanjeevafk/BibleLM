import { retrieveContextForQuery } from '../lib/retrieval';
import { classifyAndRewriteQuery } from '../app/api/chat/lib/query-classifier';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function runSpeculativeBenchmark() {
  console.log("================================================================================");
  console.log("        SPECULATIVE PARALLEL RETRIEVAL VS SEQUENTIAL BENCHMARK                  ");
  console.log("================================================================================\n");

  const testCases = [
    {
      name: "Turn 1 (Direct Topic Query - No History)",
      query: "What does the Bible say about anxiety and peace?",
      history: []
    },
    {
      name: "Turn 1 (Story/Pericope Query - No History)",
      query: "Tell me about the Parable of the Good Samaritan",
      history: []
    },
    {
      name: "Turn 2 (Follow-up requiring pronoun resolution)",
      query: "What was the father's response to him?",
      history: [
        { role: 'user' as const, content: "Tell me about the Parable of the Prodigal Son" },
        { role: 'assistant' as const, content: "In Luke 15:11-32, Jesus tells the story of the lost son who returns home..." }
      ]
    },
    {
      name: "Turn 2 (Direct query inside existing conversation)",
      query: "What are the fruits of the Spirit?",
      history: [
        { role: 'user' as const, content: "Explain 1 Corinthians 13" },
        { role: 'assistant' as const, content: "In 1 Corinthians 13, Paul explains agape love..." }
      ]
    }
  ];

  for (const tc of testCases) {
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`TEST CASE: ${tc.name}`);
    console.log(`Query: "${tc.query}"`);
    console.log(`History length: ${tc.history.length}`);
    console.log(`--------------------------------------------------------------------------------`);

    // --- 1. Old Sequential Pattern ---
    const seqStart = performance.now();
    let seqQuery = tc.query;
    if (tc.history.length > 0) {
      const cls = await classifyAndRewriteQuery(tc.query, tc.history);
      if (cls.searchQuery) seqQuery = cls.searchQuery;
    }
    const seqVerses = await retrieveContextForQuery(seqQuery, 'BSB');
    const seqDuration = performance.now() - seqStart;

    // Pause between calls
    await new Promise(r => setTimeout(r, 1000));

    // --- 2. New Speculative Parallel Pattern ---
    const parStart = performance.now();
    let parVerses = [];
    if (tc.history.length === 0) {
      // Turn 1 Fast-Path
      parVerses = await retrieveContextForQuery(tc.query, 'BSB');
    } else {
      // Turn 2+ Speculative Parallel
      const speculativePromise = retrieveContextForQuery(tc.query, 'BSB');
      const classificationPromise = classifyAndRewriteQuery(tc.query, tc.history);
      const [specVerses, classification] = await Promise.all([speculativePromise, classificationPromise]);
      
      if (classification.searchQuery && classification.searchQuery.trim().toLowerCase() !== tc.query.trim().toLowerCase()) {
        parVerses = await retrieveContextForQuery(classification.searchQuery, 'BSB');
      } else {
        parVerses = specVerses;
      }
    }
    const parDuration = performance.now() - parStart;

    console.log(`• Sequential Pipeline Latency : ${seqDuration.toFixed(1)} ms`);
    console.log(`• Speculative Parallel Latency: ${parDuration.toFixed(1)} ms`);
    const saved = seqDuration - parDuration;
    console.log(`• Latency Reduction           : ${saved >= 0 ? '-' : '+'}${Math.abs(saved).toFixed(1)} ms (${((saved / seqDuration) * 100).toFixed(1)}% faster)`);
    console.log(`• Top Verse Retrieved         : ${parVerses[0]?.reference || 'None'}`);
    console.log();

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log("================================================================================\n");
}

runSpeculativeBenchmark().catch(console.error);
