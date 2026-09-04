//! BM25 inverted-index builder with byte-exact TypeScript parity.
//!
//! Mirrors `lib/retrieval/bm25.ts`:
//! - Tokenizer: `toLowerCase`, replace `[^A-Za-z0-9_\s']` with space, split whitespace.
//! - k1 = 1.2, b = 0.65 (stored for query-time use in Phase 2).
//!
//! JS `\w` (no /u flag) is ASCII-only (`A-Za-z0-9_`); JS `\s` (no /u flag) is
//! the fixed set below — replicated exactly rather than using Rust's
//! Unicode `is_whitespace`, which is a superset.

use anyhow::{Context, Result};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

pub const BM25_K1: f64 = 1.2;
pub const BM25_B: f64 = 0.65;

/// JS `\s` without /u flag: <https://tc39.es/ecma262/#sec-white-space>
fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}' | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// Byte-exact port of `BM25Engine.tokenize`.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for c in text.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '\'' {
            current.push(c);
        } else if is_js_whitespace(c) {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        } else {
            // Other punctuation → word separator (replaced with space in TS).
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

/// One indexed document.
#[derive(Debug, Clone)]
pub struct Bm25Doc {
    pub id: String,
    pub text: String,
}

/// One search hit: index into the doc-id table + BM25 score.
#[derive(Debug, Clone)]
pub struct SearchHit {
    pub doc: u32,
    pub score: f64,
}

/// Phrase normalization: mirrors TS `normalizeForPhrase` (same char class
/// as the tokenizer, but whitespace-collapsed instead of split).
pub fn normalize_phrase(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut last_was_space = true; // trims leading whitespace like TS .trim()
    for c in text.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '\'' {
            out.push(c);
            last_was_space = false;
        } else if is_js_whitespace(c) {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
        } else if !last_was_space {
            // Other punctuation → single space (TS replaces with ' ').
            out.push(' ');
            last_was_space = true;
        }
    }
    if last_was_space {
        out.pop();
    }
    out
}

impl Bm25Index {
    /// Query-time search mirroring `BM25Engine.search` bit-for-bit:
    /// smoothed IDF, k1/b TF saturation, stable score-desc order, ×1.5
    /// phrase boost confined to the top-100 candidates.
    ///
    /// `texts` must be aligned with `doc_ids` (raw display text, used only
    /// for the phrase boost — TS reconstructs `docs` from the index file).
    pub fn search(&self, query: &str, texts: &[String], limit: usize) -> Vec<SearchHit> {
        let query_tokens = tokenize(query);
        if query_tokens.is_empty() {
            return Vec::new();
        }
        debug_assert_eq!(texts.len(), self.doc_ids.len());

        // Insertion order = first encounter while sweeping query tokens in
        // order (duplicates re-add, exactly like TS).
        let mut scores: Vec<(u32, f64)> = Vec::new();
        let mut position: HashMap<u32, usize> = HashMap::new();
        for term in &query_tokens {
            let entry = match self
                .terms
                .binary_search_by_key(&term.as_str(), |e| e.term.as_str())
            {
                Ok(i) => &self.terms[i],
                Err(_) => continue,
            };
            let df = entry.postings.len() as f64;
            let n = self.total_docs as f64;
            let idf = (((n - df + 0.5) / (df + 0.5)) + 1.0).ln();
            for (doc, tf) in &entry.postings {
                let tf = *tf as f64;
                let dl = self.doc_lengths[*doc as usize] as f64;
                let numerator = tf * (BM25_K1 + 1.0);
                let denominator =
                    tf + BM25_K1 * (1.0 - BM25_B + BM25_B * (dl / self.avg_doc_length));
                let term_score = idf * (numerator / denominator);
                match position.get(doc) {
                    Some(&pos) => scores[pos].1 += term_score,
                    None => {
                        position.insert(*doc, scores.len());
                        scores.push((*doc, term_score));
                    }
                }
            }
        }

        // Stable sort, score desc (TS Array.sort is stable).
        scores.sort_by(|a, b| b.1.total_cmp(&a.1));

        // Phrase boost confined to top-100 (CPU guard, mirrors TS).
        let normalized_query = normalize_phrase(query);
        if normalized_query.len() > 5 {
            let window = scores.len().min(100);
            for slot in scores.iter_mut().take(window) {
                let doc_text = texts.get(slot.0 as usize).map(String::as_str).unwrap_or("");
                if normalize_phrase(doc_text).contains(normalized_query.as_str()) {
                    slot.1 *= 1.5;
                }
            }
            let (head, _) = scores.split_at_mut(window);
            head.sort_by(|a, b| b.1.total_cmp(&a.1));
        }

        scores.truncate(limit);
        scores
            .into_iter()
            .map(|(doc, score)| SearchHit { doc, score })
            .collect()
    }
}

