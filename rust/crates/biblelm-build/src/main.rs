//! `biblelm-build` — offline data pre-compiler (Phase 1).
//!
//! Replaces the multi-minute TypeScript build scripts with a single fast
//! binary. Reads the same inputs, emits compact binary indexes plus
//! TS-compatible JSON exports for differential testing.
//!
//! Subcommands:
//! - `bm25`: `data/bible-full-index.json` → `bm25.bin` (+ `bm25.json` export)
//! - `graph`: `datasets/cross_references.txt` → `tsk-graph.bin` (+ adjacency JSON)
//! - `strongs`: `data/strongs-dict.json` → `strongs.bin`
//! - `all`: runs bm25 + graph + strongs with repo-relative defaults
//! - `verify`: compares Rust exports against TS-built `data/*.json`

use anyhow::{Context, Result};
use biblelm_graph::{parse_xref_line, TskGraph};
use biblelm_index::{Bm25Doc, Bm25Index, FullIndexRow, IndexStats};
use clap::{Args, Parser, Subcommand};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

mod eval;

#[derive(Parser)]
#[command(name = "biblelm-build", about = "BibleLM offline index pre-compiler")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Build binary BM25 index from bible-full-index.json
    Bm25(Bm25Args),
    /// Build binary TSK graph from cross_references.txt
    Graph(GraphArgs),
    /// Pack Strong's dictionary from strongs-dict.json
    Strongs(StrongsArgs),
    /// Run bm25 + graph + strongs with repo defaults
    All(AllArgs),
    /// Differential check: Rust exports vs TS-built data/*.json
    Verify(VerifyArgs),
    /// Side-by-side retrieval eval: Rust BM25 over scenarios.json
    Eval(EvalArgs),
    /// Live retrieval test: BM25 + GraphRAG + RRF
    Query(QueryArgs),
}

#[derive(Args)]
struct Bm25Args {
    #[arg(long, default_value = "data/bible-full-index.json")]
    index: PathBuf,
    #[arg(long, default_value = "data/rust/bm25.bin")]
    out: PathBuf,
    #[arg(long, default_value = "data/rust/bm25.json")]
    export_json: PathBuf,
}

#[derive(Args)]
struct GraphArgs {
    #[arg(long, default_value = "datasets/cross_references.txt")]
    xrefs: PathBuf,
    #[arg(long, default_value = "data/rust/tsk-graph.bin")]
    out: PathBuf,
    #[arg(long, default_value = "data/rust/tsk-adjacency.json")]
    export_json: PathBuf,
}

#[derive(Args)]
struct StrongsArgs {
    #[arg(long, default_value = "data/strongs-dict.json")]
    dict: PathBuf,
    #[arg(long, default_value = "data/rust/strongs.bin")]
    out: PathBuf,
}

#[derive(Args)]
struct AllArgs {
    #[arg(long, default_value = ".")]
    root: PathBuf,
}

#[derive(Args)]
struct VerifyArgs {
    #[arg(long, default_value = ".")]
    root: PathBuf,
    #[arg(long, default_value = "500")]
    sample_terms: usize,
}

#[derive(Args)]
struct EvalArgs {
    #[arg(long, default_value = ".")]
    root: PathBuf,
    #[arg(long, default_value = "data/rust/bm25.bin")]
    index: PathBuf,
    #[arg(long)]
    heldout_only: bool,
    #[arg(long)]
    out_refs: Option<PathBuf>,
    /// TS raw-BM25 reference ({scenarioId: [refs]}) for exact comparison
    #[arg(long)]
    compare_ts: Option<PathBuf>,
}

#[derive(Args)]
struct QueryArgs {
    /// Search query text (e.g. "faith without works" or "Melchizedek")
    query: String,
    #[arg(long, default_value = ".")]
    root: PathBuf,
    #[arg(long, default_value = "data/rust/bm25.bin")]
    bm25: PathBuf,
    #[arg(long, default_value = "data/rust/tsk-graph.bin")]
    graph: PathBuf,
    #[arg(long, default_value = "5")]
    top_k: usize,
}

fn repo_path(root: &Path, p: &str) -> PathBuf {
    root.join(p)
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    Ok(())
}

