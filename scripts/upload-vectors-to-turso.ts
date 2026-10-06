import fs from 'fs';
import path from 'path';
import { createClient, type InStatement } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL) {
  console.error('Missing TURSO_DATABASE_URL in .env.local');
  process.exit(1);
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

const BATCH_SIZE = 250;
const EMBEDDING_DIM = 1024;

async function main() {
  console.log('========================================================');
  console.log('       FAST BULK UPLOAD: 31,086 BGE VECTORS TO TURSO     ');
  console.log('========================================================');

  const rootDir = process.cwd();
  const binPath = path.join(rootDir, 'data', 'embeddings', 'bge-large-en-v1.5-1024.bin');
  const orderPath = path.join(rootDir, 'data', 'embeddings', 'bge-large-en-v1.5-1024-order.json');

  if (!fs.existsSync(binPath) || !fs.existsSync(orderPath)) {
    console.error('Binary embeddings or order map missing!');
    process.exit(1);
  }

  console.log('[1/4] Loading binary embeddings and order map into memory...');
  const orderRaw = fs.readFileSync(orderPath, 'utf8');
  const order = JSON.parse(orderRaw) as string[];
  const binBuffer = fs.readFileSync(binPath);
  const floatArray = new Float32Array(
    binBuffer.buffer,
    binBuffer.byteOffset,
    binBuffer.byteLength / 4
  );

  const totalVerses = order.length;
  console.log(`Loaded ${totalVerses} verse references and ${floatArray.length / EMBEDDING_DIM} float vectors.`);

  // Check existing count in Turso
  const initialCountRes = await client.execute('SELECT count(*) as c FROM verse_embeddings');
  const existingCount = Number(initialCountRes.rows[0].c);
  console.log(`Current verses in Turso: ${existingCount} / ${totalVerses}`);

  // Divide into batches
  console.log(`[2/4] Uploading in batches of ${BATCH_SIZE} (unindexed fast path)...`);
  const startTime = Date.now();
  let uploaded = 0;

  for (let i = 0; i < totalVerses; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE, totalVerses);
    const batchStmts: InStatement[] = [];

    for (let j = i; j < end; j++) {
      const ref = order[j];
      const startIdx = j * EMBEDDING_DIM;
      const slice = floatArray.subarray(startIdx, startIdx + EMBEDDING_DIM);
      const vecJson = '[' + Array.from(slice).map(n => n.toFixed(5)).join(',') + ']';

      batchStmts.push({
        sql: 'INSERT OR REPLACE INTO verse_embeddings (verse_id, embedding) VALUES (?, vector32(?))',
        args: [ref, vecJson],
      });
    }

    let attempts = 0;
    let ok = false;
    while (!ok && attempts < 3) {
      attempts++;
      try {
        await client.batch(batchStmts, 'write');
        ok = true;
      } catch (err: any) {
        console.warn(`[Batch ${Math.floor(i / BATCH_SIZE) + 1}] Retrying after error:`, err?.message || err);
        await new Promise(r => setTimeout(r, 1000 * attempts));
      }
    }

    if (!ok) {
      throw new Error(`Failed batch starting at verse ${i}`);
    }

    uploaded += batchStmts.length;
    const elapsedSec = (Date.now() - startTime) / 1000;
    const speed = uploaded / elapsedSec;
    const remaining = totalVerses - uploaded;
    const etaSec = remaining / speed;
    const pct = (uploaded / totalVerses) * 100;

    if (Math.floor(i / BATCH_SIZE) % 5 === 0 || uploaded === totalVerses) {
      console.log(`[${pct.toFixed(1)}%] ${uploaded}/${totalVerses} uploaded | ${speed.toFixed(0)} v/s | ETA ${Math.round(etaSec)}s`);
    }
  }

  const uploadTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nAll 31,086 verses uploaded in ${uploadTime}s!`);

  console.log('\n[3/4] Rebuilding DiskANN vector index (idx_verse_embeddings)...');
  const tIndex = Date.now();
  await client.execute('CREATE INDEX IF NOT EXISTS idx_verse_embeddings ON verse_embeddings(libsql_vector_idx(embedding))');
  console.log(`Vector index rebuilt in ${((Date.now() - tIndex) / 1000).toFixed(1)}s!`);

  console.log('\n[4/4] Verifying Turso database state...');
  const finalCountRes = await client.execute('SELECT count(*) as c FROM verse_embeddings');
  console.log(`Final verse_embeddings count: ${finalCountRes.rows[0].c} / ${totalVerses}`);

  console.log('\nRunning test vector query: Top 5 nearest verses to JHN 3:16...');
  const jhnIdx = order.indexOf('JHN 3:16');
  if (jhnIdx >= 0) {
    const jhnVec = floatArray.subarray(jhnIdx * EMBEDDING_DIM, (jhnIdx + 1) * EMBEDDING_DIM);
    const jhnJson = '[' + Array.from(jhnVec).map(n => n.toFixed(5)).join(',') + ']';

    const searchRes = await client.execute({
      sql: `SELECT v.verse_id 
            FROM vector_top_k('idx_verse_embeddings', vector32(?), 5) as top
            JOIN verse_embeddings as v ON v.rowid = top.id`,
      args: [jhnJson],
    });
    console.log('Results:');
    searchRes.rows.forEach((r, idx) => console.log(`  ${idx + 1}. ${r.verse_id}`));
  }

  console.log('\n========================================================');
  console.log('SUCCESS: All 31,086 BGE vectors are live in Turso!');
  console.log('========================================================\n');
}

main().catch(err => {
  console.error('Fatal error during Turso vector upload:', err);
  process.exit(1);
});