/// Built inverted index.
#[derive(Debug)]
pub struct Bm25Index {
    pub total_docs: u64,
    pub avg_doc_length: f64,
    /// Doc IDs in index order (u32 doc numbering).
    pub doc_ids: Vec<String>,
    pub doc_lengths: Vec<u32>,
    /// Terms sorted lexicographically (byte order).
    pub terms: Vec<TermEntry>,
}

#[derive(Debug)]
pub struct TermEntry {
    pub term: String,
    /// Postings sorted by doc id: (doc_id, term_freq).
    pub postings: Vec<(u32, u32)>,
}

impl Bm25Index {
    /// Mirrors `BM25Engine.index` (indexing `bm25Text` when present).
    pub fn build(docs: &[Bm25Doc]) -> Self {
        // Parallel tokenize + per-doc term counts.
        let analyzed: Vec<(usize, Vec<String>, HashMap<String, u32>)> = docs
            .par_iter()
            .enumerate()
            .map(|(i, doc)| {
                let tokens = tokenize(&doc.text);
                let mut counts: HashMap<String, u32> = HashMap::new();
                for t in &tokens {
                    *counts.entry(t.clone()).or_insert(0) += 1;
                }
                (i, tokens, counts)
            })
            .collect();

        let total_docs = docs.len() as u64;
        let mut doc_ids = vec![String::new(); docs.len()];
        let mut doc_lengths = vec![0u32; docs.len()];
        let mut total_length: u64 = 0;
        // BTreeMap keeps terms in byte-lexicographic order (matches TS
        // Object key enumeration for ASCII; JSON export sorts anyway).
        let mut postings: BTreeMap<String, Vec<(u32, u32)>> = BTreeMap::new();

        let mut analyzed = analyzed;
        analyzed.sort_by_key(|(i, _, _)| *i);
        for (i, tokens, counts) in analyzed {
            doc_ids[i] = docs[i].id.clone();
            let len = tokens.len() as u32;
            doc_lengths[i] = len;
            total_length += len as u64;
            let mut terms: Vec<(String, u32)> = counts.into_iter().collect();
            terms.sort_by(|a, b| a.0.cmp(&b.0));
            for (term, tf) in terms {
                postings.entry(term).or_default().push((i as u32, tf));
            }
        }

        let avg_doc_length = if total_docs == 0 {
            0.0
        } else {
            total_length as f64 / total_docs as f64
        };

        let terms = postings
            .into_iter()
            .map(|(term, postings)| TermEntry { term, postings })
            .collect();

        Bm25Index {
            total_docs,
            avg_doc_length,
            doc_ids,
            doc_lengths,
            terms,
        }
    }

    pub fn doc_freq(&self, term: &str) -> Option<usize> {
        self.terms
            .binary_search_by_key(&term, |e| e.term.as_str())
            .ok()
            .map(|i| self.terms[i].postings.len())
    }