fn build_bm25(index_path: &Path, out: &Path, export_json: &Path) -> Result<IndexStats> {
    let raw = fs::read_to_string(index_path)
        .with_context(|| format!("reading {}", index_path.display()))?;
    // Preserve JSON file insertion order for deterministic doc numbering.
    // TS `Object.entries` follows file order, and postings/score-tie order
    // depends on it — a sorted map would diverge on exact-score ties.
    // (serde_json preserves order by default via its `preserve_order` feature.)
    let map: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&raw)
        .context("parsing bible-full-index.json (expected {id: {text, bm25Text?}})")?;
    let docs: Vec<Bm25Doc> = map
        .into_iter()
        .map(|(id, v)| {
            let row: FullIndexRow = serde_json::from_value(v)
                .with_context(|| format!("parsing row {id}"))?;
            Ok(Bm25Doc { id, text: row.index_text().to_string() })
        })
        .collect::<Result<Vec<_>>>()?;
    println!("indexing {} docs…", docs.len());
    let index = Bm25Index::build(&docs);
    let bytes = index.encode();
    ensure_parent(out)?;
    fs::write(out, &bytes).with_context(|| format!("writing {}", out.display()))?;
    ensure_parent(export_json)?;
    fs::write(export_json, serde_json::to_string(&index.export_state_json())?)?;

    let stats = IndexStats {
        total_docs: index.total_docs,
        avg_doc_length: index.avg_doc_length,
        unique_terms: index.terms.len(),
        total_postings: index.terms.iter().map(|t| t.postings.len() as u64).sum(),
        binary_bytes: bytes.len() as u64,
    };
    println!(
        "bm25: {} docs, {} terms, {:.2} MB binary → {}",
        stats.total_docs,
        stats.unique_terms,
        stats.binary_bytes as f64 / 1e6,
        out.display()
    );
    Ok(stats)
}

fn build_graph(xrefs_path: &Path, out: &Path, export_json: &Path) -> Result<(u64, usize)> {
    let raw = fs::read_to_string(xrefs_path)
        .with_context(|| format!("reading {}", xrefs_path.display()))?;
    let mut edges = Vec::new();
    let mut skipped = 0u64;
    for line in raw.split(['\n', '\r']) {
        if line.trim().is_empty() {
            continue;
        }
        match parse_xref_line(line) {
            Some(e) => edges.push(e),
            None => skipped += 1,
        }
    }
    println!("parsed {} edges ({} skipped/header)…", edges.len(), skipped);
    let owned: Vec<(String, String, f64)> = edges;
    let graph = TskGraph::build(&owned);
    let bytes = graph.encode();
    ensure_parent(out)?;
    fs::write(out, &bytes).with_context(|| format!("writing {}", out.display()))?;
    ensure_parent(export_json)?;
    fs::write(export_json, serde_json::to_string(&graph.export_adjacency_json())?)?;
    println!(
        "graph: {} raw edges → {} nodes, {} pruned edges, {:.2} MB binary → {}",
        graph.raw_edges,
        graph.adjacency.len(),
        graph.total_edges(),
        bytes.len() as f64 / 1e6,
        out.display()
    );
    Ok((graph.raw_edges, graph.total_edges()))
}

fn build_strongs(dict_path: &Path, out: &Path) -> Result<usize> {
    let raw = fs::read_to_string(dict_path)
        .with_context(|| format!("reading {}", dict_path.display()))?;
    let map: BTreeMap<String, serde_json::Value> = serde_json::from_str(&raw)
        .context("parsing strongs-dict.json (expected {H1|G1: {...}})")?;
    // Binary: magic "BLMS" | u32 version=1 | u64 n | per entry: u16 len+id,
    // u16 len+transliteration, u32 len+definition(json string, may be long).
    let mut buf = Vec::new();
    buf.extend_from_slice(b"BLMS");
    buf.extend_from_slice(&1u32.to_le_bytes());
    buf.extend_from_slice(&(map.len() as u64).to_le_bytes());
    for (id, entry) in &map {
        let translit = entry.get("transliteration").and_then(|v| v.as_str()).unwrap_or("");
        let def = entry.get("definition").and_then(|v| v.as_str()).unwrap_or("");
        push_str16(&mut buf, id);
        push_str16(&mut buf, translit);
        let db = def.as_bytes();
        buf.extend_from_slice(&(db.len() as u32).to_le_bytes());
        buf.extend_from_slice(db);
    }
    ensure_parent(out)?;
    fs::write(out, &buf).with_context(|| format!("writing {}", out.display()))?;
    println!("strongs: {} entries, {:.2} MB → {}", map.len(), buf.len() as f64 / 1e6, out.display());
    Ok(map.len())
}

fn push_str16(buf: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    assert!(b.len() <= u16::MAX as usize);
    buf.extend_from_slice(&(b.len() as u16).to_le_bytes());
    buf.extend_from_slice(b);
}

