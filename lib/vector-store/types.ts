/**
 * lib/vector-store/types.ts
 *
 * Core domain types for the vector store abstraction layer.
 * All adapters (LocalBM25, PgVector, Pinecone …) deal in these types.
 */

// ---------------------------------------------------------------------------
// Query / Result primitives
// ---------------------------------------------------------------------------

export interface VectorStoreQuery {
  /** Raw natural-language question. */
  text: string;
  /** 
   * Maximum number of ranked results to return.
   * Implementations should default to a reasonable limit (e.g., 10) when undefined.
   */
  topK?: number;
  /** Optional Bible translation hint (may be used for metadata filtering). */
  translation?: string;
}

export interface VectorStoreResult {
  /** Canonical verse identifier, e.g. "JHN 3:16". */
  id: string;
  /**
   * Normalised relevance score in [0, 1].
   * Higher is more relevant regardless of the underlying scoring method.
   */
  score: number;
  /** Optional snippet of the matched text (may be empty for lean indexes). */
  text?: string;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * IVectorStore — the single contract that every storage backend must satisfy.
 *
 * Conforming to this interface means the entire retrieval pipeline can be
 * upgraded from a local BM25 JSON index to PgVector, Pinecone, or any other
 * backend by swapping a single adapter — no business logic changes required.
 */
export interface IVectorStore {
  /**
   * Human-readable adapter name. Used in logs and diagnostics.
   * @example 'LocalBM25Adapter', 'PgVectorAdapter', 'PineconeAdapter'
   */
  readonly name: string;

  /**
   * Returns `true` when the adapter has been initialised and is ready to
   * serve queries. Callers should await `init()` if this returns `false`.
   */
  isReady(): boolean;

  /**
   * Initialise the adapter (load index, connect to DB, etc.).
   * Implementations must be idempotent — calling `init()` on an already-
   * initialised adapter must be a no-op.
   */
  init(): Promise<void>;

  /**
   * Retrieve the top-K most relevant results for `query`.
   * Always returns a stable, score-descending array.
   */
  query(query: VectorStoreQuery): Promise<VectorStoreResult[]>;
}
