//! TSK cross-reference graph builder with TypeScript parity.
//!
//! Mirrors `scripts/build-graph-index.ts` §1 (TSK edges only):
//! - Parse `datasets/cross_references.txt` (tab-separated `From / To / Votes`,
//!   refs like `Gen.1.1`, ranges truncated to their start via `-` split).
//! - Ref normalization: `Gen.1.1` and `DEUT 22:21` forms → `GEN 1:1`.
//! - Weight: `clamp(votes / 150, 0.2, 0.95)`; bidirectional; keep max on dup;
//!   skip self-loops; prune to top-20 neighbors by weight desc; round to 3dp.
//!
//! Topic/cluster edges (§2–§4 of the TS script) are intentionally out of
//! scope for Phase 1 — they derive from TS-built `data/*.json` and will be
//! merged in Phase 2.

use biblelm_types::{normalize_book, VerseRef};
use std::collections::{BTreeMap, HashMap};

/// Max neighbors retained per node (TS §5).
pub const MAX_NEIGHBORS: usize = 20;

/// Mirrors TS `normalizeVerseId`.
pub fn normalize_verse_id(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    // Gen.1.1 form
    if let Some(ref_id) = parse_dot_form(trimmed) {
        return Some(ref_id);
    }
    // DEUT 22:21 form
    if let Some(ref_id) = parse_space_form(trimmed) {
        return Some(ref_id);
    }
    None
}

fn parse_dot_form(s: &str) -> Option<String> {
    let mut parts = s.split('.');
    let book_raw = parts.next()?;
    let ch: u32 = parts.next()?.parse().ok()?;
    let v: u32 = parts.next()?.parse().ok()?;
    if parts.next().is_some() || ch == 0 || v == 0 {
        return None;
    }
    // TS regex: /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/ — book part is
    // optional leading 1-3 + ASCII letters only.
    if !book_raw.chars().all(|c| c.is_ascii_alphabetic()) || book_raw.is_empty() {
        // Allow leading 1-3 (e.g. "1John" won't appear dotted, but be lenient
        // exactly like the TS character class, not more).
        let ok = book_raw.len() > 1
            && matches!(book_raw.chars().next(), Some('1' | '2' | '3'))
            && book_raw[1..].chars().all(|c| c.is_ascii_alphabetic());
        if !ok {
            return None;
        }
    }
    let book = normalize_book(book_raw)?;
    Some(VerseRef { book, chapter: ch, verse: v }.id())
}

fn parse_space_form(s: &str) -> Option<String> {
    // TS regex: /^([1-3]?[A-Za-z]+)\s+(\d+):(\d+)$/
    let (book_raw, rest) = s.split_once(char::is_whitespace)?;
    if rest.trim_start() != rest.trim_start_matches(char::is_whitespace) {
        // \s+ allows multiple spaces — split_once handles the first; ensure
        // the remainder starts with digits after trimming.
    }
    let rest = rest.trim_start();
    let (ch_raw, v_raw) = rest.split_once(':')?;
    if !book_raw.chars().all(|c| c.is_ascii_alphabetic())
        && !(book_raw.len() > 1
            && matches!(book_raw.chars().next(), Some('1' | '2' | '3'))
            && book_raw[1..].chars().all(|c| c.is_ascii_alphabetic()))
    {
        return None;
    }
    if book_raw.is_empty() {
        return None;
    }
    let book = normalize_book(book_raw)?;
    let ch: u32 = ch_raw.parse().ok()?;
    let v: u32 = v_raw.parse().ok()?;
    if ch == 0 || v == 0 || v_raw.chars().any(|c| !c.is_ascii_digit()) {
        return None;
    }
    Some(VerseRef { book, chapter: ch, verse: v }.id())
}

/// Mirrors TS `Number.parseInt(s, 10)`: skip leading whitespace, optional
/// sign, then take the longest ASCII-digit prefix. Returns `None` when
/// there are no digits (TS yields `NaN`, which callers map to a default).
/// NOTE: a plain `str::parse::<f64>()` is NOT equivalent (`"3.9"` → TS
/// gives 3, float parse gives 3.9; `"60abc"` → TS gives 60, float parse
/// fails).
pub fn ts_parse_int(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let (neg, rest) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let digits: Vec<u8> = rest.bytes().take_while(u8::is_ascii_digit).collect();
    if digits.is_empty() {
        return None;
    }
    let mut v: i64 = 0;
    for d in digits {
        v = v
            .saturating_mul(10)
            .saturating_add((d - b'0') as i64);
    }
    Some(if neg { -v } else { v })
}

/// Mirrors TS vote→weight: `min(0.95, max(0.2, (NaN ? 50 : parseInt(votes)) / 150))`.
/// Missing/blank/malformed vote fields default to 50, exactly like TS
/// (`parts.length >= 3 ? parseInt(parts[2], 10) : 50` + the `NaN ? 50` guard).
pub fn vote_weight(votes_raw: &str) -> f64 {
    let votes = ts_parse_int(votes_raw).map(|v| v as f64).unwrap_or(50.0);
    (votes / 150.0).clamp(0.2, 0.95)
}

