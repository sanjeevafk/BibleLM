import dotenv from 'dotenv';
import path from 'path';
import { Pool } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

const POSTGRES_URL = process.env.POSTGRES_URL;
const HF_TOKEN = process.env.HF_TOKEN;
const MODEL = process.env.HF_EMBEDDING_MODEL || 'intfloat/multilingual-e5-small';
const BATCH_SIZE = Number.parseInt(process.env.EMBED_BATCH_SIZE || '64', 10);
const RATE_LIMIT_MS = Number.parseInt(process.env.HF_RATE_LIMIT_MS || '0', 10);
const FORCE = process.env.FORCE_EMBEDDINGS === 'true';

// === UPDATED ENDPOINT (this fixes the 410 error) ===
const HF_ENDPOINT = `https://router.huggingface.co/hf-inference/models/${MODEL}/pipeline/feature-extraction`;

type VerseRow = {
  id: number;
  text: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const size = vectors[0].length;
  const sums = new Array<number>(size).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < size; i += 1) {
      sums[i] += vec[i];
    }
  }
  return sums.map((value) => value / vectors.length);
}

function normalizeEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
    return raw as number[];
  }
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    return meanPool(raw as number[][]);
  }
  throw new Error('Unexpected embedding response shape');
}

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  const inputs = texts.map((text) => `passage: ${text}`);

  const response = await fetch(HF_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs,
      options: { wait_for_model: true }   // ← helps with cold-start models
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF embeddings failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as unknown;
  if (Array.isArray(data)) {
    return data.map((item) => normalizeEmbedding(item));
  }

  throw new Error('HF embeddings response was not an array');
}

function toVectorString(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function updateEmbeddings(pool: Pool, rows: VerseRow[], embeddings: number[][]) {
  if (rows.length === 0) return;

  const values: Array<number | string> = [];
  const placeholders: string[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const base = i * 2;
    placeholders.push(`($${base + 1}::bigint, $${base + 2})`);
    values.push(rows[i].id, toVectorString(embeddings[i]));
  }

  await pool.query(
    `UPDATE verses AS v SET embedding = data.embedding::vector(384)
     FROM (VALUES ${placeholders.join(', ')}) AS data(id, embedding)
     WHERE v.id = data.id`,
    values,
  );
}

async function ensureVectorDimension(pool: Pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
  await pool.query('ALTER TABLE verses ADD COLUMN IF NOT EXISTS embedding vector(384)');
  await pool.query('ALTER TABLE verses ALTER COLUMN embedding TYPE vector(384)');
}

async function main() {
  if (!POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not set');
  }
  if (!HF_TOKEN) {
    throw new Error('HF_TOKEN is not set');
  }

  const pool = new Pool({ connectionString: POSTGRES_URL });

  try {
    await ensureVectorDimension(pool);

    let lastId = 0;
    let total = 0;

    while (true) {
      const query = FORCE
        ? 'SELECT id, text FROM verses WHERE id > $1 ORDER BY id ASC LIMIT $2'
        : 'SELECT id, text FROM verses WHERE id > $1 AND embedding IS NULL ORDER BY id ASC LIMIT $2';

      const result = await pool.query<VerseRow>(query, [lastId, BATCH_SIZE]);
      if (result.rows.length === 0) {
        break;
      }

      const rows = result.rows;
      lastId = rows[rows.length - 1].id;

      const embeddings = await fetchEmbeddings(rows.map((row) => row.text));
      if (embeddings.some((emb) => emb.length !== 384)) {
        throw new Error('Embedding dimension mismatch; expected 384.');
      }

      await updateEmbeddings(pool, rows, embeddings);
      total += rows.length;
      console.log(`Updated ${total} embeddings`);

      if (RATE_LIMIT_MS > 0) {
        await sleep(RATE_LIMIT_MS);
      }
    }

    console.log('✅ All embeddings completed!');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});