    // -- Binary format (v1, little-endian) ---------------------------------
    //
    // magic "BLM1" | u32 version=1 | u64 total_docs | f64 avg_doc_length
    // u64 ndocs | docs: u16 len + bytes (utf-8)
    // u64 ndoc_lengths (= ndocs) | u32 each
    // u64 nterms | per term: u16 len + bytes, u64 df, u64 npostings,
    //   per posting: u32 doc_id, u32 tf

    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"BLM1");
        buf.extend_from_slice(&1u32.to_le_bytes());
        buf.extend_from_slice(&self.total_docs.to_le_bytes());
        buf.extend_from_slice(&self.avg_doc_length.to_le_bytes());
        buf.extend_from_slice(&(self.doc_ids.len() as u64).to_le_bytes());
        for id in &self.doc_ids {
            push_str(&mut buf, id);
        }
        for len in &self.doc_lengths {
            buf.extend_from_slice(&len.to_le_bytes());
        }
        buf.extend_from_slice(&(self.terms.len() as u64).to_le_bytes());
        for term in &self.terms {
            push_str(&mut buf, &term.term);
            buf.extend_from_slice(&(term.postings.len() as u64).to_le_bytes());
            buf.extend_from_slice(&(term.postings.len() as u64).to_le_bytes());
            for (doc, tf) in &term.postings {
                buf.extend_from_slice(&doc.to_le_bytes());
                buf.extend_from_slice(&tf.to_le_bytes());
            }
        }
        buf
    }

    pub fn decode(bytes: &[u8]) -> Result<Self> {
        let mut r = Reader::new(bytes);
        if r.take(4)? != b"BLM1" {
            anyhow::bail!("bad BM25 magic");
        }
        let version = r.u32()?;
        if version != 1 {
            anyhow::bail!("unsupported BM25 version {version}");
        }
        let total_docs = r.u64()?;
        let avg_doc_length = r.f64()?;
        let ndocs = r.u64()? as usize;
        let mut doc_ids = Vec::with_capacity(ndocs);
        for _ in 0..ndocs {
            doc_ids.push(r.str()?.to_string());
        }
        let mut doc_lengths = Vec::with_capacity(ndocs);
        for _ in 0..ndocs {
            doc_lengths.push(r.u32()?);
        }
        let nterms = r.u64()? as usize;
        let mut terms = Vec::with_capacity(nterms);
        for _ in 0..nterms {
            let term = r.str()?.to_string();
            let df = r.u64()? as usize;
            let npostings = r.u64()? as usize;
            let mut postings = Vec::with_capacity(npostings);
            for _ in 0..npostings {
                postings.push((r.u32()?, r.u32()?));
            }
            debug_assert_eq!(df, npostings);
            terms.push(TermEntry { term, postings });
        }
        if !r.eof() {
            anyhow::bail!("trailing bytes in BM25 index");
        }
        Ok(Bm25Index {
            total_docs,
            avg_doc_length,
            doc_ids,
            doc_lengths,
            terms,
        })
    }

    /// JSON export shaped like TS `exportState()` for differential testing:
    /// `{totalDocs, avgDocLength, docFreqs, termFreqs, docLengths}`.
    pub fn export_state_json(&self) -> serde_json::Value {
        let mut doc_freqs = serde_json::Map::new();
        let mut term_freqs = serde_json::Map::new();
        for term in &self.terms {
            doc_freqs.insert(
                term.term.clone(),
                serde_json::Value::from(term.postings.len() as u64),
            );
            let mut per_doc = serde_json::Map::new();
            for (doc, tf) in &term.postings {
                per_doc.insert(self.doc_ids[*doc as usize].clone(), serde_json::Value::from(*tf));
            }
            term_freqs.insert(term.term.clone(), serde_json::Value::Object(per_doc));
        }
        let mut doc_lengths = serde_json::Map::new();
        for (id, len) in self.doc_ids.iter().zip(self.doc_lengths.iter()) {
            doc_lengths.insert(id.clone(), serde_json::Value::from(*len));
        }
        serde_json::json!({
            "totalDocs": self.total_docs,
            "avgDocLength": self.avg_doc_length,
            "docFreqs": doc_freqs,
            "termFreqs": term_freqs,
            "docLengths": doc_lengths,
        })
    }
}

fn push_str(buf: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    assert!(b.len() <= u16::MAX as usize, "string too long for index");
    buf.extend_from_slice(&(b.len() as u16).to_le_bytes());
    buf.extend_from_slice(b);
}

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Reader { b, pos: 0 }
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self.pos.checked_add(n).context("index truncated")?;
        if end > self.b.len() {
            anyhow::bail!("index truncated");
        }
        let s = &self.b[self.pos..end];
        self.pos = end;
        Ok(s)
    }

    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn str(&mut self) -> Result<&'a str> {
        let len = u16::from_le_bytes(self.take(2)?.try_into().unwrap()) as usize;
        std::str::from_utf8(self.take(len)?).context("invalid utf-8 in index")
    }

    fn eof(&self) -> bool {
        self.pos == self.b.len()
    }
}

/// One row of `data/bible-full-index.json`: index `bm25Text` when present.
#[derive(Debug, serde::Deserialize)]
pub struct FullIndexRow {
    #[serde(default)]
    pub text: String,
    #[serde(rename = "bm25Text", default)]
    pub bm25_text: Option<String>,
}

impl FullIndexRow {
    pub fn index_text(&self) -> &str {
        self.bm25_text.as_deref().unwrap_or(&self.text)
    }
}

#[derive(Debug, Serialize)]
pub struct IndexStats {
    pub total_docs: u64,
    pub avg_doc_length: f64,
    pub unique_terms: usize,
    pub total_postings: u64,
    pub binary_bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenizer_matches_ts_examples() {
        // TS: lowercase, keep apostrophes, strip other punctuation, split ws.
        assert_eq!(tokenize("For God so loved"), vec!["for", "god", "so", "loved"]);
        assert_eq!(tokenize("don't stop"), vec!["don't", "stop"]);
        assert_eq!(tokenize("John 3:16 — loved!"), vec!["john", "3", "16", "loved"]);
        assert_eq!(tokenize("  spaced\tout\n"), vec!["spaced", "out"]);
        assert_eq!(tokenize("[John · Chapter 3]"), vec!["john", "chapter", "3"]);
        assert!(tokenize("").is_empty());
        assert!(tokenize("... !!!").is_empty());
    }

