/**
 * A/B comparison: GraphRAG OFF vs ON for multi-hop theological queries.
 * Measures actual retrieval differences, not just latency.
 */
import { retrieveContextForQuery } from '../../lib/retrieval';

const QUERIES = [
  'What does the Bible say about faith and works together?',
  'Old Testament prophecies fulfilled in Jesus',
  'What does Paul say about the law and grace?',
  'How does the Old and New Testament connect on the concept of atonement?',
  'What is the relationship between the Passover lamb and Christ?',
];

type RunResult = {
  query: string;
  verseIds: string[];
  verseCount: number;
  latencyMs: number;
};

async function runQuery(query: string): Promise<RunResult> {
  const start = performance.now();
  const result = await retrieveContextForQuery(query, 'BSB');
  const latency = performance.now() - start;
  return {
    query,
    verseIds: result.map((v: any) => v.verseId || v.reference || '').filter(Boolean),
    verseCount: result.length,
    latencyMs: Math.round(latency),
  };
}

async function main() {
  const graphFlag = process.env.ENABLE_GRAPH_RAG === '1' ? 'ON' : 'OFF';
  console.log(`\n=== GraphRAG ${graphFlag} ===\n`);

  const results: RunResult[] = [];
  for (const query of QUERIES) {
    const result = await runQuery(query);
    results.push(result);
    console.log(`Query: "${query}"`);
    console.log(`  Verses (${result.verseCount}): ${result.verseIds.join(', ')}`);
    console.log(`  Latency: ${result.latencyMs}ms\n`);
  }

  // Output as JSON for diffing
  const path = await import('path');
  const fs = await import('fs');
  const outDir = path.resolve(process.cwd(), 'project-docs', 'benchmark');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outputPath = path.join(
    outDir,
    graphFlag === 'ON' ? 'ab-graphrag-on.json' : 'ab-graphrag-off.json'
  );

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`Results saved to ${outputPath}`);
}

main().catch(console.error);
