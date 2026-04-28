/**
 * tests/unit/IVectorStore.test.ts
 *
 * Unit tests for the IVectorStore abstraction layer.
 *
 * We test via the LocalBM25Adapter (the live implementation), which lets us
 * verify:
 *  1. The adapter satisfies the IVectorStore contract.
 *  2. init() is idempotent.
 *  3. query() returns stable, normalised [0,1] scores in descending order.
 *  4. The PgVectorAdapter and PineconeAdapter stubs expose the correct shape.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IVectorStore } from '../../lib/vector-store/types';
import { PgVectorAdapter } from '../../lib/vector-store/adapters/PgVectorAdapter';
import { PineconeAdapter } from '../../lib/vector-store/adapters/PineconeAdapter';

// ---------------------------------------------------------------------------
// Minimal LocalBM25Adapter test double
// (we mock the data imports to avoid pulling 50 MB of JSON into unit tests)
// ---------------------------------------------------------------------------

vi.mock('../../data/bm25-state.json', () => ({
  default: {
    totalDocs: 3,
    avgDocLength: 8,
    docFreqs: { god: 2, loved: 1, world: 2, shepherd: 1 },
    termFreqs: {
      god:      { 'JHN 3:16': 1, 'ROM 8:28': 1 },
      loved:    { 'JHN 3:16': 1 },
      world:    { 'JHN 3:16': 1, 'ROM 8:28': 1 },
      shepherd: { 'PSA 23:1': 1 },
    },
    docLengths: { 'JHN 3:16': 10, 'ROM 8:28': 15, 'PSA 23:1': 6 },
  },
}));

vi.mock('../../data/bible-full-index.json', () => ({
  default: {},
}));

// Now import after mocks are registered
const { LocalBM25Adapter } = await import('../../lib/vector-store/adapters/LocalBM25Adapter');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isIVectorStore(obj: unknown): obj is IVectorStore {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'name' in obj &&
    typeof (obj as any).isReady === 'function' &&
    typeof (obj as any).init === 'function' &&
    typeof (obj as any).query === 'function'
  );
}

// ---------------------------------------------------------------------------
// LocalBM25Adapter tests
// ---------------------------------------------------------------------------

describe('LocalBM25Adapter', () => {
  let adapter: InstanceType<typeof LocalBM25Adapter>;

  beforeEach(() => {
    adapter = new LocalBM25Adapter();
  });

  it('satisfies the IVectorStore contract', () => {
    expect(isIVectorStore(adapter)).toBe(true);
  });

  it('has the correct adapter name', () => {
    expect(adapter.name).toBe('LocalBM25Adapter');
  });

  it('is not ready before init()', () => {
    expect(adapter.isReady()).toBe(false);
  });

  it('is ready after init()', async () => {
    await adapter.init();
    expect(adapter.isReady()).toBe(true);
  });

  it('init() is idempotent (safe to call multiple times)', async () => {
    await adapter.init();
    await adapter.init(); // second call — must not throw or reset state
    expect(adapter.isReady()).toBe(true);
  });

  it('concurrent init() calls resolve correctly', async () => {
    await Promise.all([adapter.init(), adapter.init(), adapter.init()]);
    expect(adapter.isReady()).toBe(true);
  });

  it('query() returns results in descending score order', async () => {
    await adapter.init();
    const results = await adapter.query({ text: 'God world', topK: 10 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('query() returns scores in [0, 1]', async () => {
    await adapter.init();
    const results = await adapter.query({ text: 'shepherd', topK: 10 });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('query() respects the topK parameter', async () => {
    await adapter.init();
    const results = await adapter.query({ text: 'God', topK: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('query() returns an empty array for a no-match query', async () => {
    await adapter.init();
    const results = await adapter.query({ text: 'zzznomatch999', topK: 10 });
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stub adapter contract tests (PgVector & Pinecone)
// ---------------------------------------------------------------------------

describe('PgVectorAdapter stub', () => {
  it('satisfies the IVectorStore contract', () => {
    expect(isIVectorStore(new PgVectorAdapter())).toBe(true);
  });

  it('has the correct adapter name', () => {
    expect(new PgVectorAdapter().name).toBe('PgVectorAdapter');
  });

  it('init() resolves without throwing', async () => {
    const adapter = new PgVectorAdapter();
    await expect(adapter.init()).resolves.toBeUndefined();
  });

  it('query() resolves to an empty array (stub behaviour)', async () => {
    const adapter = new PgVectorAdapter();
    const results = await adapter.query({ text: 'God' });
    expect(results).toEqual([]);
  });
});

describe('PineconeAdapter stub', () => {
  it('satisfies the IVectorStore contract', () => {
    expect(isIVectorStore(new PineconeAdapter())).toBe(true);
  });

  it('has the correct adapter name', () => {
    expect(new PineconeAdapter().name).toBe('PineconeAdapter');
  });

  it('init() resolves without throwing', async () => {
    const adapter = new PineconeAdapter();
    await expect(adapter.init()).resolves.toBeUndefined();
  });

  it('query() resolves to an empty array (stub behaviour)', async () => {
    const adapter = new PineconeAdapter();
    const results = await adapter.query({ text: 'shepherd' });
    expect(results).toEqual([]);
  });
});
