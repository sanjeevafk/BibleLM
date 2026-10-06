import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL ?? '';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN ?? '';
if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required (never hardcode them)');
}

interface GraphIndex {
  version: string;
  nodes: Array<{ id: string; kind: 'verse' | 'topic' }>;
  adjacency: Record<string, Array<{ id: string; weight: number; kind: string }>>;
  metadata: { sourceFiles: string[]; totalEdges: number };
}

async function migrateGraphToTurso() {
  const rootDir = process.cwd();
  const graphFile = path.join(rootDir, 'data', 'graph-index.json');

  if (!fs.existsSync(graphFile)) {
    throw new Error(`Graph index not found at ${graphFile}. Run 'npm run build:graph-index' first.`);
  }

  console.log(`[1/3] Reading graph index from ${graphFile}...`);
  const raw = fs.readFileSync(graphFile, 'utf8');
  const graph = JSON.parse(raw) as GraphIndex;

  console.log(`Loaded graph with ${graph.nodes.length} nodes and ${graph.metadata.totalEdges} edges.`);

  const client = createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN,
  });

  console.log('[2/3] Ensuring tables and indexes exist in Turso...');
  await client.execute(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      weight REAL NOT NULL,
      kind TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id)
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id, weight DESC);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);`);

  console.log('[3/3] Inserting graph edges into Turso in transactional batches...');
  const BATCH_SIZE = 500;
  let batch: Array<{ sql: string; args: [string, string, number, string] }> = [];
  let inserted = 0;
  const start = Date.now();

  const entries = Object.entries(graph.adjacency);
  for (const [sourceId, targets] of entries) {
    for (const target of targets) {
      batch.push({
        sql: `INSERT OR REPLACE INTO graph_edges (source_id, target_id, weight, kind) VALUES (?, ?, ?, ?)`,
        args: [sourceId, target.id, target.weight, target.kind],
      });

      if (batch.length >= BATCH_SIZE) {
        await client.batch(batch, 'write');
        inserted += batch.length;
        batch = [];
        const elapsed = (Date.now() - start) / 1000;
        const rate = (inserted / elapsed).toFixed(0);
        const pct = ((inserted / graph.metadata.totalEdges) * 100).toFixed(1);
        process.stdout.write(`\rInserted ${inserted}/${graph.metadata.totalEdges} edges (${pct}%) at ${rate} edges/sec...`);
      }
    }
  }

  if (batch.length > 0) {
    await client.batch(batch, 'write');
    inserted += batch.length;
  }

  console.log(`\nMigration complete! Inserted ${inserted} edges in ${((Date.now() - start) / 1000).toFixed(1)}s.`);

  // Verification count
  const countRes = await client.execute('SELECT COUNT(*) as total FROM graph_edges');
  console.log(`Turso database row count in graph_edges: ${countRes.rows[0].total}`);
}

migrateGraphToTurso().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
