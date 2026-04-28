/**
 * lib/vector-store/adapters/LocalBM25Adapter.ts
 *
 * Production adapter — wraps the existing BM25Engine behind the IVectorStore
 * interface. This is BibleLM's zero-cost, zero-dependency retrieval backend.
 *
 * Architecture notes
 * ──────────────────
 * • Loads only `bm25-state.json` on cold start (not the 50MB bible-full-index).
 * • Scores are min-max normalised to [0, 1] before being returned, so callers
 *   get a stable signal regardless of query length or IDF magnitude.
 * • The phrase-boost regex is confined to the Top-100 BM25 candidates (see
 *   bm25.ts), so this adapter is safe under high-concurrency Edge workloads.
 */

import { BM25Engine } from '../../retrieval/bm25';
import { RETRIEVAL_CONFIG } from '../../retrieval/types';
import type { IVectorStore, VectorStoreQuery, VectorStoreResult } from '../types';

export class LocalBM25Adapter implements IVectorStore {
  readonly name = 'LocalBM25Adapter';

  private engine: BM25Engine | null = null;
  private initPromise: Promise<void> | null = null;

  // ---------------------------------------------------------------------------
  // IVectorStore — lifecycle
  // ---------------------------------------------------------------------------

  isReady(): boolean {
    return this.engine !== null;
  }

  async init(): Promise<void> {
    // Idempotent — only runs once regardless of concurrent callers.
    if (this.engine) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._bootstrap();
    return this.initPromise;
  }

  // ---------------------------------------------------------------------------
  // IVectorStore — query
  // ---------------------------------------------------------------------------

  async query({ text, topK = 10 }: VectorStoreQuery): Promise<VectorStoreResult[]> {
    await this.init();
    const engine = this.engine!;

    const hits = engine.search(text, RETRIEVAL_CONFIG.bm25.candidateLimit);
    if (hits.length === 0) return [];

    // Min-max normalise raw BM25 scores → [0, 1]
    const maxScore = hits[0].score;
    const minScore = hits[hits.length - 1].score;
    const scoreDiff = maxScore - minScore;

    const results: VectorStoreResult[] = hits.slice(0, topK).map((hit, idx) => ({
      id: hit.doc.id,
      score: scoreDiff > 0 ? (hit.score - minScore) / scoreDiff : 1,
      text: hit.doc.text || undefined,
    }));

    return results;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async _bootstrap(): Promise<void> {
    try {
      // Cold-start optimised path: load only the pre-computed BM25 state.
      // bible-full-index.json (~50 MB) is deliberately NOT loaded here.
      const state = (await import('../../../data/bm25-state.json')).default;

      // Lean doc proxy: id → { text: '' }.
      // Phrase boost fires only when text is non-empty, so BM25 ranking still
      // works; phrase precision is skipped for these stubs, which is acceptable
      // for the cold path.
      const docProxy: Record<string, { text: string }> = {};
      for (const id of Object.keys((state as any).docLengths ?? {})) {
        docProxy[id] = { text: '' };
      }

      this.engine = BM25Engine.createFromState(state, docProxy, {
        k1: RETRIEVAL_CONFIG.bm25.k1,
        b: RETRIEVAL_CONFIG.bm25.b,
        phraseBoost: RETRIEVAL_CONFIG.bm25.phraseBoost,
      });

      console.log(`[${this.name}] Hydrated from pre-computed BM25 state (lean cold-start).`);
    } catch {
      console.warn(`[${this.name}] bm25-state.json not found; falling back to full in-memory index.`);

      try {
        const bibleIndexData = (await import('../../../data/bible-full-index.json')).default;
        const BIBLE_INDEX = bibleIndexData as Record<string, { text: string }>;

        this.engine = await BM25Engine.createFromIndex(BIBLE_INDEX, {
          k1: RETRIEVAL_CONFIG.bm25.k1,
          b: RETRIEVAL_CONFIG.bm25.b,
          phraseBoost: RETRIEVAL_CONFIG.bm25.phraseBoost,
        });

        console.log(`[${this.name}] Full in-memory BM25 index built as fallback.`);
      } catch (fallbackError) {
        console.error(`[${this.name}] Failed to load fallback index:`, fallbackError);
        throw new Error(`${this.name} initialization failed: no valid BM25 index available`);
      }
    }
  }
}
