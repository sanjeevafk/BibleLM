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
}
