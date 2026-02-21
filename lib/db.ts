import { Pool } from 'pg';

type PoolGlobal = typeof globalThis & { __bibleLmPool?: Pool };
let dbReady = false;

export function getDbPool(): Pool {
  const globalForPool = globalThis as PoolGlobal;
  if (globalForPool.__bibleLmPool) {
    return globalForPool.__bibleLmPool;
  }

  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('POSTGRES_URL is not set');
  }

  globalForPool.__bibleLmPool = new Pool({ connectionString });
  return globalForPool.__bibleLmPool;
}

export async function ensureDbReady(): Promise<void> {
  if (dbReady) return;

  const pool = getDbPool();
  const vectorExt = await pool.query<{ extname: string }>(
    "SELECT extname FROM pg_extension WHERE extname = 'vector'",
  );
  if (vectorExt.rowCount === 0) {
    throw new Error('pgvector extension is not installed');
  }

  const embeddingCol = await pool.query<{ data_type: string }>(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_name = 'verses' AND column_name = 'embedding'`,
  );
  if (embeddingCol.rowCount === 0) {
    throw new Error('verses.embedding column is missing');
  }

  dbReady = true;
}