fn cmd_verify(root: &Path, sample_terms: usize) -> Result<()> {
    // -- BM25 ----------------------------------------------------------------
    let ts_state: serde_json::Value = serde_json::from_str(&fs::read_to_string(repo_path(
        root,
        "data/bm25-state.json",
    ))?)?;
    let rs_state: serde_json::Value = serde_json::from_str(&fs::read_to_string(repo_path(
        root,
        "data/rust/bm25.json",
    ))?)?;
    let ts_docs = ts_state["totalDocs"].as_u64().context("ts totalDocs")?;
    let rs_docs = rs_state["totalDocs"].as_u64().context("rs totalDocs")?;
    assert_eq!(ts_docs, rs_docs, "totalDocs mismatch");
    let ts_avg = ts_state["avgDocLength"].as_f64().context("ts avg")?;
    let rs_avg = rs_state["avgDocLength"].as_f64().context("rs avg")?;
    assert!(
        (ts_avg - rs_avg).abs() < 1e-9,
        "avgDocLength mismatch: ts={ts_avg} rs={rs_avg}"
    );
    let ts_df = ts_state["docFreqs"].as_object().context("ts docFreqs")?;
    let rs_df = rs_state["docFreqs"].as_object().context("rs docFreqs")?;
    assert_eq!(ts_df.len(), rs_df.len(), "unique term count mismatch");
    let mut checked = 0;
    let mut mismatches = 0;
    for (term, ts_count) in ts_df.iter().take(sample_terms) {
        checked += 1;
        match rs_df.get(term) {
            Some(rs_count) if rs_count == ts_count => {}
            other => {
                mismatches += 1;
                if mismatches <= 5 {
                    println!("  df mismatch {term:?}: ts={ts_count} rs={other:?}");
                }
            }
        }
    }
    // Full docLengths comparison (cheap, exact).
    let ts_dl = ts_state["docLengths"].as_object().context("ts docLengths")?;
    let rs_dl = rs_state["docLengths"].as_object().context("rs docLengths")?;
    assert_eq!(ts_dl.len(), rs_dl.len(), "docLengths size mismatch");
    for (id, ts_len) in ts_dl {
        assert_eq!(rs_dl.get(id), Some(ts_len), "docLength mismatch for {id}");
    }
    println!("bm25: totalDocs={ts_docs} avgDocLength={ts_avg:.4} terms={} sampled_df={checked} mismatches={mismatches}", ts_df.len());
    assert_eq!(mismatches, 0, "df mismatches found");

    // -- Graph (TSK edges only) ----------------------------------------------
    // TS graph-index.json merges TSK + topic + cluster edges then prunes to
    // top-20 per node ACROSS kinds (Phase 2 scope). So:
    // - pure-tsk nodes (TS list all tsk): exact set+weight equality, both directions.
    // - mixed nodes: weights must agree on the intersection; membership may
    //   differ due to cross-kind slot competition (resolved in Phase 2).
    let ts_graph: serde_json::Value = serde_json::from_str(&fs::read_to_string(repo_path(
        root,
        "data/graph-index.json",
    ))?)?;
    let rs_adj: serde_json::Value = serde_json::from_str(&fs::read_to_string(repo_path(
        root,
        "data/rust/tsk-adjacency.json",
    ))?)?;
    let ts_adj = ts_graph["adjacency"].as_object().context("ts adjacency")?;
    let rs_map = rs_adj.as_object().context("rs adjacency")?;
    let mut pure_nodes = 0;
    let mut pure_mismatch = 0;
    let mut mixed_nodes = 0;
    let mut weight_disagreement = 0;
    for (node, rs_list) in rs_map {
        let ts_list = ts_adj.get(node).context(format!("node {node} missing in TS graph"))?;
        let ts_arr = ts_list.as_array().context("ts neighbors array")?;
        let rs_arr = rs_list.as_array().context("rs neighbors array")?;
        let rs_by_id: std::collections::HashMap<&str, f64> = rs_arr
            .iter()
            .map(|n| (n["id"].as_str().unwrap_or(""), n["weight"].as_f64().unwrap_or(-1.0)))
            .collect();
        if ts_arr.iter().all(|n| n["kind"] == "tsk") {
            pure_nodes += 1;
            let ts_ids: Vec<(&str, f64)> = ts_arr
                .iter()
                .map(|n| (n["id"].as_str().unwrap_or(""), n["weight"].as_f64().unwrap_or(-1.0)))
                .collect();
            let rs_ids: Vec<(&str, f64)> = rs_arr
                .iter()
                .map(|n| (n["id"].as_str().unwrap_or(""), n["weight"].as_f64().unwrap_or(-1.0)))
                .collect();
            if ts_ids != rs_ids {
                pure_mismatch += 1;
                if pure_mismatch <= 5 {
                    println!("  pure-node mismatch {node}: ts={} rs={}", ts_ids.len(), rs_ids.len());
                }
            }
        } else {
            mixed_nodes += 1;
            for n in ts_arr.iter().filter(|n| n["kind"] == "tsk") {
                let id = n["id"].as_str().unwrap_or("");
                let ts_w = n["weight"].as_f64().unwrap_or(-1.0);
                if let Some(rs_w) = rs_by_id.get(id) {
                    if (ts_w - rs_w).abs() >= 1e-9 {
                        weight_disagreement += 1;
                        if weight_disagreement <= 5 {
                            println!("  weight disagreement {node} → {id}: ts={ts_w} rs={rs_w}");
                        }
                    }
                }
            }
        }
    }
    println!("graph: pure_tsk_nodes={pure_nodes} pure_mismatches={pure_mismatch} mixed_nodes={mixed_nodes} weight_disagreements={weight_disagreement}");
    assert_eq!(pure_mismatch, 0, "pure-TSK node mismatches found");
    assert_eq!(weight_disagreement, 0, "weight disagreements found");
    println!("verify: OK");
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Bm25(a) => {
            build_bm25(&a.index, &a.out, &a.export_json)?;
        }
        Command::Graph(a) => {
            build_graph(&a.xrefs, &a.out, &a.export_json)?;
        }
        Command::Strongs(a) => {
            build_strongs(&a.dict, &a.out)?;
        }
        Command::All(a) => {
            build_bm25(
                &repo_path(&a.root, "data/bible-full-index.json"),
                &repo_path(&a.root, "data/rust/bm25.bin"),
                &repo_path(&a.root, "data/rust/bm25.json"),
            )?;
            build_graph(
                &repo_path(&a.root, "datasets/cross_references.txt"),
                &repo_path(&a.root, "data/rust/tsk-graph.bin"),
                &repo_path(&a.root, "data/rust/tsk-adjacency.json"),
            )?;
            build_strongs(
                &repo_path(&a.root, "data/strongs-dict.json"),
                &repo_path(&a.root, "data/rust/strongs.bin"),
            )?;
        }
        Command::Verify(a) => {
            cmd_verify(&a.root, a.sample_terms)?;
        }
        Command::Eval(a) => {
            cmd_eval(&a)?;
        }
        Command::Query(a) => {
            cmd_query(&a)?;
        }
    }
    Ok(())
}