/// Round like TS `Math.round(x * 1000) / 1000` (inputs non-negative).
pub fn round3(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Built adjacency: node → sorted (weight desc) pruned neighbor list.
#[derive(Debug, Default)]
pub struct TskGraph {
    /// node id → Vec<(neighbor id, weight)> sorted desc, len ≤ 20.
    pub adjacency: BTreeMap<String, Vec<(String, f64)>>,
    pub raw_edges: u64,
}

impl TskGraph {
    /// Builds from parsed `(from_id, to_id, weight)` edges.
    /// Mirrors TS `addEdge` (skip self-loops, keep max) + §5 pruning.
    ///
    /// Tie behavior matches TS exactly: neighbors keep first-seen (file)
    /// order and the sort is stable, so equal weights retain file order
    /// just like TS `Array.sort`. Do NOT add a tie-breaker.
    pub fn build(edges: &[(String, String, f64)]) -> Self {
        // node → neighbors in first-seen order (TS Map insertion order).
        let mut adj: HashMap<&str, Vec<(&str, f64)>> = HashMap::new();
        let mut raw_edges = 0u64;
        for (from, to, weight) in edges {
            if from == to {
                continue;
            }
            raw_edges += 1;
            for (a, b) in [(from.as_str(), to.as_str()), (to.as_str(), from.as_str())] {
                let list = adj.entry(a).or_default();
                match list.iter_mut().find(|(id, _)| *id == b) {
                    Some(slot) if *weight > slot.1 => slot.1 = *weight,
                    Some(_) => {}
                    None => list.push((b, *weight)),
                }
            }
        }
        let mut adjacency = BTreeMap::new();
        for (node, neighbors) in adj {
            // Round BEFORE sorting, exactly like TS (`neighborsList` maps
            // `Math.round(w * 1000) / 1000` first, then stable-sorts desc).
            // Sorting raw weights first would order pairs that round equal
            // by their unrounded values instead of keeping file order.
            let mut rounded: Vec<(String, f64)> = neighbors
                .into_iter()
                .map(|(id, w)| (id.to_string(), round3(w)))
                .collect();
            // Stable sort, weight desc only — ties keep file order like TS.
            rounded.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
            let list: Vec<(String, f64)> = rounded.into_iter().take(MAX_NEIGHBORS).collect();
            adjacency.insert(node.to_string(), list);
        }
        TskGraph { adjacency, raw_edges }
    }

    pub fn total_edges(&self) -> usize {
        self.adjacency.values().map(|v| v.len()).sum()
    }

    // -- Binary format (v1, little-endian) ---------------------------------
    //
    // magic "BLMG" | u32 version=1 | u64 raw_edges
    // u64 nnodes | per node: u16 len + id bytes,
    //   u64 nneighbors | per neighbor: u32 node_idx, f64 weight

    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"BLMG");
        buf.extend_from_slice(&1u32.to_le_bytes());
        buf.extend_from_slice(&self.raw_edges.to_le_bytes());
        let nodes: Vec<&String> = self.adjacency.keys().collect();
        let index: HashMap<&str, u32> = nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.as_str(), i as u32))
            .collect();
        buf.extend_from_slice(&(nodes.len() as u64).to_le_bytes());
        for node in &nodes {
            push_str(&mut buf, node);
            let neighbors = &self.adjacency[*node];
            buf.extend_from_slice(&(neighbors.len() as u64).to_le_bytes());
            for (id, w) in neighbors {
                buf.extend_from_slice(&index[id.as_str()].to_le_bytes());
                buf.extend_from_slice(&w.to_le_bytes());
            }
        }
        buf
    }

    pub fn decode(bytes: &[u8]) -> anyhow::Result<Self> {
        if bytes.len() < 24 {
            anyhow::bail!("truncated header: expected at least 24 bytes, got {}", bytes.len());
        }
        if &bytes[0..4] != b"BLMG" {
            anyhow::bail!("invalid magic: expected BLMG");
        }
        let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        if version != 1 {
            anyhow::bail!("unsupported version: {version}");
        }
        let raw_edges = u64::from_le_bytes(bytes[8..16].try_into().unwrap());
        let nnodes = u64::from_le_bytes(bytes[16..24].try_into().unwrap()) as usize;

        let mut offset = 24;
        let mut node_names = Vec::with_capacity(nnodes);
        let mut neighbor_meta = Vec::with_capacity(nnodes);

        for _ in 0..nnodes {
            if offset + 2 > bytes.len() {
                anyhow::bail!("unexpected EOF reading node name len");
            }
            let slen = u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap()) as usize;
            offset += 2;
            if offset + slen > bytes.len() {
                anyhow::bail!("unexpected EOF reading node name");
            }
            let name = std::str::from_utf8(&bytes[offset..offset + slen])
                .map_err(|e| anyhow::anyhow!("invalid utf8: {e}"))?
                .to_string();
            offset += slen;

            if offset + 8 > bytes.len() {
                anyhow::bail!("unexpected EOF reading neighbor count");
            }
            let nneighbors = u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap()) as usize;
            offset += 8;

            let n_bytes = nneighbors
                .checked_mul(12)
                .ok_or_else(|| anyhow::anyhow!("overflow calculating neighbor bytes"))?;
            if offset + n_bytes > bytes.len() {
                anyhow::bail!("unexpected EOF reading neighbor records");
            }
            neighbor_meta.push((offset, nneighbors));
            offset += n_bytes;
            node_names.push(name);
        }

        let mut adjacency = BTreeMap::new();
        for (i, name) in node_names.iter().enumerate() {
            let (n_start, n_count) = neighbor_meta[i];
            let mut neighbors = Vec::with_capacity(n_count);
            let mut n_off = n_start;
            for _ in 0..n_count {
                let target_idx = u32::from_le_bytes(bytes[n_off..n_off + 4].try_into().unwrap()) as usize;
                n_off += 4;
                let weight = f64::from_le_bytes(bytes[n_off..n_off + 8].try_into().unwrap());
                n_off += 8;

                if target_idx >= node_names.len() {
                    anyhow::bail!("invalid node index: {target_idx} >= {nnodes}");
                }
                neighbors.push((node_names[target_idx].clone(), weight));
            }
            adjacency.insert(name.clone(), neighbors);
        }

        Ok(TskGraph { adjacency, raw_edges })
    }

    /// Converts this TSK graph into a full `GraphIndex` where all nodes are verses.
    pub fn to_graph_index(&self) -> GraphIndex {
        let nodes: Vec<GraphNode> = self
            .adjacency
            .keys()
            .map(|id| GraphNode {
                id: id.clone(),
                kind: NodeKind::Verse,
            })
            .collect();

        let mut adjacency = HashMap::new();
        for (node, neighbors) in &self.adjacency {
            let edge_list: Vec<GraphEdge> = neighbors
                .iter()
                .map(|(id, w)| GraphEdge {
                    id: id.clone(),
                    weight: *w,
                    kind: "tsk".to_string(),
                })
                .collect();
            adjacency.insert(node.clone(), edge_list);
        }

        GraphIndex {
            version: "1.0".to_string(),
            nodes,
            adjacency,
            metadata: None,
        }
    }

    /// Runs GraphRAG expansion over this TSK graph.
    pub fn graph_rag_expand(
        &self,
        seed_verse_ids: &[&str],
        query_topic_ids: &std::collections::HashSet<&str>,
        opts: &GraphRagOptions,
    ) -> GraphRagResult {
        let index = self.to_graph_index();
        index.graph_rag_expand(seed_verse_ids, query_topic_ids, opts)
    }

    /// Adjacency JSON shaped like TS `graph-index.json` `adjacency` for
    /// differential testing: `{id: [{id, weight, kind: "tsk"}]}`.
    pub fn export_adjacency_json(&self) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        for (node, neighbors) in &self.adjacency {
            let list: Vec<serde_json::Value> = neighbors
                .iter()
                .map(|(id, w)| serde_json::json!({"id": id, "weight": w, "kind": "tsk"}))
                .collect();
            map.insert(node.clone(), serde_json::Value::Array(list));
        }
        serde_json::Value::Object(map)
    }
}

