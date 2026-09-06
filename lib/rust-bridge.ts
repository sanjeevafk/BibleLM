/**
 * BibleLM Rust WebAssembly Bridge
 *
 * Provides typed TypeScript bindings to high-performance Rust WebAssembly modules:
 * - BM25 lexical search (vectorized inverted index traversal)
 * - GraphRAG cross-reference BFS expansion (TSK adjacency traversal)
 * - Strong's concordance lookup & morphological parsing
 * - Linear-time scriptural citation sanitizer
 * - Reciprocal Rank Fusion (RRF)
 *
 * Includes transparent, resilient fallbacks to TypeScript implementations if
 * WebAssembly binary is unavailable or fails to initialize.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const nodeRequire = typeof __filename !== 'undefined' ? createRequire(__filename) : null;
import type { VerseContext } from './bible-fetch';
import type { VerseResult } from './retrieval/types';
import type { GraphRagResult } from './retrieval/graph-rag';
import { scrubInvalidCitations as tsScrubInvalidCitations } from '../app/api/chat/lib/citation-scrubber';
import { graphRagExpand as tsGraphRagExpand } from './retrieval/graph-rag';
import { getBM25Engine } from './retrieval/search';

export interface BiblelmWasmModule {
  init_panic_hook(): void;
  wasm_enrich_verse(ref_id: string): any;
  wasm_fuse_rrf(lexical_ids: any, semantic_ids: any, rrf_k: number): any;
  wasm_graph_expand(seed_ids: any, query_topics: any, opts: any): any;
  wasm_init_bm25(bytes: Uint8Array): boolean;
  wasm_init_graph(bytes: Uint8Array): boolean;
  wasm_init_strongs(bytes: Uint8Array): boolean;
  wasm_is_bm25_initialized(): boolean;
  wasm_is_graph_initialized(): boolean;
  wasm_is_strongs_initialized(): boolean;
  wasm_lookup_strongs(strongs_id: string): any;
  wasm_find_invalid_citations(content: string, allowed_refs: any): any;
  wasm_parse_greek_morph(code: string): any;
  wasm_parse_hebrew_morph(code: string): any;
  wasm_scrub_citations(content: string, allowed_refs: any): string;
  wasm_search(query: string, top_k: number): any;
  wasm_set_bm25_texts?(texts: string[]): boolean;
}

export function isRustEngineActive(): boolean {
  // Live env read (not the import-time `ENABLE_RUST_ENGINE` const) so tests
  // and operators can toggle without a restart.
  return process.env.ENABLE_RUST_ENGINE !== '0';
}

let wasmInstance: BiblelmWasmModule | null = null;
let initAttempted = false;
let initPromise: Promise<BiblelmWasmModule | null> | null = null;

function loadWasmPackage(pkgPath: string): BiblelmWasmModule {
  if (nodeRequire) {
    return nodeRequire(pkgPath);
  }
  return require(pkgPath);
}

function getSyncWasm(): BiblelmWasmModule | null {
  if (!isRustEngineActive()) return null;
  if (wasmInstance) return wasmInstance;
  try {
    const wasmPkgPath = path.resolve(process.cwd(), 'rust', 'pkg', 'biblelm_wasm.js');
    if (!fs.existsSync(wasmPkgPath)) return null;
    const wasm: BiblelmWasmModule = loadWasmPackage(wasmPkgPath);
    wasm.init_panic_hook();
    wasmInstance = wasm;
    return wasm;
  } catch {
    return null;
  }
}

/**
 * Initializes the Rust WebAssembly engine and hydrates pre-compiled binary indexes.
 */
