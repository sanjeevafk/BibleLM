/**
 * lib/vector-store/IVectorStore.ts
 *
 * Public barrel that re-exports the `IVectorStore` contract and all
 * canonical types. Import from here, not from individual adapter files.
 *
 * @example
 *   import type { IVectorStore, VectorStoreResult } from '@/lib/vector-store';
 */

export type {
  IVectorStore,
  VectorStoreQuery,
  VectorStoreResult,
} from './types';
