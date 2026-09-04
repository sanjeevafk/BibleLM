/**
 * scripts/eval-raw-bm25.ts — TS raw-BM25 reference for Rust side-by-side eval.
 *
 * Runs every scenario in tests/benchmark/fixtures/scenarios.json through the
 * production BM25Engine (same prepareSearchQuery as run-benchmarks.ts) and
 * writes {scenarioId: [top5 refs]} JSON. The Rust `eval` subcommand scores
 * both engines with one implementation and diffs the ref lists exactly.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/eval-raw-bm25.ts [out.json]
 */
import fs from 'fs';
import path from 'path';
import { BM25Engine } from '../lib/retrieval/bm25';

type Scenario = {
  id: string;
  query: string;
  translation?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
};

function prepareSearchQuery(scenario: Scenario): string {
  if (scenario.conversationHistory && scenario.conversationHistory.length > 0) {
    const historyText = scenario.conversationHistory.map((item) => item.content).join(' ');
    return `${historyText} ${scenario.query}`;
  }
  return scenario.query;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const scenarios: Scenario[] = JSON.parse(
    fs.readFileSync(path.join(root, 'tests/benchmark/fixtures/scenarios.json'), 'utf8')
  );
  const indexData = JSON.parse(
    fs.readFileSync(path.join(root, 'data/bible-full-index.json'), 'utf8')
  );
  const engine = await BM25Engine.createFromIndex(indexData);
  const out: Record<string, string[]> = {};
  for (const scenario of scenarios) {
    const hits = engine.search(prepareSearchQuery(scenario), 5);
    out[scenario.id] = hits.map((h) => h.doc.id.trim().toUpperCase());
  }
  const outPath = process.argv[2] ?? path.join(root, 'data/rust/ts-raw-bm25-refs.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`wrote ${outPath} (${scenarios.length} scenarios)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