export async function initRustEngine(): Promise<BiblelmWasmModule | null> {
  if (!isRustEngineActive()) return null;
  if (initAttempted) return wasmInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (!isRustEngineActive()) {
      return null;
    }

    try {
      const wasmPkgPath = path.resolve(process.cwd(), 'rust', 'pkg', 'biblelm_wasm.js');
      if (!fs.existsSync(wasmPkgPath)) {
        initPromise = null;
        return null;
      }

      initAttempted = true;
      const wasm: BiblelmWasmModule = loadWasmPackage(wasmPkgPath);
      wasm.init_panic_hook();

      // Hydrate BM25 binary index if present
      const bm25BinPath = path.resolve(process.cwd(), 'data', 'rust', 'bm25.bin');
      if (fs.existsSync(bm25BinPath)) {
        const bm25Bytes = fs.readFileSync(bm25BinPath);
        wasm.wasm_init_bm25(new Uint8Array(bm25Bytes));
      }

      // Hydrate BM25 verse texts for phrase boost parity if available.
      // TRADEOFF (deliberate, documented): this parses the full
      // `bible-full-index.json` (~11.6 MB) on cold start — the cost the
      // lean `bm25-state.json` path in `lib/retrieval/search.ts` was built
      // to avoid. It is kept because phrase-boost quality (exact-phrase
      // queries) was judged worth it, and `tests/unit/rust-lean-parity`
      // guards WASM-vs-lean-fallback agreement in CI. If cold starts
      // regress, the alternative is dropping this block (WASM then behaves
      // exactly like the lean fallback: no phrase boost) — see decision
      // log in docs/ARCHITECTURE_CHANGELOG.md.
      const bibleIndexPath = path.resolve(process.cwd(), 'data', 'bible-full-index.json');
      if (typeof wasm.wasm_set_bm25_texts === 'function' && fs.existsSync(bibleIndexPath)) {
        try {
          const raw = fs.readFileSync(bibleIndexPath, 'utf8');
          const bibleIndex: any = JSON.parse(raw);
          const texts = Object.values(bibleIndex).map((row: any) =>
            typeof row === 'string' ? row : (row.text ?? '')
          );
          wasm.wasm_set_bm25_texts(texts);
        } catch (err) {
          console.warn('[rust-bridge] wasm_set_bm25_texts hydration warning:', err);
        }
      }

      // Hydrate TSK graph binary index if present
      const graphBinPath = path.resolve(process.cwd(), 'data', 'rust', 'tsk-graph.bin');
      if (fs.existsSync(graphBinPath)) {
        const graphBytes = fs.readFileSync(graphBinPath);
        wasm.wasm_init_graph(new Uint8Array(graphBytes));
      }

      // Hydrate Strong's dictionary binary index if present
      const strongsBinPath = path.resolve(process.cwd(), 'data', 'rust', 'strongs.bin');
      if (fs.existsSync(strongsBinPath)) {
        const strongsBytes = fs.readFileSync(strongsBinPath);
        wasm.wasm_init_strongs(new Uint8Array(strongsBytes));
      }

      wasmInstance = wasm;
      return wasm;
    } catch (err) {
      initAttempted = true;
      console.warn('[rust-bridge] Failed to initialize Rust WASM engine, falling back to TypeScript:', err);
      wasmInstance = null;
      return null;
    }
  })();

  return initPromise;
}

/**
 * Returns whether the Rust WASM engine is loaded and operational.
 */
export function isRustEngineAvailable(): boolean {
  return wasmInstance !== null;
}

/**
 * Resets the WASM engine state for test isolation.
 */
export function resetRustEngineForTesting(): void {
  wasmInstance = null;
  initAttempted = false;
  initPromise = null;
}

/**
 * Performs BM25 search via Rust WebAssembly, with transparent fallback to TypeScript.
 */
export async function rustSearch(query: string, topK: number): Promise<VerseResult[]> {
  const wasm = await initRustEngine();
  if (wasm && wasm.wasm_is_bm25_initialized()) {
    try {
      const hits = wasm.wasm_search(query, topK);
      if (Array.isArray(hits)) {
        return hits.map((h: { verseId: string; score: number }) => ({
          verseId: h.verseId,
          score: Number(h.score),
        }));
      }
    } catch (err) {
      console.warn('[rust-bridge] wasm_search error, falling back to TS BM25:', err);
    }
  }

  const engine = await getBM25Engine();
  const hits = engine.search(query, topK);
  return hits.map((h) => ({
    verseId: h.doc.id,
    score: h.score,
  }));
}

/**
 * Performs GraphRAG BFS expansion via Rust WebAssembly, with transparent fallback to TypeScript.
 */
export async function rustGraphExpand(
  seedVerseIds: string[],
  queryTopics: Set<string>,
  opts?: {
    maxDepth?: number;
    maxExpansions?: number;
    maxNeighborsPerSeed?: number;
    edgeMinWeight?: number;
  }
): Promise<GraphRagResult> {
  const wasm = await initRustEngine();
  if (wasm && wasm.wasm_is_graph_initialized()) {
    try {
      const topicsArray = Array.from(queryTopics);
      const res = wasm.wasm_graph_expand(seedVerseIds, topicsArray, opts ?? {});
      if (res && Array.isArray(res.candidates)) {
        return res as GraphRagResult;
      }
    } catch (err) {
      console.warn('[rust-bridge] wasm_graph_expand error, falling back to TS GraphRAG:', err);
    }
  }

  return tsGraphRagExpand(seedVerseIds, queryTopics, opts);
}

