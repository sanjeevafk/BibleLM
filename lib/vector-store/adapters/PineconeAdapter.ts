/**
 * lib/vector-store/adapters/PineconeAdapter.ts
 *
 * Stub adapter for the Pinecone managed vector database.
 *
 * Swap `LocalBM25Adapter` for this in `lib/vector-store/index.ts` when you
 * need cloud-scale ANN (approximate nearest-neighbour) search with zero ops.
 *
 * Why this stub matters for the portfolio
 * ────────────────────────────────────────
 * Demonstrates the IVectorStore contract enables cloud-scale upgrades without
 * touching any retrieval pipeline logic — only the adapter registration changes.
 */

import type { IVectorStore, VectorStoreQuery, VectorStoreResult } from '../types';

export class PineconeAdapter implements IVectorStore {
  readonly name = 'PineconeAdapter';

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
     * TODO: Initialise the Pinecone client and connect to an index.
     *
     * Example:
     *   import { Pinecone } from '@pinecone-database/pinecone';
     *   this.pinecone = new Pinecone({ apiKey: env.PINECONE_API_KEY! });
     *   this.index = this.pinecone.index(env.PINECONE_INDEX_NAME!);
     *
     * Add to config/env.ts:
     *   PINECONE_API_KEY: z.string().min(1).optional(),
     *   PINECONE_INDEX_NAME: z.string().min(1).optional(),
     */

    console.warn(`[${this.name}] init() is a stub. Implement Pinecone client initialisation.`);
    this.ready = true;
  }

  // ---------------------------------------------------------------------------
  // IVectorStore — query
  // ---------------------------------------------------------------------------

  async query({ text, topK = 10, translation }: VectorStoreQuery): Promise<VectorStoreResult[]> {
    await this.init();

    /**
     * TODO: Generate a query embedding and query the Pinecone index.
     *
     * Example:
     *   // 1. Embed the query
     *   const embeddingResponse = await openai.embeddings.create({
     *     model: 'text-embedding-3-small',
     *     input: text,
     *   });
     *   const vector = embeddingResponse.data[0].embedding;
     *
     *   // 2. Query Pinecone with optional metadata filter
     *   const results = await this.index.query({
     *     vector,
     *     topK,
     *     filter: translation ? { translation: { $eq: translation } } : undefined,
     *     includeMetadata: true,
     *   });
     *
     *   return (results.matches ?? []).map(m => ({
     *     id: m.id,
     *     score: m.score ?? 0,
     *     text: (m.metadata?.text as string) ?? undefined,
     *   }));
     */

    console.warn(`[${this.name}] query() is a stub. Implement Pinecone similarity search.`);
    return [];
  }
}
