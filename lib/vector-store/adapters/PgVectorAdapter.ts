/**
 * lib/vector-store/adapters/PgVectorAdapter.ts
 *
 * Stub adapter for a pgvector (PostgreSQL + vector extension) backend.
 *
 * Replace the `TODO` sections with real implementation when migrating from the
 * local BM25 index to an enterprise PostgreSQL vector store.
 *
 * Why this stub matters for the portfolio
 * ────────────────────────────────────────
 * The IVectorStore contract guarantees that swapping from LocalBM25Adapter to
 * PgVectorAdapter requires zero changes to the retrieval pipeline — only the
 * adapter import in `lib/vector-store/index.ts` needs to change.
 */

import type { IVectorStore, VectorStoreQuery, VectorStoreResult } from '../types';

export class PgVectorAdapter implements IVectorStore {
  readonly name = 'PgVectorAdapter';

  private ready = false;

  // ---------------------------------------------------------------------------
  // IVectorStore — lifecycle
  // ---------------------------------------------------------------------------

  isReady(): boolean {
    return this.ready;
  }

  async init(): Promise<void> {
    if (this.ready) return;

    /**
     * TODO: Connect to a PostgreSQL instance with the pgvector extension.
     *
     * Example setup:
     *   const pool = new Pool({ connectionString: env.DATABASE_URL });
     *   await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
     *   await pool.query(`
     *     CREATE TABLE IF NOT EXISTS verse_embeddings (
     *       id TEXT PRIMARY KEY,
     *       embedding vector(768),
     *       text TEXT
     *     );
     *   `);
     *   this.pool = pool;
     */

    console.warn(`[${this.name}] init() is a stub. Implement PostgreSQL/pgvector connection.`);
    this.ready = true;
  }

  // ---------------------------------------------------------------------------
  // IVectorStore — query
  // ---------------------------------------------------------------------------

  async query({ text, topK = 10, translation }: VectorStoreQuery): Promise<VectorStoreResult[]> {
    await this.init();

    /**
     * TODO: Generate a query embedding and run a similarity search.
     *
     * Example (using Gemini Embeddings API):
     *   const { GoogleGenerativeAI } = await import('@google/generative-ai');
     *   const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY!);
     *   const model = genAI.getGenerativeModel({ model: 'embedding-001' });
     *   const { embedding } = await model.embedContent(text);
     *   const vector = JSON.stringify(embedding.values);
     *
     * Example SQL (pgvector cosine distance):
     *   const sql = `
     *     SELECT id, text, 1 - (embedding <=> $1::vector) AS score
     *     FROM verse_embeddings
     *     WHERE translation = $2
     *     ORDER BY score DESC
     *     LIMIT $3
     *   `;
     *   const { rows } = await this.pool.query(sql, [vector, translation ?? 'BSB', topK]);
     *   return rows.map(r => ({ id: r.id, score: r.score, text: r.text }));
     */

    console.warn(`[${this.name}] query() is a stub. Implement pgvector similarity search.`);
    return [];
  }
}