/**
 * Sanitizes citations in generated text against allowed retrieved references.
 * Executes in linear-time Rust WASM with transparent fallback to TypeScript.
 */
export function rustScrubCitations(
  content: string,
  allowed: (string | VerseContext)[]
): string {
  const wasm = wasmInstance || getSyncWasm();
  if (wasm && isRustEngineActive()) {
    try {
      const allowedRefs = allowed.map((a) => (typeof a === 'string' ? a : a.reference));
      const scrubbed = wasm.wasm_scrub_citations(content, allowedRefs);
      // Restore the `citation_whitelist_enforced` telemetry the TypeScript
      // implementation emits (removed/allowed lists).
      try {
        const removed = wasm.wasm_find_invalid_citations(content, allowedRefs);
        if (Array.isArray(removed) && removed.length > 0) {
          console.info(JSON.stringify({
            event: 'citation_whitelist_enforced',
            removedCitations: removed,
            allowedCitations: allowedRefs,
          }));
        }
      } catch {
        // Telemetry is best-effort; scrubbing already succeeded.
      }
      return scrubbed;
    } catch (err) {
      console.warn('[rust-bridge] wasm_scrub_citations error, using TS fallback:', err);
    }
  }

  const verseContexts: VerseContext[] = allowed.map((a) =>
    typeof a === 'string'
      ? { reference: a, translation: 'BSB', text: '', original: [] }
      : a
  );
  return tsScrubInvalidCitations(content, verseContexts);
}

/**
 * Looks up a Strong's dictionary entry via Rust WASM.
 *
 * Shape mirrors `data/strongs-dict.json`: `{ id, transliteration, lexeme?,
 * pronunciation?, short_definition?, definition? }`. Note the source data
 * carries no long-form `definition`, so `definition` is usually absent —
 * prefer `short_definition`.
 */
export async function rustLookupStrongs(
  strongsId: string
): Promise<{ id: string; transliteration: string; lexeme?: string; definition?: string; pronunciation?: string; short_definition?: string } | null> {
  const wasm = await initRustEngine();
  if (wasm && wasm.wasm_is_strongs_initialized()) {
    try {
      const entry = wasm.wasm_lookup_strongs(strongsId);
      if (entry && entry.id) {
        return entry;
      }
    } catch (err) {
      console.warn('[rust-bridge] wasm_lookup_strongs error:', err);
    }
  }
  return null;
}

/**
 * Enriches a verse reference or Strong's ID via Rust WASM.
 */
export async function rustEnrichVerse(refId: string): Promise<any | null> {
  const wasm = await initRustEngine();
  if (wasm) {
    try {
      return wasm.wasm_enrich_verse(refId);
    } catch (err) {
      console.warn('[rust-bridge] wasm_enrich_verse error:', err);
    }
  }
  return null;
}

/**
 * Fuses lexical and semantic search results using Reciprocal Rank Fusion via Rust WASM.
 */
export function rustFuseRrf(
  lexicalIds: string[],
  semanticIds: string[],
  rrfK = 60
): Array<{ verseId: string; score: number }> {
  const wasm = wasmInstance || getSyncWasm();
  if (wasm && isRustEngineActive()) {
    try {
      const res = wasm.wasm_fuse_rrf(lexicalIds, semanticIds, rrfK);
      if (Array.isArray(res)) {
        return res;
      }
    } catch (err) {
      console.warn('[rust-bridge] wasm_fuse_rrf error:', err);
    }
  }

  const semanticRankMap = new Map<string, number>();
  semanticIds.forEach((id, idx) => semanticRankMap.set(id, idx + 1));
  const fused = lexicalIds.map((id, idx) => {
    const lexRank = idx + 1;
    const semRank = semanticRankMap.get(id);
    const score = (1 / (rrfK + lexRank)) + (semRank ? 1 / (rrfK + semRank) : 0);
    return { verseId: id, score };
  });
  return fused.sort((a, b) => b.score - a.score);
}
