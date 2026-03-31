import fs from 'fs';
import path from 'path';
import { BM25Engine } from '../lib/retrieval/bm25';

async function buildIndex() {
  console.log('--- BM25 Index Builder ---');

  const indexPath = path.join(process.cwd(), 'data', 'bible-full-index.json');
  const outputPath = path.join(process.cwd(), 'data', 'bm25-state.json');

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (!fs.existsSync(indexPath)) {
    console.error('Error: bible-full-index.json not found. Run scripts/prepare-index.ts first.');
    process.exit(1);
  }

  console.log('Loading full Bible index...');
  const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  console.log('Building BM25 engine (caching TF/IDF maps)...');
  const start = Date.now();
  const engine = await BM25Engine.createFromIndex(indexData);
  const duration = Date.now() - start;
  console.log(`Indexing complete in ${duration}ms.`);

  console.log('Exporting state...');
  const state = engine.exportState();

  console.log(`Writing state to ${outputPath}...`);
  fs.writeFileSync(outputPath, JSON.stringify(state));

  const stats = fs.statSync(outputPath);
  console.log(`Success! BM25 state file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

buildIndex().catch((err) => {
  console.error(err);
  process.exit(1);
});