    #[test]
    fn build_counts_and_roundtrip() {
        let docs = vec![
            Bm25Doc { id: "A".into(), text: "god loves the world".into() },
            Bm25Doc { id: "B".into(), text: "god is love".into() },
        ];
        let idx = Bm25Index::build(&docs);
        assert_eq!(idx.total_docs, 2);
        assert_eq!(idx.doc_freq("god"), Some(2));
        assert_eq!(idx.doc_freq("world"), Some(1));
        assert_eq!(idx.doc_freq("missing"), None);
        let bytes = idx.encode();
        let back = Bm25Index::decode(&bytes).unwrap();
        assert_eq!(back.total_docs, 2);
        assert_eq!(back.doc_ids, idx.doc_ids);
        assert_eq!(back.doc_lengths, idx.doc_lengths);
        assert_eq!(back.terms.len(), idx.terms.len());
        assert!((back.avg_doc_length - idx.avg_doc_length).abs() < f64::EPSILON);
    }

    #[test]
    fn decode_rejects_garbage() {
        assert!(Bm25Index::decode(b"nope").is_err());
        assert!(Bm25Index::decode(b"BLM1\x01\x00\x00\x00").is_err());
    }

    fn tiny_index() -> (Bm25Index, Vec<String>) {
        let docs = vec![
            Bm25Doc { id: "A".into(), text: "god loves the world".into() },
            Bm25Doc { id: "B".into(), text: "god is love".into() },
            Bm25Doc { id: "C".into(), text: "the world is wide and the world is big".into() },
        ];
        let texts: Vec<String> = docs.iter().map(|d| d.text.clone()).collect();
        (Bm25Index::build(&docs), texts)
    }

    fn ids<'a>(index: &'a Bm25Index, hits: &[SearchHit]) -> Vec<&'a str> {
        hits.iter().map(|h| index.doc_ids[h.doc as usize].as_str()).collect()
    }

    /// Exact scores generated by the TS engine (`BM25Engine.search`):
    /// god world → A 1.0314294108135844, B 0.5562921233843273, C 0.5535004265456638
    /// love → B 1.1609007971087013
    /// god god → B 1.1125842467686546, A 1.0314294108135844 (dupes re-add)
    /// xyz → []
    /// the world is wide and round → C 3.2377141488015764 (phrase-boosted), A, B
    #[test]
    fn search_scores_match_ts_bit_for_bit() {
        let (index, texts) = tiny_index();
        let cases: &[(&str, &[(&str, f64)])] = &[
            ("god world", &[("A", 1.0314294108135844), ("B", 0.5562921233843273), ("C", 0.5535004265456638)]),
            ("love", &[("B", 1.1609007971087013)]),
            ("god god", &[("B", 1.1125842467686546), ("A", 1.0314294108135844)]),
            ("xyz", &[]),
            (
                "the world is wide and round",
                &[("C", 3.2377141488015764), ("A", 1.0314294108135844), ("B", 0.5562921233843273)],
            ),
        ];
        for (query, expected) in cases {
            let hits = index.search(query, &texts, 10);
            assert_eq!(ids(&index, &hits).len(), expected.len(), "query {query:?}");
            for (hit, (id, score)) in hits.iter().zip(expected.iter()) {
                assert_eq!(index.doc_ids[hit.doc as usize].as_str(), *id, "query {query:?}");
                assert!(
                    (hit.score - score).abs() < 1e-12,
                    "query {query:?} doc {id}: rs={} ts={score}",
                    hit.score
                );
            }
        }
    }

    #[test]
    fn search_respects_limit_and_empty_query() {
        let (index, texts) = tiny_index();
        assert!(index.search("", &texts, 10).is_empty());
        assert!(index.search("   ", &texts, 10).is_empty());
        assert_eq!(index.search("god world", &texts, 1).len(), 1);
    }

    #[test]
    fn normalize_phrase_matches_ts() {
        assert_eq!(normalize_phrase("  Hello,  World!  "), "hello world");
        assert_eq!(normalize_phrase("John 3:16 — loved"), "john 3 16 loved");
        assert_eq!(normalize_phrase("don't"), "don't");
    }
}
