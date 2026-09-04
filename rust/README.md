# BibleLM Rust workspace (Phase 1: offline build CLI)

Deviation from `local-docs/rust_port_plan.md`: the workspace lives in `rust/`
instead of repo root to keep Next.js file tracing and the repo root clean.
Crate names and phase structure follow the plan.

## Crates

- `biblelm-types` — canonical book codes, `VerseRef`, `StrongId`, TS-derived alias map
- `biblelm-index` — TS-parity tokenizer + BM25 inverted-index builder, binary format, TS-`exportState` JSON
- `biblelm-graph` — TSK cross-reference parser + CSR-style pruned adjacency, binary format
- `biblelm-build` — `biblelm-build` CLI: `bm25 | graph | strongs | all | verify`

## Binary formats (v1, little-endian)

- `bm25.bin` (`BLM1`): totalDocs, avgDocLength, doc-id table, doc lengths, sorted terms + postings
- `tsk-graph.bin` (`BLMG`): node table + pruned neighbor lists (top-20, weights rounded to 3dp like TS)
- `strongs.bin` (`BLMS`): id → transliteration + definition

## Usage (repo root)

```bash
cargo run --release --manifest-path rust/Cargo.toml -p biblelm-build -- all
cargo run --release --manifest-path rust/Cargo.toml -p biblelm-build -- verify
cargo test --manifest-path rust/Cargo.toml --workspace
```

`all` takes ~4s release (31k docs, 345k edges). `verify` differential-checks
Rust exports against TS-built `data/*.json` and fails on any mismatch.
