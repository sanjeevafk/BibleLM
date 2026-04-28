/**
 * lib/vector-store/index.ts
 *
 * Module entry point — registers the active IVectorStore adapter.
 *
 * Switching from the LocalBM25Adapter to PgVector or Pinecone requires only
 * changing the line that sets `activeAdapter`. All retrieval logic is decoupled
 * from the storage backend through the IVectorStore contract.
 *
 * @example
 *   // Use the managed cloud adapter instead:
 *   import { PgVectorAdapter } from './adapters/PgVectorAdapter';
 *   export const vectorStore: IVectorStore = new PgVectorAdapter();
 */

export type { IVectorStore, VectorStoreQuery, VectorStoreResult } from './types';

export { LocalBM25Adapter } from './adapters/LocalBM25Adapter';
export { PgVectorAdapter } from './adapters/PgVectorAdapter';
export { PineconeAdapter } from './adapters/PineconeAdapter';

import type { IVectorStore } from './types';
import { LocalBM25Adapter } from './adapters/LocalBM25Adapter';

/**
 * The singleton vector store instance used across the retrieval pipeline.
 *
 * To migrate to an enterprise backend:
 *   1. Replace `LocalBM25Adapter` with `PgVectorAdapter` or `PineconeAdapter`.
 *   2. Add the required env vars to `config/env.ts`.
 *   3. Deploy — no other code changes needed.
 */
export const vectorStore: IVectorStore = new LocalBM25Adapter();
