//! Side-by-side retrieval evaluation (Phase 2).
//!
//! Ports the metric logic of `tests/benchmark/run-benchmarks.ts` exactly:
//! - `prepareSearchQuery`: history contents joined + query
//! - top-5 refs, uppercased
//! - `matchExpectedRef`: book+chapter equality + verse-range overlap,
//!   string-prefix fallback
//! - precision@5, best-rank hit@1/hit@5, MRR (2dp); empty-target rule:
//!   score 1 iff nothing retrieved
//!
//! `--compare-ts` diffs Rust top-refs against the TS raw-BM25 reference
//! (`scripts/eval-raw-bm25.ts` output) scenario by scenario.

use anyhow::{Context, Result};
use biblelm_index::Bm25Index;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, serde::Deserialize, Clone)]
#[allow(dead_code)] // cache_mode/translation mirror the fixture schema for compat
pub struct Scenario {
    id: String,
    category: String,
    #[serde(rename = "cacheMode", default)]
    cache_mode: String,
    query: String,
    #[serde(default)]
    translation: String,
    #[serde(rename = "expectedTopRefs", default)]
    expected_top_refs: Vec<String>,
    #[serde(rename = "expectedVerses", default)]
    expected_verses: Vec<String>,
    #[serde(rename = "mustContainVerses", default)]
    must_contain_verses: Vec<String>,
    #[serde(rename = "parallelVerses", default)]
    parallel_verses: Vec<String>,
    #[serde(rename = "conversationHistory", default)]
    conversation_history: Vec<HistoryMsg>,
}

#[derive(Debug, serde::Deserialize, Clone)]
struct HistoryMsg {
    content: String,
}

fn prepare_search_query(s: &Scenario) -> String {
    if s.conversation_history.is_empty() {
        return s.query.clone();
    }
    let history = s
        .conversation_history
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    format!("{history} {}", s.query)
}

fn expected_targets(s: &Scenario) -> Vec<String> {
    let mut v = Vec::new();
    v.extend(s.expected_top_refs.iter().cloned());
    v.extend(s.expected_verses.iter().cloned());
    v.extend(s.must_contain_verses.iter().cloned());
    v.extend(s.parallel_verses.iter().cloned());
    v
}

#[derive(Debug, Clone, Copy)]
struct ParsedRef<'a> {
    book: &'a str,
    chapter: u32,
    start: u32,
    end: u32,
}

/// Mirrors TS `parseRef` (`/^([1-3]?[A-Z]{2,3})\s+(\d+):(\d+)(?:[-–](\d+))?$/i`).
fn parse_ref(s: &str) -> Option<ParsedRef<'_>> {
    let s = s.trim();
    let (book, rest) = s.split_once(char::is_whitespace)?;
    let rest = rest.trim_start();
    if book.len() < 2 || book.len() > 4 {
        return None;
    }
    let mut chars = book.chars();
    if let Some('1' | '2' | '3') = chars.next() {
        if !book[1..].chars().all(|c| c.is_ascii_alphabetic()) || book.len() < 3 {
            return None;
        }
    } else if !book.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    if !book.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    let (ch_raw, v_raw) = rest.split_once(':')?;
    if !ch_raw.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    // End part: digits after optional -/–; anything else → no parse (TS $ anchor).
    let (start_raw, end_raw) = match v_raw.split_once(['-', '–']) {
        Some((a, b)) => (a, Some(b)),
        None => (v_raw, None),
    };
    if !start_raw.chars().all(|c| c.is_ascii_digit()) || start_raw.is_empty() {
        return None;
    }
    if let Some(e) = end_raw {
        if !e.chars().all(|c| c.is_ascii_digit()) || e.is_empty() {
            return None;
        }
    }
    let chapter: u32 = ch_raw.parse().ok()?;
    let start: u32 = start_raw.parse().ok()?;
    let end: u32 = end_raw.map(|e| e.parse().unwrap_or(start)).unwrap_or(start);
    Some(ParsedRef { book, chapter, start, end })
}

