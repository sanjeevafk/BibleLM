import { hybridSearch, createRetrievalDebugState } from '../lib/retrieval/search';

const goldenQueries = [
  { query: "Faith vs Works", expectedRef: "JAS 2:24" },
  { query: "Love your enemies", expectedRef: "MAT 5:44" },
  { query: "The Ten Commandments", expectedRef: "EXO 20:1" }, // Or just some verse in Exo 20
  { query: "Jesus wept", expectedRef: "JHN 11:35" },
  { query: "Apostle Paul's conversion on the road to Damascus", expectedRef: "ACT 9:3" }
];

async function runBenchmark() {
  console.log('--- BM25 Retrieval Benchmark ---');
  
  // Cold Start
  const startCold = Date.now();
  await hybridSearch("init", { topK: 1 });
  const endCold = Date.now();
  console.log(`Cold Start Latency: ${endCold - startCold}ms (includes loading index)`);

  let totalP5 = 0;
  let totalRR = 0;
  let totalLatency = 0;

  for (const item of goldenQueries) {
    const start = Date.now();
    const results = await hybridSearch(item.query, { topK: 10 });
    const latency = Date.now() - start;
    totalLatency += latency;

    const rank = results.findIndex(v => v.verseId.startsWith(item.expectedRef)) + 1;
    const found = rank > 0;
    const p5Match = rank > 0 && rank <= 5;
    
    if (p5Match) totalP5++;
    if (found) totalRR += (1 / rank);

    console.log(`Query: "${item.query}" -> ${found ? 'Found at rank ' + rank : 'Not found'} (${latency}ms)`);
    if (!found) {
      console.log(`  Top matches: ${results.slice(0, 5).map(r => r.verseId).join(', ') || 'NONE'}`);
    }
  }


  const avgLatency = totalLatency / goldenQueries.length;
  const mrr = totalRR / goldenQueries.length;
  const precisionAt5 = totalP5 / goldenQueries.length;

  console.log('--- Summary ---');
  console.log(`Average Latency (Warm): ${avgLatency.toFixed(2)}ms`);
  console.log(`MRR: ${mrr.toFixed(4)}`);
  console.log(`Precision@5: ${precisionAt5.toFixed(2)}`);
}

runBenchmark().catch(console.error);
