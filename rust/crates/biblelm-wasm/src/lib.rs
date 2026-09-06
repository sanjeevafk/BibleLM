//! BibleLM WebAssembly bridge for Next.js and Node.js.
//!
//! Exposes:
//! - `wasm_init_bm25`, `wasm_is_bm25_initialized`, `wasm_search`
//! - `wasm_init_graph`, `wasm_is_graph_initialized`, `wasm_graph_expand`
//! - `wasm_init_strongs`, `wasm_is_strongs_initialized`, `wasm_lookup_strongs`
//! - `wasm_enrich_verse`
//! - `wasm_scrub_citations`
//! - `wasm_fuse_rrf`

use std::collections::HashSet;
use std::sync::RwLock;
use wasm_bindgen::prelude::*;

use biblelm_graph::{decode_graph_bytes, GraphIndex, GraphRagOptions};
use biblelm_index::Bm25Index;
use biblelm_morph::{HebrewMorphAnalysis, RobinsonMorphAnalysis, StrongsDictionary, StrongsEntry};
use biblelm_types::{normalize_book, VerseRef};

static BM25_ENGINE: RwLock<Option<Bm25Index>> = RwLock::new(None);
static BM25_TEXTS: RwLock<Vec<String>> = RwLock::new(Vec::new());
/// Full multi-source graph (BLMG v2). Legacy v1 TSK-only binaries are
/// upgraded in memory on load with `kind = "tsk"`.
static GRAPH_ENGINE: RwLock<Option<GraphIndex>> = RwLock::new(None);
static STRONGS_ENGINE: RwLock<Option<StrongsDictionary>> = RwLock::new(None);

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

// ---------------------------------------------------------------------------
// BM25 Lexical Search
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
pub struct WasmVerseResult {
    #[serde(rename = "verseId")]
    pub verse_id: String,
    pub score: f64,
}

#[wasm_bindgen]
pub fn wasm_init_bm25(bytes: &[u8]) -> Result<bool, JsValue> {
    let index = Bm25Index::decode(bytes).map_err(|e| JsValue::from_str(&format!("BM25 decode error: {e}")))?;
    let mut guard = BM25_ENGINE.write().map_err(|e| JsValue::from_str(&e.to_string()))?;
    *guard = Some(index);
    Ok(true)
}

#[wasm_bindgen]
pub fn wasm_is_bm25_initialized() -> bool {
    BM25_ENGINE.read().map(|g| g.is_some()).unwrap_or(false)
}

#[wasm_bindgen]
pub fn wasm_set_bm25_texts(texts_js: JsValue) -> Result<bool, JsValue> {
    let texts: Vec<String> = serde_wasm_bindgen::from_value(texts_js)
        .map_err(|e| JsValue::from_str(&format!("invalid texts: {e}")))?;
    let mut guard = BM25_TEXTS.write().map_err(|e| JsValue::from_str(&e.to_string()))?;
    *guard = texts;
    Ok(true)
}

#[wasm_bindgen]
pub fn wasm_search(query: &str, top_k: usize) -> Result<JsValue, JsValue> {
    let guard = BM25_ENGINE.read().map_err(|e| JsValue::from_str(&e.to_string()))?;
    let index = guard.as_ref().ok_or_else(|| JsValue::from_str("BM25 index not initialized in WASM"))?;

    let texts_guard = BM25_TEXTS.read().map_err(|e| JsValue::from_str(&e.to_string()))?;
    let hits = index.search(query, &texts_guard, top_k);

    let results: Vec<WasmVerseResult> = hits
        .into_iter()
        .map(|h| WasmVerseResult {
            verse_id: index.doc_ids[h.doc as usize].clone(),
            score: h.score,
        })
        .collect();

    serde_wasm_bindgen::to_value(&results).map_err(|e| JsValue::from_str(&e.to_string()))
}

// ---------------------------------------------------------------------------
// GraphRAG Cross-Reference Traversal
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WasmGraphOpts {
    pub max_depth: Option<usize>,
    pub max_expansions: Option<usize>,
    pub max_neighbors_per_seed: Option<usize>,
    pub edge_min_weight: Option<f64>,
}

#[wasm_bindgen]
pub fn wasm_init_graph(bytes: &[u8]) -> Result<bool, JsValue> {
    let (graph, _) = decode_graph_bytes(bytes)
        .map_err(|e| JsValue::from_str(&format!("Graph decode error: {e}")))?;
    let mut guard = GRAPH_ENGINE.write().map_err(|e| JsValue::from_str(&e.to_string()))?;
    *guard = Some(graph);
    Ok(true)
}

#[wasm_bindgen]
pub fn wasm_is_graph_initialized() -> bool {
    GRAPH_ENGINE.read().map(|g| g.is_some()).unwrap_or(false)
}