/// Mirrors TS `matchExpectedRef` (inputs uppercased first, like TS topRefs).
fn match_expected_ref(retrieved: &str, expected: &str) -> bool {
    let r = retrieved.trim().to_uppercase();
    let e = expected.trim().to_uppercase();
    match (parse_ref(&r), parse_ref(&e)) {
        (Some(r1), Some(r2)) => {
            r1.book == r2.book
                && r1.chapter == r2.chapter
                && r1.start.max(r2.start) <= r1.end.min(r2.end)
        }
        _ => r == e || r.starts_with(&format!("{e}-")) || e.starts_with(&format!("{r}-")),
    }
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

#[derive(Debug, Default)]
struct Metrics {
    n: usize,
    hit_at_1: f64,
    hit_at_5: f64,
    mrr: f64,
    precision_at_5: f64,
}

impl Metrics {
    fn add(&mut self, top_refs: &[String], targets: &[String]) {
        self.n += 1;
        if targets.is_empty() {
            let s = if top_refs.is_empty() { 1.0 } else { 0.0 };
            self.hit_at_1 += s;
            self.hit_at_5 += s;
            self.mrr += s;
            self.precision_at_5 += s;
            return;
        }
        let matches = top_refs
            .iter()
            .filter(|r| targets.iter().any(|t| match_expected_ref(r, t)))
            .count();
        let denom = top_refs.len().clamp(1, 5) as f64;
        self.precision_at_5 += round2(matches as f64 / denom);
        let mut best_rank = 0;
        for (i, r) in top_refs.iter().enumerate() {
            if targets.iter().any(|t| match_expected_ref(r, t)) {
                best_rank = i + 1;
                break;
            }
        }
        if best_rank == 1 {
            self.hit_at_1 += 1.0;
        }
        if best_rank > 0 && best_rank <= 5 {
            self.hit_at_5 += 1.0;
        }
        if best_rank > 0 {
            self.mrr += round2(1.0 / best_rank as f64);
        }
    }

    fn report(&self) -> serde_json::Value {
        let n = self.n as f64;
        serde_json::json!({
            "n": self.n,
            "hit_at_1": round2(self.hit_at_1 / n),
            "hit_at_5": round2(self.hit_at_5 / n),
            "mrr": round2(self.mrr / n),
            "precision_at_5": round2(self.precision_at_5 / n),
        })
    }
}

/// Held-out rule mirroring `selectHeldoutScenarios` in run-benchmarks.ts.
pub fn is_heldout(index: usize, scenario: &Scenario) -> bool {
    scenario.category == "adversarial" || index % 4 == 3
}

pub struct EvalOutput {
    pub top_refs: HashMap<String, Vec<String>>,
    pub metrics: serde_json::Value,
    pub heldout_metrics: serde_json::Value,
}

pub fn run_eval(
    index: &Bm25Index,
    texts_by_id: &HashMap<String, String>,
    scenarios: &[Scenario],
) -> EvalOutput {
    // Texts aligned with the binary doc-id table (raw display text).
    let texts: Vec<String> = index
        .doc_ids
        .iter()
        .map(|id| texts_by_id.get(id).cloned().unwrap_or_default())
        .collect();
    let mut top_refs = HashMap::new();
    let mut all = Metrics::default();
    let mut held = Metrics::default();
    for (i, s) in scenarios.iter().enumerate() {
        let query = prepare_search_query(s);
        let refs: Vec<String> = index
            .search(&query, &texts, 5)
            .iter()
            .map(|h| index.doc_ids[h.doc as usize].trim().to_uppercase())
            .collect();
        let targets = expected_targets(s);
        all.add(&refs, &targets);
        if is_heldout(i, s) {
            held.add(&refs, &targets);
        }
        top_refs.insert(s.id.clone(), refs);
    }
    EvalOutput {
        top_refs,
        metrics: all.report(),
        heldout_metrics: held.report(),
    }
}

pub fn load_scenarios(path: &Path) -> Result<Vec<Scenario>> {
    serde_json::from_str(&fs::read_to_string(path)?).context("parsing scenarios.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ref_matching_matches_ts() {
        assert!(match_expected_ref("EXO 20:1", "EXO 20:1-17"));
        assert!(match_expected_ref("EXO 20:17", "EXO 20:1-17"));
        assert!(!match_expected_ref("EXO 20:1", "EXO 21:1"));
        assert!(!match_expected_ref("GEN 1:1", "EXO 20:1"));
        assert!(match_expected_ref("psa 23:1", "PSA 23:1"));
        assert!(match_expected_ref("JHN 3:16", "JHN 3:16"));
        assert!(!match_expected_ref("JHN 3:16", "JHN 3:17"));
        // Range overlap both directions.
        assert!(match_expected_ref("DEU 5:6-21", "DEU 5:6"));
    }

    #[test]
    fn metrics_follow_ts_formulas() {
        let mut m = Metrics::default();
        m.add(&["EXO 20:1".to_string()], &["EXO 20:1-17".to_string()]);
        assert_eq!(m.hit_at_1, 1.0);
        assert_eq!(m.mrr, 1.0);
        let mut m2 = Metrics::default();
        m2.add(&["GEN 1:1".to_string(), "EXO 20:1".to_string()], &["EXO 20:1-17".to_string()]);
        assert_eq!(m2.hit_at_1, 0.0);
        assert_eq!(m2.hit_at_5, 1.0);
        assert_eq!(m2.mrr, 0.5);
        // Empty targets: 1 iff nothing retrieved.
        let mut m3 = Metrics::default();
        m3.add(&[], &[]);
        m3.add(&["GEN 1:1".to_string()], &[]);
        assert_eq!(m3.hit_at_1, 1.0);
    }
}
