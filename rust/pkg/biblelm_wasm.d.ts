/* tslint:disable */
/* eslint-disable */

export function init_panic_hook(): void;

export function wasm_enrich_verse(ref_id: string): any;

export function wasm_fuse_rrf(lexical_ids: any, semantic_ids: any, rrf_k: number): any;

export function wasm_graph_expand(seed_ids: any, query_topics: any, opts: any): any;

export function wasm_init_bm25(bytes: Uint8Array): boolean;

export function wasm_init_graph(bytes: Uint8Array): boolean;

export function wasm_init_strongs(bytes: Uint8Array): boolean;

export function wasm_is_bm25_initialized(): boolean;

export function wasm_is_graph_initialized(): boolean;

export function wasm_is_strongs_initialized(): boolean;

export function wasm_lookup_strongs(strongs_id: string): any;

export function wasm_parse_greek_morph(code: string): any;

export function wasm_parse_hebrew_morph(code: string): any;

export function wasm_scrub_citations(content: string, allowed_refs: any): string;

export function wasm_search(query: string, top_k: number): any;

export function wasm_set_bm25_texts(texts_js: any): boolean;