fn cmd_query(a: &QueryArgs) -> Result<()> {
    let root = &a.root;
    let bm25_path = repo_path(root, &a.bm25.to_string_lossy());
    let graph_path = repo_path(root, &a.graph.to_string_lossy());
    let full_index_path = repo_path(root, "data/bible-full-index.json");

    let bm25_bytes = fs::read(&bm25_path)
        .with_context(|| format!("reading BM25 index from {}", bm25_path.display()))?;
    let bm25_index = Bm25Index::decode(&bm25_bytes)?;

    let texts_by_id: std::collections::HashMap<String, String> = if full_index_path.exists() {
        let raw = fs::read_to_string(&full_index_path)?;
        let full: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&raw)?;
        full.into_iter()
            .map(|(id, v)| {
                let text = v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
                (id, text)
            })
            .collect()
    } else {
        std::collections::HashMap::new()
    };

    let texts: Vec<String> = bm25_index
        .doc_ids
        .iter()
        .map(|id| texts_by_id.get(id).cloned().unwrap_or_default())
        .collect();

    println!("Query: \"{}\"", a.query);
    println!("--------------------------------------------------");

    let start_bm25 = std::time::Instant::now();
    let bm25_hits = bm25_index.search(&a.query, &texts, a.top_k);
    let bm25_us = start_bm25.elapsed().as_micros();

    println!("BM25 Lexical Search (took {} µs):", bm25_us);
    for (rank, hit) in bm25_hits.iter().enumerate() {
        let verse_id = &bm25_index.doc_ids[hit.doc as usize];
        let snippet = texts_by_id.get(verse_id).map(|s| s.as_str()).unwrap_or("");
        println!("  #{}: {} (score: {:.4}) - \"{}\"", rank + 1, verse_id, hit.score, snippet);
    }

    if graph_path.exists() {
        let graph_bytes = fs::read(&graph_path)?;
        if let Ok(graph) = TskGraph::decode(&graph_bytes) {
            let seed_ids: Vec<&str> = bm25_hits
                .iter()
                .map(|h| bm25_index.doc_ids[h.doc as usize].as_str())
                .collect();
            let start_graph = std::time::Instant::now();
            let graph_res = graph.graph_rag_expand(
                &seed_ids,
                &std::collections::HashSet::new(),
                &biblelm_graph::GraphRagOptions::default(),
            );
            let graph_us = start_graph.elapsed().as_micros();

            println!("\nGraphRAG Expansion (took {} µs, depth {}):", graph_us, graph_res.diagnostics.traversal_depth_reached);
            for (rank, c) in graph_res.candidates.iter().take(a.top_k).enumerate() {
                let snippet = texts_by_id.get(&c.verse_id).map(|s| s.as_str()).unwrap_or("");
                println!("  +{}: {} (calibrated: {:.4}) - \"{}\"", rank + 1, c.verse_id, c.score, snippet);
            }

            // RRF fusion
            let bm25_ids: Vec<String> = bm25_hits
                .iter()
                .map(|h| bm25_index.doc_ids[h.doc as usize].clone())
                .collect();
            let graph_ids: Vec<String> = graph_res.candidates.iter().map(|c| c.verse_id.clone()).collect();
            let fused = biblelm_pipeline::fuse_lexical_semantic_rrf(&bm25_ids, &graph_ids, 60.0);

            println!("\nFused RRF Ranking (BM25 + GraphRAG):");
            for (rank, hit) in fused.iter().take(a.top_k).enumerate() {
                let snippet = texts_by_id.get(&hit.verse_id).map(|s| s.as_str()).unwrap_or("");
                println!("  #{}: {} (fused score: {:.6}) - \"{}\"", rank + 1, hit.verse_id, hit.score, snippet);
            }
        }
    }
    println!("--------------------------------------------------");
    Ok(())
}