#[wasm_bindgen]
pub fn wasm_graph_expand(
    seed_ids: JsValue,
    query_topics: JsValue,
    opts: JsValue,
) -> Result<JsValue, JsValue> {
    let guard = GRAPH_ENGINE.read().map_err(|e| JsValue::from_str(&e.to_string()))?;
    let graph = guard.as_ref().ok_or_else(|| JsValue::from_str("Graph index not initialized in WASM"))?;

    let seeds: Vec<String> = serde_wasm_bindgen::from_value(seed_ids)
        .map_err(|e| JsValue::from_str(&format!("invalid seed_ids: {e}")))?;
    let seed_refs: Vec<&str> = seeds.iter().map(|s| s.as_str()).collect();

    let topics_vec: Vec<String> = if query_topics.is_null() || query_topics.is_undefined() {
        Vec::new()
    } else {
        serde_wasm_bindgen::from_value(query_topics).unwrap_or_default()
    };
    let topics_set: HashSet<&str> = topics_vec.iter().map(|s| s.as_str()).collect();

    let parsed_opts: WasmGraphOpts = if opts.is_null() || opts.is_undefined() {
        WasmGraphOpts::default()
    } else {
        serde_wasm_bindgen::from_value(opts).unwrap_or_default()
    };

    let mut graph_opts = GraphRagOptions::default();
    if let Some(d) = parsed_opts.max_depth {
        graph_opts.max_depth = d;
    }
    if let Some(e) = parsed_opts.max_expansions {
        graph_opts.max_expansions = e;
    }
    if let Some(n) = parsed_opts.max_neighbors_per_seed {
        graph_opts.max_neighbors_per_seed = n;
    }
    if let Some(w) = parsed_opts.edge_min_weight {
        graph_opts.edge_min_weight = w;
    }

    let result = graph.graph_rag_expand(&seed_refs, &topics_set, &graph_opts);
    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

// ---------------------------------------------------------------------------
// Strong's Dictionary & Morphological Enrichment
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn wasm_init_strongs(bytes: &[u8]) -> Result<bool, JsValue> {
    let dict = StrongsDictionary::decode_binary(bytes)
        .map_err(|e| JsValue::from_str(&format!("Strongs decode error: {e}")))?;
    let mut guard = STRONGS_ENGINE.write().map_err(|e| JsValue::from_str(&e.to_string()))?;
    *guard = Some(dict);
    Ok(true)
}

#[wasm_bindgen]
pub fn wasm_is_strongs_initialized() -> bool {
    STRONGS_ENGINE.read().map(|g| g.is_some()).unwrap_or(false)
}

#[wasm_bindgen]
pub fn wasm_lookup_strongs(strongs_id: &str) -> Result<JsValue, JsValue> {
    let guard = STRONGS_ENGINE.read().map_err(|e| JsValue::from_str(&e.to_string()))?;
    let dict = guard.as_ref().ok_or_else(|| JsValue::from_str("Strongs dictionary not initialized in WASM"))?;
    if let Some(entry) = dict.lookup(strongs_id) {
        serde_wasm_bindgen::to_value(entry).map_err(|e| JsValue::from_str(&e.to_string()))
    } else {
        Ok(JsValue::NULL)
    }
}

fn parse_flexible_ref(s: &str) -> Option<VerseRef> {
    if let Ok(vref) = s.parse::<VerseRef>() {
        return Some(vref);
    }
    let (book_part, rest) = s.split_once(' ')?;
    let (ch_part, v_part) = rest.split_once(':')?;
    let book = normalize_book(book_part.trim())?;
    let chapter: u32 = ch_part.trim().parse().ok()?;
    let verse: u32 = v_part.trim().parse().ok()?;
    if chapter == 0 || verse == 0 {
        return None;
    }
    Some(VerseRef { book, chapter, verse })
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasmVerseEnrichment {
    pub reference: String,
    pub book: String,
    pub book_name: String,
    pub chapter: u32,
    pub verse: u32,
    pub is_ot: bool,
    pub is_nt: bool,
    pub strongs: Option<StrongsEntry>,
}

#[wasm_bindgen]
pub fn wasm_enrich_verse(ref_id: &str) -> Result<JsValue, JsValue> {
    let trimmed = ref_id.trim();
    // Check if ref_id is a Strong's number directly (e.g. H7225, G3056)
    if (trimmed.starts_with('H') || trimmed.starts_with('h') || trimmed.starts_with('G') || trimmed.starts_with('g'))
        && trimmed.len() >= 2
        && trimmed[1..].chars().all(|c| c.is_ascii_digit())
    {
        return wasm_lookup_strongs(trimmed);
    }

    if let Some(vref) = parse_flexible_ref(trimmed) {
        let info = WasmVerseEnrichment {
            reference: vref.to_string(),
            book: vref.book.code().to_string(),
            book_name: vref.book.name().to_string(),
            chapter: vref.chapter,
            verse: vref.verse,
            is_ot: vref.book.is_old_testament(),
            is_nt: !vref.book.is_old_testament(),
            strongs: None,
        };
        serde_wasm_bindgen::to_value(&info).map_err(|e| JsValue::from_str(&e.to_string()))
    } else {
        Err(JsValue::from_str(&format!("unable to parse verse reference: {ref_id}")))
    }
}

#[wasm_bindgen]
pub fn wasm_parse_hebrew_morph(code: &str) -> Result<JsValue, JsValue> {
    // EXPERIMENTAL subset parser (see biblelm-morph docs): best-effort output.
    #[derive(serde::Serialize)]
    struct HebrewMorphDto {
        language: &'static str,
        prefixes: Vec<&'static str>,
        pos: &'static str,
        stem: Option<&'static str>,
        aspect: Option<&'static str>,
        raw_code: String,
    }

    let parsed = HebrewMorphAnalysis::parse(code);
    let dto = HebrewMorphDto {
        language: parsed.language,
        prefixes: parsed.prefixes,
        pos: parsed.pos,
        stem: parsed.stem,
        aspect: parsed.aspect,
        raw_code: parsed.raw_code,
    };
    serde_wasm_bindgen::to_value(&dto).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn wasm_parse_greek_morph(code: &str) -> Result<JsValue, JsValue> {
    // EXPERIMENTAL subset parser (see biblelm-morph docs): best-effort output.
    #[derive(serde::Serialize)]
    struct GreekMorphDto {
        pos: &'static str,
        tense: Option<&'static str>,
        voice: Option<&'static str>,
        mood: Option<&'static str>,
        case: Option<&'static str>,
        number: Option<&'static str>,
        gender: Option<&'static str>,
        person: Option<&'static str>,
        raw_code: String,
    }

    let parsed = RobinsonMorphAnalysis::parse(code);
    let dto = GreekMorphDto {
        pos: parsed.pos,
        tense: parsed.tense,
        voice: parsed.voice,
        mood: parsed.mood,
        case: parsed.case,
        number: parsed.number,
        gender: parsed.gender,
        person: parsed.person,
        raw_code: parsed.raw_code,
    };
    serde_wasm_bindgen::to_value(&dto).map_err(|e| JsValue::from_str(&e.to_string()))
}

// ---------------------------------------------------------------------------
// Citation Scrubber
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn wasm_scrub_citations(content: &str, allowed_refs: JsValue) -> Result<String, JsValue> {
    let mut ref_strings: Vec<String> = Vec::new();

    if let Ok(strings) = serde_wasm_bindgen::from_value::<Vec<String>>(allowed_refs.clone()) {
        ref_strings = strings;
    } else if let Ok(objects) = serde_wasm_bindgen::from_value::<Vec<serde_json::Value>>(allowed_refs) {
        for obj in objects {
            if let Some(s) = obj.as_str() {
                ref_strings.push(s.to_string());
            } else if let Some(r) = obj.get("reference").and_then(|v| v.as_str()) {
                ref_strings.push(r.to_string());
            }
        }
    }

    let slice: Vec<&str> = ref_strings.iter().map(|s| s.as_str()).collect();
    Ok(biblelm_pipeline::scrub_invalid_citations(content, &slice))
}

/// Returns the invalid citations that `wasm_scrub_citations` would remove
/// (deduplicated). Lets hosts emit whitelist-enforcement telemetry that
/// matches the TypeScript scrubber's `citation_whitelist_enforced` event.
#[wasm_bindgen]
pub fn wasm_find_invalid_citations(content: &str, allowed_refs: JsValue) -> Result<JsValue, JsValue> {
    let mut ref_strings: Vec<String> = Vec::new();

    if let Ok(strings) = serde_wasm_bindgen::from_value::<Vec<String>>(allowed_refs.clone()) {
        ref_strings = strings;
    } else if let Ok(objects) = serde_wasm_bindgen::from_value::<Vec<serde_json::Value>>(allowed_refs) {
        for obj in objects {
            if let Some(s) = obj.as_str() {
                ref_strings.push(s.to_string());
            } else if let Some(r) = obj.get("reference").and_then(|v| v.as_str()) {
                ref_strings.push(r.to_string());
            }
        }
    }

    let slice: Vec<&str> = ref_strings.iter().map(|s| s.as_str()).collect();
    let invalid = biblelm_pipeline::find_invalid_citations(content, &slice);
    serde_wasm_bindgen::to_value(&invalid).map_err(|e| JsValue::from_str(&e.to_string()))
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (RRF)
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn wasm_fuse_rrf(
    lexical_ids: JsValue,
    semantic_ids: JsValue,
    rrf_k: f64,
) -> Result<JsValue, JsValue> {
    let lex: Vec<String> = serde_wasm_bindgen::from_value(lexical_ids)
        .map_err(|e| JsValue::from_str(&format!("invalid lexical_ids: {e}")))?;
    let sem: Vec<String> = serde_wasm_bindgen::from_value(semantic_ids)
        .map_err(|e| JsValue::from_str(&format!("invalid semantic_ids: {e}")))?;

    let fused = biblelm_pipeline::fuse_lexical_semantic_rrf(&lex, &sem, rrf_k);
    serde_wasm_bindgen::to_value(&fused).map_err(|e| JsValue::from_str(&e.to_string()))
}
