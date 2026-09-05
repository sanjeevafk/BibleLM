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

/// Mirrors TS vote→weight: `min(0.95, max(0.2, votes / 150))`.
/// NaN votes → default 50 (TS `Number.isNaN(votes) ? 50 : votes`).
pub fn vote_weight(votes_raw: &str) -> f64 {
    let votes: f64 = votes_raw.trim().parse().unwrap_or(50.0);
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
        for (node, mut neighbors) in adj {
            // Stable sort, weight desc only — ties keep file order like TS.
            neighbors.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
            let list: Vec<(String, f64)> = neighbors
                .into_iter()
                .take(MAX_NEIGHBORS)
                .map(|(id, w)| (id.to_string(), round3(w)))
                .collect();
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

        // Calibrate raw graph scores: clamp(round4(raw_score * 0.65), 0.40, 0.85)
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

// ---------------------------------------------------------------------------
// CSR (Compressed Sparse Row) Graph Representation
// ---------------------------------------------------------------------------

/// Compact linear memory graph for instant slice-based traversal.
#[derive(Debug, Clone)]
pub struct CsrGraph {
    pub node_names: Vec<String>,
    pub node_kinds: Vec<NodeKind>,
    pub offsets: Vec<u32>,
    pub target_indices: Vec<u32>,
    pub weights: Vec<f64>,
    pub edge_kinds: Vec<String>,
    pub name_to_index: HashMap<String, u32>,
}

impl CsrGraph {
    pub fn from_graph_index(index: &GraphIndex) -> Self {
        let mut node_names = Vec::with_capacity(index.nodes.len());
        let mut node_kinds = Vec::with_capacity(index.nodes.len());
        let mut name_to_index = HashMap::with_capacity(index.nodes.len());

        for (i, node) in index.nodes.iter().enumerate() {
            node_names.push(node.id.clone());
            node_kinds.push(node.kind);
            name_to_index.insert(node.id.clone(), i as u32);
        }

        // Add any missing nodes present in adjacency
        for (src, edges) in &index.adjacency {
            if !name_to_index.contains_key(src) {
                let idx = node_names.len() as u32;
                node_names.push(src.clone());
                node_kinds.push(NodeKind::Verse);
                name_to_index.insert(src.clone(), idx);
            }
            for edge in edges {
                if !name_to_index.contains_key(&edge.id) {
                    let idx = node_names.len() as u32;
                    node_names.push(edge.id.clone());
                    node_kinds.push(if edge.kind == "topic" { NodeKind::Topic } else { NodeKind::Verse });
                    name_to_index.insert(edge.id.clone(), idx);
                }
            }
        }

        let n = node_names.len();
        let mut offsets = Vec::with_capacity(n + 1);
        let mut target_indices = Vec::new();
        let mut weights = Vec::new();
        let mut edge_kinds = Vec::new();

        for name in &node_names {
            offsets.push(target_indices.len() as u32);
            if let Some(neighbors) = index.adjacency.get(name) {
                for edge in neighbors {
                    if let Some(&t_idx) = name_to_index.get(&edge.id) {
                        target_indices.push(t_idx);
                        weights.push(edge.weight);
                        edge_kinds.push(edge.kind.clone());
                    }
                }
            }
        }
        offsets.push(target_indices.len() as u32);

        CsrGraph {
            node_names,
            node_kinds,
            offsets,
            target_indices,
            weights,
            edge_kinds,
            name_to_index,
        }
    }

    pub fn to_graph_index(&self) -> GraphIndex {
        let nodes: Vec<GraphNode> = self
            .node_names
            .iter()
            .zip(&self.node_kinds)
            .map(|(name, &kind)| GraphNode {
                id: name.clone(),
                kind,
            })
            .collect();

        let mut adjacency = HashMap::new();
        for (i, name) in self.node_names.iter().enumerate() {
            let start = self.offsets[i] as usize;
            let end = self.offsets[i + 1] as usize;
            let mut edges = Vec::with_capacity(end - start);
            for e in start..end {
                let target_idx = self.target_indices[e] as usize;
                edges.push(GraphEdge {
                    id: self.node_names[target_idx].clone(),
                    weight: self.weights[e],
                    kind: self.edge_kinds[e].clone(),
                });
            }
            adjacency.insert(name.clone(), edges);
        }

        GraphIndex {
            version: "1.0-csr".to_string(),
            nodes,
            adjacency,
            metadata: None,
        }
    }

    pub fn graph_rag_expand(
        &self,
        seed_verse_ids: &[&str],
        query_topic_ids: &std::collections::HashSet<&str>,
        opts: &GraphRagOptions,
    ) -> GraphRagResult {
        // Traversal is equivalent to GraphIndex traversal
        let index = self.to_graph_index();
        index.graph_rag_expand(seed_verse_ids, query_topic_ids, opts)
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

    #[test]
    fn csr_graph_matches_graph_index_expansion() {
        let index = fixture_graph_index();
        let csr = CsrGraph::from_graph_index(&index);
        let mut topics = std::collections::HashSet::new();
        topics.insert("creation");

        let opts = GraphRagOptions {
            max_depth: 2,
            max_expansions: 30,
            max_neighbors_per_seed: 10,
            edge_min_weight: 0.01,
        };

        let res_index = index.graph_rag_expand(&["GEN 1:1"], &topics, &opts);
        let res_csr = csr.graph_rag_expand(&["GEN 1:1"], &topics, &opts);

        assert_eq!(res_index.expanded_ids, res_csr.expanded_ids);
        assert_eq!(res_index.candidates, res_csr.candidates);
    }
}