fn cmd_eval(a: &EvalArgs) -> Result<()> {
    let root = &a.root;
    let index_bytes = fs::read(repo_path(root, &a.index.to_string_lossy()))
        .with_context(|| format!("reading {}", a.index.display()))?;
    let index = Bm25Index::decode(&index_bytes)?;
    let full: serde_json::Map<String, serde_json::Value> = serde_json::from_str(
        &fs::read_to_string(repo_path(root, "data/bible-full-index.json"))?,
    )?;
    let texts_by_id: std::collections::HashMap<String, String> = full
        .into_iter()
        .map(|(id, v)| {
            let text = v.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
            (id, text)
        })
        .collect();
    let mut scenarios = eval::load_scenarios(&repo_path(root, "tests/benchmark/fixtures/scenarios.json"))?;
    if a.heldout_only {
        // Held-out flags are positional in the FULL list — filter with indices.
        scenarios = scenarios
            .into_iter()
            .enumerate()
            .filter(|(i, s)| eval::is_heldout(*i, s))
            .map(|(_, s)| s)
            .collect();
        // Recompute positions for the subset so heldout_metrics covers it fully.
        // (run_eval flags by subset position; every subset member is held-out
        // by construction, so force inclusion via a second pass below.)
        let out = eval::run_eval(&index, &texts_by_id, &scenarios);
        println!("rust-bm25-heldout: {}", serde_json::to_string(&out.metrics)?);
        write_and_compare(&out, a)?;
        return Ok(());
    }
    let out = eval::run_eval(&index, &texts_by_id, &scenarios);
    println!("rust-bm25: {}", serde_json::to_string(&out.metrics)?);
    println!("rust-bm25-heldout: {}", serde_json::to_string(&out.heldout_metrics)?);
    write_and_compare(&out, a)?;
    Ok(())
}

fn write_and_compare(
    out: &eval::EvalOutput,
    a: &EvalArgs,
) -> Result<()> {
    if let Some(path) = &a.out_refs {
        ensure_parent(path)?;
        let refs: BTreeMap<&String, &Vec<String>> = out.top_refs.iter().collect();
        fs::write(path, serde_json::to_string_pretty(&refs)?)?;
        println!("wrote {}", path.display());
    }
    if let Some(ts_path) = &a.compare_ts {
        let ts_refs: BTreeMap<String, Vec<String>> =
            serde_json::from_str(&fs::read_to_string(ts_path)?)?;
        let mut diff_scenarios = 0;
        let mut shown = 0;
        for (id, rs_refs) in &out.top_refs {
            match ts_refs.get(id) {
                Some(ts) if ts == rs_refs => {}
                other => {
                    diff_scenarios += 1;
                    if shown < 5 {
                        println!("  diff {id}: ts={other:?} rs={rs_refs:?}");
                        shown += 1;
                    }
                }
            }
        }
        println!(
            "compare-ts: {} scenarios, {} with differing top-5",
            out.top_refs.len(),
            diff_scenarios
        );
        anyhow::ensure!(diff_scenarios == 0, "top-ref diffs vs TS engine found");
    }
    Ok(())
}
