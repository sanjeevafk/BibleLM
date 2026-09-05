/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const init_panic_hook: () => void;
export const wasm_enrich_verse: (a: number, b: number) => [number, number, number];
export const wasm_fuse_rrf: (a: any, b: any, c: number) => [number, number, number];
export const wasm_graph_expand: (a: any, b: any, c: any) => [number, number, number];
export const wasm_init_bm25: (a: number, b: number) => [number, number, number];
export const wasm_init_graph: (a: number, b: number) => [number, number, number];
export const wasm_init_strongs: (a: number, b: number) => [number, number, number];
export const wasm_is_bm25_initialized: () => number;
export const wasm_is_graph_initialized: () => number;
export const wasm_is_strongs_initialized: () => number;
export const wasm_lookup_strongs: (a: number, b: number) => [number, number, number];
export const wasm_parse_greek_morph: (a: number, b: number) => [number, number, number];
export const wasm_parse_hebrew_morph: (a: number, b: number) => [number, number, number];
export const wasm_scrub_citations: (a: number, b: number, c: any) => [number, number, number, number];
export const wasm_search: (a: number, b: number, c: number) => [number, number, number];
export const wasm_set_bm25_texts: (a: any) => [number, number, number];
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