// ---------------------------------------------------------------------------
// Multi-source Graph Index & Graph-RAG Traversal (Phase 2)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum NodeKind {
    #[serde(rename = "verse")]
    Verse,
    #[serde(rename = "topic")]
    Topic,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub kind: NodeKind,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GraphEdge {
    pub id: String,
    pub weight: f64,
    pub kind: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GraphIndex {
    #[serde(default)]
    pub version: String,
    pub nodes: Vec<GraphNode>,
    pub adjacency: HashMap<String, Vec<GraphEdge>>,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct GraphRagOptions {
    pub max_depth: usize,
    pub max_expansions: usize,
    pub max_neighbors_per_seed: usize,
    pub edge_min_weight: f64,
}

impl Default for GraphRagOptions {
    fn default() -> Self {
        Self {
            max_depth: 2,
            max_expansions: 30,
            max_neighbors_per_seed: 10,
            edge_min_weight: 0.1,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct GraphCandidate {
    #[serde(rename = "verseId")]
    pub verse_id: String,
    pub score: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct GraphRagDiagnostics {
    #[serde(rename = "seedCount")]
    pub seed_count: usize,
    #[serde(rename = "expandedCount")]
    pub expanded_count: usize,
    #[serde(rename = "traversalDepthReached")]
    pub traversal_depth_reached: usize,
    #[serde(rename = "graphLatencyMs")]
    pub graph_latency_ms: f64,
    #[serde(rename = "graphContributionTopK")]
    pub graph_contribution_top_k: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct GraphRagResult {
    #[serde(rename = "expandedIds")]
    pub expanded_ids: Vec<String>,
    pub candidates: Vec<GraphCandidate>,
    pub diagnostics: GraphRagDiagnostics,
}

#[derive(Clone, Copy)]
struct Timer {
    #[cfg(not(target_arch = "wasm32"))]
    start: std::time::Instant,
    #[cfg(target_arch = "wasm32")]
    start_ms: f64,
}

impl Timer {
    fn start() -> Self {
        #[cfg(not(target_arch = "wasm32"))]
        {
            Self {
                start: std::time::Instant::now(),
            }
        }
        #[cfg(target_arch = "wasm32")]
        {
            Self {
                start_ms: js_sys::Date::now(),
            }
        }
    }

    fn elapsed_ms(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        {
            self.start.elapsed().as_secs_f64() * 1000.0
        }
        #[cfg(target_arch = "wasm32")]
        {
            js_sys::Date::now() - self.start_ms
        }
    }
}

impl GraphIndex {
    /// Loads from JSON string (matching `data/graph-index.json`).
    pub fn from_json_str(json: &str) -> anyhow::Result<Self> {
        let index: GraphIndex = serde_json::from_str(json)?;
        Ok(index)
    }

    /// Performs GraphRAG expansion with bit-for-bit algorithmic parity to
    /// TypeScript `lib/retrieval/graph-rag.ts:graphRagExpand`.
    pub fn graph_rag_expand(
        &self,
        seed_verse_ids: &[&str],
        query_topic_ids: &std::collections::HashSet<&str>,
        opts: &GraphRagOptions,
    ) -> GraphRagResult {
        let timer = Timer::start();
        let seed_count = seed_verse_ids.len();

        let empty_result = |traversal_depth: usize| GraphRagResult {
            expanded_ids: Vec::new(),
            candidates: Vec::new(),
            diagnostics: GraphRagDiagnostics {
                seed_count,
                expanded_count: 0,
                traversal_depth_reached: traversal_depth,
                graph_latency_ms: timer.elapsed_ms(),
                graph_contribution_top_k: 0,
            },
        };

        if seed_count == 0 {
            return empty_result(0);
        }

        // Initialize frontier with normalized, deduplicated seeds
        // (TS: const seedSet = new Set(seedVerseIds.map(id => id.toUpperCase())))
        let mut seed_set = std::collections::HashSet::new();
        let mut frontier: Vec<String> = Vec::new();
        let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
        // Track insertion order in visited to match JS Set iteration order
        let mut visited_order: Vec<String> = Vec::new();

        for s in seed_verse_ids {
            let upper = s.to_uppercase();
            if seed_set.insert(upper.clone()) {
                frontier.push(upper.clone());
                visited.insert(upper.clone());
                visited_order.push(upper);
            }
        }

        // Build lookup from nodes array for node kind filtering
        let mut node_kind_map: HashMap<&str, NodeKind> = HashMap::with_capacity(self.nodes.len());
        for n in &self.nodes {
            node_kind_map.insert(n.id.as_str(), n.kind);
        }

        let mut depth_reached = 0;
        let mut expanded_total_count = 0;
        let mut node_scores: HashMap<String, f64> = HashMap::new();

        // Bounded BFS Traversal
        for depth in 1..=opts.max_depth {
            depth_reached = depth;

            // Collect candidates for this depth step: neighbor_id -> (score, kind)
            // Use IndexMap/Vec to preserve first-seen insertion order for stable tie-breaking
            let mut current_candidates: Vec<(String, f64, String)> = Vec::new();
            let mut candidate_pos: HashMap<String, usize> = HashMap::new();

            for node_id in &frontier {
                let neighbors = match self.adjacency.get(node_id) {
                    Some(n) => n,
                    None => continue,
                };

                // Filter: weight >= edgeMinWeight; not in visited; take top maxNeighborsPerSeed
                let mut valid_neighbors: Vec<&GraphEdge> = neighbors
                    .iter()
                    .filter(|n| n.weight >= opts.edge_min_weight && !visited.contains(&n.id))
                    .collect();

                // Stable sort descending by weight
                valid_neighbors.sort_by(|a, b| b.weight.total_cmp(&a.weight));
                valid_neighbors.truncate(opts.max_neighbors_per_seed);

                for neighbor in valid_neighbors {
                    let mut topic_bonus = 0.0;

                    if neighbor.kind == "topic" {
                        if query_topic_ids.contains(neighbor.id.as_str()) {
                            topic_bonus = 1.0;
                        }
                    } else if neighbor.kind == "verse" {
                        if let Some(n_neighbors) = self.adjacency.get(&neighbor.id) {
                            let has_matching_topic = n_neighbors.iter().any(|nn| {
                                nn.kind == "topic" && query_topic_ids.contains(nn.id.as_str())
                            });
                            if has_matching_topic {
                                topic_bonus = 1.0;
                            }
                        }
                    }

                    let score = neighbor.weight + (0.2 * topic_bonus) + ((1.0 / depth as f64) * 0.1);

                    if let Some(&pos) = candidate_pos.get(&neighbor.id) {
                        if score > current_candidates[pos].1 {
                            current_candidates[pos].1 = score;
                        }
                    } else {
                        let pos = current_candidates.len();
                        candidate_pos.insert(neighbor.id.clone(), pos);
                        current_candidates.push((neighbor.id.clone(), score, neighbor.kind.clone()));
                    }
                }
            }

            if current_candidates.is_empty() {
                break;
            }

            // Stable sort descending by score
            current_candidates.sort_by(|a, b| b.1.total_cmp(&a.1));

            // Take top maxExpansions for this depth step
            let accepted_candidates = &current_candidates[0..current_candidates.len().min(opts.max_expansions)];

            frontier.clear();
            for (id, score, _) in accepted_candidates {
                if expanded_total_count >= opts.max_expansions {
                    break;
                }

                visited.insert(id.clone());
                visited_order.push(id.clone());
                frontier.push(id.clone());
                node_scores.insert(id.clone(), *score);

                expanded_total_count += 1;
            }

            if expanded_total_count >= opts.max_expansions || frontier.is_empty() {
                break;
            }
        }

        // Finalize results: exclude seeds and non-verse nodes
        let mut expanded_ids: Vec<String> = visited_order
            .into_iter()
            .filter(|id| !seed_set.contains(id))
            .filter(|id| node_kind_map.get(id.as_str()) == Some(&NodeKind::Verse))
            .collect();

        // Stable sort descending by node score
        expanded_ids.sort_by(|a, b| {
            let sa = node_scores.get(a).copied().unwrap_or(0.0);
            let sb = node_scores.get(b).copied().unwrap_or(0.0);
            sb.total_cmp(&sa)
        });

        // Calibrate raw graph scores: clamp(round4(raw_score * 0.65), 0.40, 0.85).
        // Rounding MUST be integer round-half-up (`(x*10000).round()/10000`),
        // matching TS `Math.round(x*10000)/10000` op-for-op: `toFixed(4)`
        // disagrees by 1ulp on halfway cases, so it is banned on both sides.
        let candidates = expanded_ids
            .iter()
            .map(|id| {
                let raw_score = node_scores.get(id).copied().unwrap_or(0.5);
                let calibrated = ((raw_score * 0.65 * 10000.0).round() / 10000.0).clamp(0.40, 0.85);
                GraphCandidate {
                    verse_id: id.clone(),
                    score: calibrated,
                }
            })
            .collect();

        let latency_ms = timer.elapsed_ms();
        let expanded_count = expanded_ids.len();

        GraphRagResult {
            expanded_ids,
            candidates,
            diagnostics: GraphRagDiagnostics {
                seed_count,
                expanded_count,
                traversal_depth_reached: depth_reached,
                graph_latency_ms: latency_ms,
                graph_contribution_top_k: expanded_count,
            },
        }
    }
}

fn push_str(buf: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    assert!(b.len() <= u16::MAX as usize);
    buf.extend_from_slice(&(b.len() as u16).to_le_bytes());
    buf.extend_from_slice(b);
}

/// Parses one `cross_references.txt` data line → `(from_id, to_id, weight)`.
/// Returns `None` for header/blank/malformed lines. Ranges (`A-B`) truncate
/// to their start, mirroring TS `parts[i].split('-')[0]`.
pub fn parse_xref_line(line: &str) -> Option<(String, String, f64)> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut parts = trimmed.split('\t');
    let from_raw = parts.next()?;
    let to_raw = parts.next()?;
    if from_raw.trim().eq_ignore_ascii_case("from verse") {
        return None; // header
    }
    let votes_raw = parts.next().unwrap_or("50");
    let from_id = normalize_verse_id(from_raw.split('-').next()?)?;
    let to_id = normalize_verse_id(to_raw.split('-').next()?)?;
    Some((from_id, to_id, vote_weight(votes_raw)))
}

// ---------------------------------------------------------------------------
// Full multi-source graph builder (§1–§4 of scripts/build-graph-index.ts)
// ---------------------------------------------------------------------------
//
// Builds the complete `GraphIndex` from all four TS inputs, in TS order:
//   §1 `datasets/cross_references.txt` (TSK verse↔verse edges)
//   §2 `data/tsk-clusters.json` (hub-and-spoke: `cluster:<id>` topic-kind
//      hubs ↔ member verses, weight `min(1, 1/sqrt(n))`, kind `cluster`)
//   §3 `data/verse-topics.json` (verse ↔ topic edges, weight = confidence,
//      kind `topic`)
//   §4 `data/topic-verse-index.json` (topic ↔ verse edges weight 0.5, kind
//      `topic`, added only when no topic→verse edge exists yet)
//
// Parity notes (all mirrored exactly):
// - `nodes` is first-wins insertion-ordered (TS `Map`); cluster hubs are
//   kind `topic`, exactly like TS `addNode(hubId, 'topic')`.
// - `addEdge` skips self-loops and keeps the max weight, overwriting `kind`
//   only when the new weight is strictly greater.
// - §5 pruning rounds each weight to 3dp FIRST, then stable-sorts desc and
//   keeps the top 20 — across all kinds, so topic/cluster edges compete
//   with TSK edges for slots (this is why the old TSK-only binary diverged
//   on mixed nodes).
// - Topic/cluster IDs are used verbatim (no normalization); verse IDs go
//   through `normalize_verse_id`. §4 topic iteration follows file order,
//   so `serde_json`'s `preserve_order` feature (workspace-wide) is required.

/// One `tsk-clusters.json` item.
#[derive(Debug, serde::Deserialize)]
pub struct ClusterItem {
    #[serde(rename = "clusterId", default)]
    pub cluster_id: String,
    #[serde(rename = "memberVerseIds", default)]
    pub member_verse_ids: Vec<String>,
}

/// One `verse-topics.json` item.
#[derive(Debug, serde::Deserialize)]
pub struct VerseTopicItem {
    #[serde(rename = "verseId", default)]
    pub verse_id: String,
    #[serde(default)]
    pub topics: Vec<TopicAssignment>,
}

/// One topic assignment: explicit `null`/missing confidence means 1.0,
/// mirroring TS `t.confidence ?? 1.0`.
#[derive(Debug, serde::Deserialize)]
pub struct TopicAssignment {
    pub id: String,
    pub confidence: Option<f64>,
}

/// Ordered accumulator replicating TS `nodes` + `adj` maps.
#[derive(Debug, Default)]
pub struct FullGraphBuilder {
    node_order: Vec<String>,
    node_kinds: HashMap<String, NodeKind>,
    /// node → neighbor ids in first-seen order (drives stable tie order).
    neigh_order: HashMap<String, Vec<String>>,
    /// (node, neighbor) → (weight, kind).
    edge_data: HashMap<(String, String), (f64, String)>,
    pub raw_tsk_edges: u64,
}

impl FullGraphBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    fn add_node(&mut self, id: &str, kind: NodeKind) {
        if !self.node_kinds.contains_key(id) {
            self.node_kinds.insert(id.to_string(), kind);
            self.node_order.push(id.to_string());
        }
    }

    /// Mirrors TS `addEdge` (skip self-loops, keep max, kind follows max).
    fn add_edge(&mut self, from: &str, to: &str, weight: f64, kind: &str) {
        if from == to {
            return;
        }
        let key = (from.to_string(), to.to_string());
        match self.edge_data.get(&key) {
            Some((existing, _)) if *existing >= weight => {}
            _ => {
                self.edge_data
                    .insert(key, (weight, kind.to_string()));
                let list = self.neigh_order.entry(from.to_string()).or_default();
                if !list.iter().any(|id| id == to) {
                    list.push(to.to_string());
                }
            }
        }
    }

    /// §1: TSK edges (already normalized + weighted by the caller).
    pub fn add_tsk_edges(&mut self, edges: &[(String, String, f64)]) {
        for (from, to, weight) in edges {
            self.add_node(from, NodeKind::Verse);
            self.add_node(to, NodeKind::Verse);
            self.add_edge(from, to, *weight, "tsk");
            self.add_edge(to, from, *weight, "tsk");
            if from != to {
                self.raw_tsk_edges += 1;
            }
        }
    }

    /// §2: one cluster item (hub-and-spoke). Weight uses the NORMALIZED
    /// member count, mirroring TS (`verses` after filtering).
    pub fn add_cluster(&mut self, item: &ClusterItem) {
        if item.cluster_id.is_empty() {
            return;
        }
        let verses: Vec<String> = item
            .member_verse_ids
            .iter()
            .filter_map(|raw| normalize_verse_id(raw))
            .collect();
        if verses.is_empty() {
            return;
        }
        let hub = format!("cluster:{}", item.cluster_id);
        self.add_node(&hub, NodeKind::Topic);
        let weight = (1.0 / (verses.len() as f64).sqrt()).min(1.0);
        for v in &verses {
            self.add_node(v, NodeKind::Verse);
            self.add_edge(v, &hub, weight, "cluster");
            self.add_edge(&hub, v, weight, "cluster");
        }
    }

    /// §3: one verse-topics item.
    pub fn add_verse_topics(&mut self, item: &VerseTopicItem) {
        let verse_id = match normalize_verse_id(&item.verse_id) {
            Some(id) => id,
            None => return,
        };
        self.add_node(&verse_id, NodeKind::Verse);
        for t in &item.topics {
            if t.id.is_empty() {
                continue;
            }
            let weight = t.confidence.unwrap_or(1.0);
            self.add_node(&t.id, NodeKind::Topic);
            self.add_edge(&verse_id, &t.id, weight, "topic");
            self.add_edge(&t.id, &verse_id, weight, "topic");
        }
    }

    /// §4: one topic-verse-index entry. Mirrors the TS guard exactly: the
    /// 0.5 edge is added only when no topic→verse edge exists yet (the
    /// reverse direction is NOT consulted).
    pub fn add_topic_verses(&mut self, topic_id: &str, verses: &[String]) {
        if topic_id.is_empty() {
            return;
        }
        self.add_node(topic_id, NodeKind::Topic);
        for v in verses {
            let verse_id = match normalize_verse_id(v) {
                Some(id) => id,
                None => continue,
            };
            self.add_node(&verse_id, NodeKind::Verse);
            let exists = self
                .edge_data
                .contains_key(&(topic_id.to_string(), verse_id.clone()));
            if !exists {
                self.add_edge(topic_id, &verse_id, 0.5, "topic");
                self.add_edge(&verse_id, topic_id, 0.5, "topic");
            }
        }
    }

    /// §5: round → stable-sort desc → top-20 per node, then materialize.
    pub fn build(self) -> GraphIndex {
        let mut adjacency: HashMap<String, Vec<GraphEdge>> = HashMap::new();
        // Iterate insertion-ordered nodes for deterministic output.
        let mut ordered_nodes: Vec<&String> = self.neigh_order.keys().collect();
        ordered_nodes.sort_by_key(|id| {
            self.node_order
                .iter()
                .position(|n| n == *id)
                .unwrap_or(usize::MAX)
        });
        for node in ordered_nodes {
            let order = &self.neigh_order[node];
            let mut neighbors: Vec<GraphEdge> = order
                .iter()
                .map(|id| {
                    let (w, kind) = &self.edge_data[&(node.clone(), id.clone())];
                    GraphEdge {
                        id: id.clone(),
                        weight: round3(*w),
                        kind: kind.clone(),
                    }
                })
                .collect();
            neighbors.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap());
            neighbors.truncate(MAX_NEIGHBORS);
            adjacency.insert(node.clone(), neighbors);
        }
        let nodes: Vec<GraphNode> = self
            .node_order
            .into_iter()
            .map(|id| GraphNode {
                kind: self.node_kinds[&id],
                id,
            })
            .collect();
        GraphIndex {
            version: "2.0".to_string(),
            nodes,
            adjacency,
            metadata: None,
        }
    }
}

/// Bounds-checked slice reader shared by the BLMG v2 decoder.
fn take_bytes<'a>(bytes: &'a [u8], off: &mut usize, n: usize) -> anyhow::Result<&'a [u8]> {
    let end = off
        .checked_add(n)
        .ok_or_else(|| anyhow::anyhow!("BLMG v2 truncated"))?;
    if end > bytes.len() {
        anyhow::bail!("BLMG v2 truncated");
    }
    let s = &bytes[*off..end];
    *off = end;
    Ok(s)
}

fn encode_edge_kind(kind: &str) -> anyhow::Result<u8> {
    match kind {
        "tsk" => Ok(0),
        "topic" => Ok(1),
        "cluster" => Ok(2),
        other => anyhow::bail!("unsupported edge kind in BLMG v2: {other}"),
    }
}

fn decode_edge_kind(code: u8) -> anyhow::Result<&'static str> {
    match code {
        0 => Ok("tsk"),
        1 => Ok("topic"),
        2 => Ok("cluster"),
        other => anyhow::bail!("unsupported edge kind code in BLMG v2: {other}"),
    }
}

impl GraphIndex {
    /// Adjacency JSON shaped like TS `graph-index.json` (`{id: [{id,
    /// weight, kind}]}`), keys sorted for deterministic output.
    pub fn export_full_adjacency_json(&self) -> serde_json::Value {
        let mut ids: Vec<&String> = self.adjacency.keys().collect();
        ids.sort();
        let mut map = serde_json::Map::new();
        for id in ids {
            let list: Vec<serde_json::Value> = self.adjacency[id]
                .iter()
                .map(|e| {
                    serde_json::json!({"id": e.id, "weight": e.weight, "kind": e.kind})
                })
                .collect();
            map.insert(id.clone(), serde_json::Value::Array(list));
        }
        serde_json::Value::Object(map)
    }

    // -- BLMG v2 binary format (little-endian) -------------------------------
    //
    // magic "BLMG" | u32 version=2 | u64 raw_tsk_edges
    // u64 nnodes | per node (sorted by id): u16 len + id bytes, u8 node kind
    //   (0 = verse, 1 = topic)
    // then per node in the same order: u64 nneighbors |
    //   per neighbor: u32 node_idx, f64 weight, u8 edge kind
    //   (0 = tsk, 1 = topic, 2 = cluster)

    pub fn encode_blmg_v2(&self, raw_tsk_edges: u64) -> anyhow::Result<Vec<u8>> {
        let mut node_ids: Vec<&String> =
            self.nodes.iter().map(|n| &n.id).collect();
        node_ids.sort();
        node_ids.dedup();
        let index: HashMap<&str, u32> = node_ids
            .iter()
            .enumerate()
            .map(|(i, n)| (n.as_str(), i as u32))
            .collect();
        let kind_of: HashMap<&str, NodeKind> = self
            .nodes
            .iter()
            .map(|n| (n.id.as_str(), n.kind))
            .collect();

        let mut buf = Vec::new();
        buf.extend_from_slice(b"BLMG");
        buf.extend_from_slice(&2u32.to_le_bytes());
        buf.extend_from_slice(&raw_tsk_edges.to_le_bytes());
        buf.extend_from_slice(&(node_ids.len() as u64).to_le_bytes());
        for id in &node_ids {
            push_str(&mut buf, id);
            let code: u8 = match kind_of.get(id.as_str()) {
                Some(NodeKind::Topic) => 1,
                _ => 0,
            };
            buf.push(code);
        }
        for id in &node_ids {
            let neighbors = self.adjacency.get(*id);
            // Neighbors referencing unknown nodes indicate a corrupt index.
            if let Some(list) = neighbors {
                for e in list {
                    if !index.contains_key(e.id.as_str()) {
                        anyhow::bail!("neighbor {} of {} missing from node table", e.id, id);
                    }
                }
            }
            let list = neighbors.map(Vec::as_slice).unwrap_or(&[]);
            buf.extend_from_slice(&(list.len() as u64).to_le_bytes());
            for e in list {
                buf.extend_from_slice(&index[e.id.as_str()].to_le_bytes());
                buf.extend_from_slice(&e.weight.to_le_bytes());
                buf.push(encode_edge_kind(&e.kind)?);
            }
        }
        Ok(buf)
    }

    pub fn decode_blmg_v2(bytes: &[u8]) -> anyhow::Result<(Self, u64)> {
        let mut off = 0usize;
        if take_bytes(bytes, &mut off, 4)? != b"BLMG" {
            anyhow::bail!("invalid magic: expected BLMG");
        }
        let version = u32::from_le_bytes(take_bytes(bytes, &mut off, 4)?.try_into().unwrap());
        if version != 2 {
            anyhow::bail!("not a BLMG v2 payload (version {version})");
        }
        let raw_tsk_edges = u64::from_le_bytes(take_bytes(bytes, &mut off, 8)?.try_into().unwrap());
        let nnodes = u64::from_le_bytes(take_bytes(bytes, &mut off, 8)?.try_into().unwrap()) as usize;

        let mut node_ids = Vec::with_capacity(nnodes);
        let mut node_kinds = Vec::with_capacity(nnodes);
        for _ in 0..nnodes {
            let slen = u16::from_le_bytes(take_bytes(bytes, &mut off, 2)?.try_into().unwrap()) as usize;
            let name = std::str::from_utf8(take_bytes(bytes, &mut off, slen)?)
                .map_err(|e| anyhow::anyhow!("invalid utf8 in node id: {e}"))?
                .to_string();
            let kind_code = take_bytes(bytes, &mut off, 1)?[0];
            let kind = match kind_code {
                0 => NodeKind::Verse,
                1 => NodeKind::Topic,
                other => anyhow::bail!("invalid node kind code: {other}"),
            };
            node_ids.push(name);
            node_kinds.push(kind);
        }

        let mut adjacency = HashMap::new();
        for node in &node_ids {
            let n = u64::from_le_bytes(take_bytes(bytes, &mut off, 8)?.try_into().unwrap()) as usize;
            let mut edges = Vec::with_capacity(n);
            for _ in 0..n {
                let idx = u32::from_le_bytes(take_bytes(bytes, &mut off, 4)?.try_into().unwrap()) as usize;
                let weight = f64::from_le_bytes(take_bytes(bytes, &mut off, 8)?.try_into().unwrap());
                let kind = decode_edge_kind(take_bytes(bytes, &mut off, 1)?[0])?.to_string();
                if idx >= node_ids.len() {
                    anyhow::bail!("invalid node index {idx} >= {}", node_ids.len());
                }
                edges.push(GraphEdge {
                    id: node_ids[idx].clone(),
                    weight,
                    kind,
                });
            }
            adjacency.insert(node.clone(), edges);
        }
        if off != bytes.len() {
            anyhow::bail!("trailing bytes in BLMG v2 index");
        }

        let nodes: Vec<GraphNode> = node_ids
            .into_iter()
            .zip(node_kinds)
            .map(|(id, kind)| GraphNode { id, kind })
            .collect();
        Ok((
            GraphIndex {
                version: "2.0".to_string(),
                nodes,
                adjacency,
                metadata: None,
            },
            raw_tsk_edges,
        ))
    }
}

/// Decodes any supported graph binary: BLMG v2 (full multi-source graph)
/// or v1 (legacy TSK-only, upgraded in memory with `kind = "tsk"`).
pub fn decode_graph_bytes(bytes: &[u8]) -> anyhow::Result<(GraphIndex, u64)> {
    if bytes.len() >= 8 && &bytes[0..4] == b"BLMG" {
        let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        if version == 2 {
            return GraphIndex::decode_blmg_v2(bytes);
        }
    }
    let tsk = TskGraph::decode(bytes)?;
    let raw = tsk.raw_edges;
    Ok((tsk.to_graph_index(), raw))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ref_forms_match_ts() {
        assert_eq!(normalize_verse_id("Gen.1.1"), Some("GEN 1:1".into()));
        assert_eq!(normalize_verse_id("Ps.104.24"), Some("PSA 104:24".into()));
        assert_eq!(normalize_verse_id("1John.1.1"), Some("1JN 1:1".into()));
        assert_eq!(normalize_verse_id("DEUT 22:21"), Some("DEU 22:21".into()));
        assert_eq!(normalize_verse_id("Ps 23:1"), Some("PSA 23:1".into()));
        assert_eq!(normalize_verse_id("Hezekiah 4:12"), None);
        assert_eq!(normalize_verse_id("Gen.0.1"), None);
        assert_eq!(normalize_verse_id("Gen.1"), None);
        assert_eq!(normalize_verse_id(""), None);
    }

    #[test]
    fn weights_match_ts() {
        assert!((vote_weight("60") - 0.4).abs() < 1e-12);
        assert!((vote_weight("61") - 61.0 / 150.0).abs() < 1e-12);
        assert_eq!(vote_weight("9999"), 0.95);
        assert_eq!(vote_weight("-87"), 0.2);
        assert!((vote_weight("abc") - 50.0 / 150.0).abs() < 1e-12);
        assert_eq!(round3(0.4066666667), 0.407);
    }

    #[test]
    fn ts_parse_int_matches_js_parseint() {
        assert_eq!(ts_parse_int("60"), Some(60));
        assert_eq!(ts_parse_int("  60xyz"), Some(60));
        assert_eq!(ts_parse_int("3.9"), Some(3));
        assert_eq!(ts_parse_int("-87"), Some(-87));
        assert_eq!(ts_parse_int("+12"), Some(12));
        assert_eq!(ts_parse_int("0x10"), Some(0));
        assert_eq!(ts_parse_int(""), None);
        assert_eq!(ts_parse_int("   "), None);
        assert_eq!(ts_parse_int("abc"), None);
        // Float-looking vote strings follow parseInt, not float parse.
        assert!((vote_weight("3.9") - 0.2).abs() < 1e-12); // 3/150 clamps to floor
        assert!((vote_weight("60abc") - 0.4).abs() < 1e-12);
    }

    #[test]
    fn build_dedupes_prunes_and_skips_self_loops() {
        let edges = vec![
            ("A".to_string(), "A".to_string(), 0.9),
            ("A".to_string(), "B".to_string(), 0.3),
            ("A".to_string(), "B".to_string(), 0.8),
        ];
        let g = TskGraph::build(&edges);
        assert_eq!(g.adjacency["A"], vec![("B".to_string(), 0.8)]);
        assert_eq!(g.adjacency["B"], vec![("A".to_string(), 0.8)]);
    }

    #[test]
    fn xref_line_parsing() {
        let (f, t, w) = parse_xref_line("Gen.1.1\tPs.104.24\t60").unwrap();
        assert_eq!((f.as_str(), t.as_str()), ("GEN 1:1", "PSA 104:24"));
        assert!((w - 0.4).abs() < 1e-12);
        assert!(parse_xref_line("From Verse\tTo Verse\tVotes").is_none());
        assert!(parse_xref_line("").is_none());
        // Range truncates to start.
        let (f, _, _) = parse_xref_line("Ps.89.11-Ps.89.12\tGen.1.1\t10").unwrap();
        assert_eq!(f, "PSA 89:11");
    }

    #[test]
    fn binary_encode_decode_roundtrip() {
        let edges = vec![
            ("GEN 1:1".to_string(), "PSA 104:24".to_string(), 0.8),
            ("GEN 1:1".to_string(), "JHN 1:1".to_string(), 0.6),
            ("JHN 1:1".to_string(), "COL 1:16".to_string(), 0.75),
        ];
        let original = TskGraph::build(&edges);
        let encoded = original.encode();
        let decoded = TskGraph::decode(&encoded).expect("decode failed");

        assert_eq!(decoded.raw_edges, original.raw_edges);
        assert_eq!(decoded.adjacency, original.adjacency);
    }

    fn fixture_graph_index() -> GraphIndex {
        let nodes = vec![
            GraphNode { id: "GEN 1:1".into(), kind: NodeKind::Verse },
            GraphNode { id: "GEN 1:2".into(), kind: NodeKind::Verse },
            GraphNode { id: "GEN 1:3".into(), kind: NodeKind::Verse },
            GraphNode { id: "JOHN 1:1".into(), kind: NodeKind::Verse },
            GraphNode { id: "JOHN 1:3".into(), kind: NodeKind::Verse },
            GraphNode { id: "creation".into(), kind: NodeKind::Topic },
        ];

        let mut adjacency = HashMap::new();
        adjacency.insert(
            "GEN 1:1".into(),
            vec![
                GraphEdge { id: "GEN 1:2".into(), weight: 0.8, kind: "cluster".into() },
                GraphEdge { id: "creation".into(), weight: 0.9, kind: "topic".into() },
                GraphEdge { id: "JOHN 1:1".into(), weight: 0.6, kind: "cluster".into() },
            ],
        );
        adjacency.insert(
            "GEN 1:2".into(),
            vec![
                GraphEdge { id: "GEN 1:1".into(), weight: 0.8, kind: "cluster".into() },
                GraphEdge { id: "GEN 1:3".into(), weight: 0.7, kind: "cluster".into() },
            ],
        );
        adjacency.insert(
            "JOHN 1:1".into(),
            vec![
                GraphEdge { id: "GEN 1:1".into(), weight: 0.6, kind: "cluster".into() },
                GraphEdge { id: "JOHN 1:3".into(), weight: 0.5, kind: "cluster".into() },
                GraphEdge { id: "creation".into(), weight: 0.7, kind: "topic".into() },
            ],
        );
        adjacency.insert(
            "creation".into(),
            vec![
                GraphEdge { id: "GEN 1:1".into(), weight: 0.9, kind: "topic".into() },
                GraphEdge { id: "JOHN 1:1".into(), weight: 0.7, kind: "topic".into() },
                GraphEdge { id: "GEN 1:3".into(), weight: 0.4, kind: "topic".into() },
            ],
        );
        adjacency.insert(
            "JOHN 1:3".into(),
            vec![
                GraphEdge { id: "JOHN 1:1".into(), weight: 0.5, kind: "cluster".into() },
            ],
        );
        adjacency.insert(
            "GEN 1:3".into(),
            vec![
                GraphEdge { id: "GEN 1:2".into(), weight: 0.7, kind: "cluster".into() },
                GraphEdge { id: "creation".into(), weight: 0.4, kind: "topic".into() },
            ],
        );

        GraphIndex {
            version: "2026-01-01T00:00:00.000Z".into(),
            nodes,
            adjacency,
            metadata: None,
        }
    }

    #[test]
    fn graph_rag_depth_1_respects_depth() {
        let index = fixture_graph_index();
        let topics = std::collections::HashSet::new();
        let opts = GraphRagOptions {
            max_depth: 1,
            max_expansions: 30,
            max_neighbors_per_seed: 10,
            edge_min_weight: 0.01,
        };
        let result = index.graph_rag_expand(&["GEN 1:1"], &topics, &opts);

        assert!(result.diagnostics.traversal_depth_reached <= 1);
        assert!(!result.expanded_ids.contains(&"GEN 1:1".to_string()));
    }

    #[test]
    fn graph_rag_respects_max_expansions() {
        let index = fixture_graph_index();
        let topics = std::collections::HashSet::new();
        let opts = GraphRagOptions {
            max_depth: 3,
            max_expansions: 2,
            max_neighbors_per_seed: 10,
            edge_min_weight: 0.01,
        };
        let result = index.graph_rag_expand(&["GEN 1:1"], &topics, &opts);
        assert!(result.expanded_ids.len() <= 2);
    }

    #[test]
    fn graph_rag_higher_weight_ranks_above_lower() {
        let index = fixture_graph_index();
        let topics = std::collections::HashSet::new();
        let opts = GraphRagOptions {
            max_depth: 1,
            max_expansions: 30,
            max_neighbors_per_seed: 10,
            edge_min_weight: 0.01,
        };
        let result = index.graph_rag_expand(&["GEN 1:1"], &topics, &opts);

        let gen12_pos = result.expanded_ids.iter().position(|id| id == "GEN 1:2");
        let john11_pos = result.expanded_ids.iter().position(|id| id == "JOHN 1:1");

        assert!(gen12_pos.is_some() && john11_pos.is_some());
        assert!(gen12_pos.unwrap() < john11_pos.unwrap());
    }

    #[test]
    fn graph_rag_topic_bonus_boosts_matching() {
        let index = fixture_graph_index();
        let mut topics = std::collections::HashSet::new();
        topics.insert("creation");

        let opts = GraphRagOptions {
            max_depth: 1,
            max_expansions: 30,
            max_neighbors_per_seed: 10,
            edge_min_weight: 0.01,
        };
        let with_topic = index.graph_rag_expand(&["GEN 1:1"], &topics, &opts);
        let empty_topics = std::collections::HashSet::new();
        let without_topic = index.graph_rag_expand(&["GEN 1:1"], &empty_topics, &opts);

        assert!(with_topic.diagnostics.expanded_count >= without_topic.diagnostics.expanded_count);
    }

    fn full_graph_fixture() -> GraphIndex {
        let mut b = FullGraphBuilder::new();
        // §1 TSK
        b.add_tsk_edges(&[
            ("GEN 1:1".to_string(), "PSA 104:24".to_string(), 0.8),
            ("GEN 1:1".to_string(), "JHN 1:1".to_string(), 0.6),
        ]);
        // §2 cluster: hub is topic-kind, weight = 1/sqrt(2).
        b.add_cluster(&ClusterItem {
            cluster_id: "c1".to_string(),
            member_verse_ids: vec!["Gen.1.1".to_string(), "Ps.104.24".to_string()],
        });
        // §3 verse-topics (explicit null confidence → 1.0).
        let vt: VerseTopicItem = serde_json::from_str(
            r#"{"verseId": "GEN 1:1", "topics": [{"id": "creation", "confidence": 0.9}, {"id": "origins", "confidence": null}]}"#,
        )
        .unwrap();
        b.add_verse_topics(&vt);
        // §4 topic-verse-index: 0.5 edges, must NOT overwrite the 0.9 above.
        b.add_topic_verses("creation", &["GEN 1:1".to_string(), "GEN 1:2".to_string()]);
        b.build()
    }

    #[test]
    fn full_builder_matches_ts_semantics() {
        let g = full_graph_fixture();

        // Hub node exists, kind topic (TS addNode(hubId, 'topic')).
        let hub = g.nodes.iter().find(|n| n.id == "cluster:c1").unwrap();
        assert_eq!(hub.kind, NodeKind::Topic);

        // Cluster weight = min(1, 1/sqrt(2)) rounded to 3dp.
        let gen1 = &g.adjacency["GEN 1:1"];
        let hub_edge = gen1.iter().find(|e| e.id == "cluster:c1").unwrap();
        assert_eq!(hub_edge.kind, "cluster");
        assert!((hub_edge.weight - 0.707).abs() < 1e-12);

        // §3 confidence preserved; §4 guard did not overwrite 0.9 with 0.5.
        let creation_edge = gen1.iter().find(|e| e.id == "creation").unwrap();
        assert_eq!(creation_edge.kind, "topic");
        assert!((creation_edge.weight - 0.9).abs() < 1e-12);

        // Null confidence → 1.0.
        let origins_edge = gen1.iter().find(|e| e.id == "origins").unwrap();
        assert!((origins_edge.weight - 1.0).abs() < 1e-12);

        // §4 added the genuinely-new verse, both directions.
        assert!(g.adjacency["creation"].iter().any(|e| e.id == "GEN 1:2"));
        assert!(g.adjacency["GEN 1:2"].iter().any(|e| e.id == "creation"));

        // Neighbor order: weight desc; equal weights keep first-seen order.
        let ids: Vec<&str> = gen1.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids[0], "origins"); // 1.0
        assert_eq!(ids[1], "creation"); // 0.9
        // 0.8 TSK PSA 104:24 before 0.707 cluster hub before 0.6 JHN 1:1.
        assert_eq!(&ids[2..], &["PSA 104:24", "cluster:c1", "JHN 1:1"]);
    }

    #[test]
    fn full_builder_prunes_across_kinds_top20() {
        let mut b = FullGraphBuilder::new();
        // 25 topic edges at ascending weights + 1 strong TSK edge.
        for i in 0..25 {
            b.add_verse_topics(&VerseTopicItem {
                verse_id: "GEN 1:1".to_string(),
                topics: vec![TopicAssignment {
                    id: format!("topic-{i:02}"),
                    confidence: Some(0.30 + i as f64 * 0.01),
                }],
            });
        }
        b.add_tsk_edges(&[("GEN 1:1".to_string(), "PSA 104:24".to_string(), 0.95)]);
        let g = b.build();
        let list = &g.adjacency["GEN 1:1"];
        assert_eq!(list.len(), 20);
        assert_eq!(list[0].id, "PSA 104:24"); // strongest survives
        assert_eq!(list[0].kind, "tsk");
        // Weakest topics evicted; survivors sorted desc.
        assert!(list.iter().all(|e| e.weight >= 0.35));
        for w in list.windows(2) {
            assert!(w[0].weight >= w[1].weight);
        }
    }

    #[test]
    fn blmg_v2_roundtrip_preserves_kinds() {
        let g = full_graph_fixture();
        let bytes = g.encode_blmg_v2(42).unwrap();
        let (back, raw) = GraphIndex::decode_blmg_v2(&bytes).unwrap();
        assert_eq!(raw, 42);
        assert_eq!(back.adjacency, g.adjacency);
        let mut a: Vec<(&str, NodeKind)> =
            g.nodes.iter().map(|n| (n.id.as_str(), n.kind)).collect();
        let mut c: Vec<(&str, NodeKind)> =
            back.nodes.iter().map(|n| (n.id.as_str(), n.kind)).collect();
        a.sort_by_key(|(id, _)| *id);
        c.sort_by_key(|(id, _)| *id);
        assert_eq!(a, c);
        // Trailing garbage is rejected.
        let mut bad = bytes.clone();
        bad.push(0);
        assert!(GraphIndex::decode_blmg_v2(&bad).is_err());
    }

    #[test]
    fn decode_graph_bytes_accepts_legacy_v1() {
        let edges = vec![("GEN 1:1".to_string(), "PSA 104:24".to_string(), 0.8)];
        let tsk = TskGraph::build(&edges);
        let v1 = tsk.encode();
        let (g, _) = decode_graph_bytes(&v1).unwrap();
        assert!(g.adjacency["GEN 1:1"].iter().all(|e| e.kind == "tsk"));
        assert!(g.nodes.iter().all(|n| n.kind == NodeKind::Verse));
    }
}
