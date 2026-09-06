//! BibleLM retrieval pipeline utilities:
//! - Reciprocal Rank Fusion (RRF) for lexical and semantic rank combination
//! - Linear-time citation scrubber ensuring strict scriptural fidelity

use biblelm_types::normalize_book;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion (RRF)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RrfHit {
    #[serde(rename = "verseId")]
    pub verse_id: String,
    pub score: f64,
}

/// Fuses lexical and semantic search results using Reciprocal Rank Fusion.
///
/// Formula matches `lib/retrieval/search.ts:fuseWithRrf`:
/// `lexical_rank` is 1-indexed.
/// `semantic_rank` is 1-indexed (or 0 contribution if not present).
/// `score = (1 / (rrf_k + lexical_rank)) + (semantic_rank ? 1 / (rrf_k + semantic_rank) : 0)`.
pub fn fuse_lexical_semantic_rrf(
    lexical: &[String],
    semantic: &[String],
    rrf_k: f64,
) -> Vec<RrfHit> {
    let mut semantic_rank_map = std::collections::HashMap::with_capacity(semantic.len());
    for (i, id) in semantic.iter().enumerate() {
        semantic_rank_map.insert(id.as_str(), (i + 1) as f64);
    }

    let mut fused: Vec<RrfHit> = lexical
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let lexical_rank = (i + 1) as f64;
            let lexical_contrib = 1.0 / (rrf_k + lexical_rank);
            let semantic_contrib = match semantic_rank_map.get(id.as_str()) {
                Some(&sem_rank) => 1.0 / (rrf_k + sem_rank),
                None => 0.0,
            };
            RrfHit {
                verse_id: id.clone(),
                score: lexical_contrib + semantic_contrib,
            }
        })
        .collect();

    // Stable sort descending by score
    fused.sort_by(|a, b| b.score.total_cmp(&a.score));
    fused
}

/// Multi-list Reciprocal Rank Fusion for combining arbitrary N result sets.
///
/// Matches `lib/retrieval/pipeline.ts`:
/// For each list, rank is 0-indexed; `rrf_inc = 1.0 / (rrf_k + rank + 1)`.
pub fn fuse_multi_rrf(lists: &[&[String]], rrf_k: f64) -> Vec<RrfHit> {
    let mut score_map = std::collections::HashMap::new();
    let mut order = Vec::new();

    for list in lists {
        for (rank, item) in list.iter().enumerate() {
            let key = item.trim().to_uppercase();
            let rrf_inc = 1.0 / (rrf_k + (rank + 1) as f64);
            let entry = score_map.entry(key.clone()).or_insert_with(|| {
                order.push(key.clone());
                0.0
            });
            *entry += rrf_inc;
        }
    }

    let mut results: Vec<RrfHit> = order
        .into_iter()
        .map(|id| {
            let score = score_map[&id];
            RrfHit {
                verse_id: id,
                score,
            }
        })
        .collect();

    results.sort_by(|a, b| b.score.total_cmp(&a.score));
    results
}

// ---------------------------------------------------------------------------
// Linear-Time Citation Scrubber
// ---------------------------------------------------------------------------

fn citation_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(
            r"\b(?:[1-3][A-Za-z]{2,3}|[A-Za-z]{2,3}|[1-3]\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+\d+:\d+(?:[-–]\d+)?\b"
        ).expect("valid citation regex")
    })
}

pub fn normalize_citation_token(citation: &str) -> String {
    let trimmed = citation.trim();
    let stripped = trimmed.trim_end_matches(['(', ')', '[', ']', ',', '.', ';', ':', '!', '?']);
    // Collapse multiple whitespace
    let mut res = String::new();
    let mut prev_space = false;
    for c in stripped.chars() {
        if c.is_whitespace() {
            if !prev_space {
                res.push(' ');
                prev_space = true;
            }
        } else {
            res.push(c);
            prev_space = false;
        }
    }
    res
}

pub fn expand_citation_reference(reference: &str) -> String {
    let trimmed = reference.trim();
    if let Some((book_raw, rest)) = trimmed.split_once(char::is_whitespace) {
        if let Some(book) = normalize_book(book_raw) {
            return format!("{} {}", book.name(), rest.trim());
        }
    }
    trimmed.to_string()
}

pub fn build_citation_whitelist_set(allowed_references: &[&str]) -> HashSet<String> {
    let mut whitelist = HashSet::new();
    for &ref_str in allowed_references {
        let norm = normalize_citation_token(ref_str);
        if !norm.is_empty() {
            whitelist.insert(norm.to_lowercase());
            let expanded = expand_citation_reference(&norm);
            whitelist.insert(expanded.to_lowercase());
        }
    }
    whitelist
}

pub fn extract_citations(content: &str) -> Vec<String> {
    citation_regex()
        .find_iter(content)
        .map(|m| normalize_citation_token(m.as_str()))
        .collect()
}

fn is_allowed_citation(citation: &str, whitelist: &HashSet<String>) -> bool {
    let norm = normalize_citation_token(citation);
    if norm.is_empty() {
        return true;
    }
    let lower = norm.to_lowercase();
    if whitelist.contains(&lower) {
        return true;
    }
    let expanded = expand_citation_reference(&norm).to_lowercase();
    whitelist.contains(&expanded)
}

fn strip_bracketed_citation_segments(
    content: &str,
    citation: &str,
    opening: char,
    closing: char,
) -> String {
    if citation.is_empty() {
        return content.to_string();
    }

    let mut result = content.to_string();
    let mut search_start = 0;

    while search_start < result.len() {
        let citation_index = match result[search_start..].find(citation) {
            Some(idx) => search_start + idx,
            None => break,
        };

        let opening_index = result[..citation_index].rfind(opening);
        if let Some(open_idx) = opening_index {
            if let Some(first_close) = result[open_idx..].find(closing) {
                let first_close_idx = open_idx + first_close;
                if first_close_idx < citation_index {
                    search_start = citation_index + citation.len();
                    continue;
                }
            }
        }

        let closing_index = result[citation_index + citation.len()..]
            .find(closing)
            .map(|idx| citation_index + citation.len() + idx);

        if let (Some(open_idx), Some(close_idx)) = (opening_index, closing_index) {
            let segment = &result[open_idx + 1..close_idx];
            if segment.contains(citation) {
                let mut new_res = String::with_capacity(result.len());
                new_res.push_str(&result[..open_idx]);
                new_res.push_str(&result[close_idx + closing.len_utf8()..]);
                result = new_res;
                search_start = open_idx;
                continue;
            }
        }
        search_start = citation_index + citation.len();
    }

    result
}

fn strip_empty_citation_delimiters(content: &str) -> String {
    let mut result = content.to_string();
    let mut changed = true;
    while changed {
        changed = false;
        for pair in ["()", "[]"] {
            if result.contains(pair) {
                result = result.replace(pair, "");
                changed = true;
            }
        }
    }
    result
}

fn collapse_repeated_spaces_per_line(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut prev_was_space = false;
    for c in value.chars() {
        if c == ' ' || c == '\t' {
            if !prev_was_space {
                result.push(' ');
                prev_was_space = true;
            }
        } else {
            result.push(c);
            prev_was_space = false;
        }
    }
    result
}

fn collapse_blank_lines(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut consecutive_newlines = 0;
    for c in value.chars() {
        if c == '\n' {
            consecutive_newlines += 1;
            if consecutive_newlines <= 2 {
                result.push(c);
            }
        } else {
            consecutive_newlines = 0;
            result.push(c);
        }
    }
    result
}

fn remove_space_before_citation_punctuation(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    for c in value.chars() {
        if matches!(c, ',' | '.' | ';' | ':' | '!' | '?') && result.ends_with(' ') {
            result.pop();
        }
        result.push(c);
    }
    result
}

/// Returns the invalid citations that `scrub_invalid_citations` would remove,
/// deduplicated and sorted. Used by hosts to emit whitelist-enforcement
/// telemetry without reimplementing extraction.
pub fn find_invalid_citations(content: &str, allowed_references: &[&str]) -> Vec<String> {
    let whitelist = build_citation_whitelist_set(allowed_references);
    let citations = extract_citations(content);
    if citations.is_empty() {
        return Vec::new();
    }
    if whitelist.is_empty() {
        let mut all = citations;
        all.sort();
        all.dedup();
        return all;
    }
    let mut invalid: Vec<String> = citations
        .into_iter()
        .filter(|c| !is_allowed_citation(c, &whitelist))
        .collect();
    invalid.sort();
    invalid.dedup();
    invalid
}
/// Removes any biblical citations from `content` that are not present in `allowed_references`.
///
/// Preserves valid citations (both abbreviated e.g. `JHN 3:16` and expanded e.g. `John 3:16`),
/// strips empty brackets and delimiters, and normalizes resulting whitespace.
pub fn scrub_invalid_citations(content: &str, allowed_references: &[&str]) -> String {
    let whitelist = build_citation_whitelist_set(allowed_references);
    let citations = extract_citations(content);
    if citations.is_empty() {
        return content.to_string();
    }

    let mut invalid_citations: Vec<String> = if whitelist.is_empty() {
        citations
    } else {
        citations
            .into_iter()
            .filter(|c| !is_allowed_citation(c, &whitelist))
            .collect()
    };

    // Deduplicate
    invalid_citations.sort();
    invalid_citations.dedup();

    if invalid_citations.is_empty() {
        return content.to_string();
    }

    let mut sanitized = content.to_string();
    for citation in &invalid_citations {
        sanitized = strip_bracketed_citation_segments(&sanitized, citation, '(', ')');
        sanitized = strip_bracketed_citation_segments(&sanitized, citation, '[', ']');
        sanitized = sanitized.replace(citation, "");
    }

    sanitized = strip_empty_citation_delimiters(&sanitized);
    sanitized = collapse_repeated_spaces_per_line(&sanitized);
    sanitized = collapse_blank_lines(&sanitized);
    sanitized = remove_space_before_citation_punctuation(&sanitized).trim().to_string();

    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fuse_lexical_semantic_rrf() {
        let lexical = vec!["GEN 1:1".to_string(), "PSA 23:1".to_string(), "JHN 3:16".to_string()];
        let semantic = vec!["JHN 3:16".to_string(), "GEN 1:1".to_string()];

        let fused = fuse_lexical_semantic_rrf(&lexical, &semantic, 60.0);
        assert_eq!(fused.len(), 3);
        // JHN 3:16: lex rank 3 (1/63 = 0.01587), sem rank 1 (1/61 = 0.01639) => 0.03226
        // GEN 1:1:  lex rank 1 (1/61 = 0.01639), sem rank 2 (1/62 = 0.01612) => 0.03251
        // GEN 1:1 should be top
        assert_eq!(fused[0].verse_id, "GEN 1:1");
        assert_eq!(fused[1].verse_id, "JHN 3:16");
        assert_eq!(fused[2].verse_id, "PSA 23:1");
    }

    #[test]
    fn test_fuse_multi_rrf() {
        let list1 = ["GEN 1:1".to_string(), "ROM 8:28".to_string()];
        let list2 = ["ROM 8:28".to_string(), "GEN 1:1".to_string()];
        let fused = fuse_multi_rrf(&[&list1, &list2], 60.0);

        assert_eq!(fused.len(), 2);
        // Both have rank 0 in one list and rank 1 in the other, so scores are equal
        assert!((fused[0].score - fused[1].score).abs() < 1e-12);
    }

    // Mirroring tests/unit/scrubInvalidCitations.test.ts:

    #[test]
    fn keeps_valid_citation() {
        let input = "God loved the world [JHN 3:16].";
        assert_eq!(scrub_invalid_citations(input, &["JHN 3:16"]), input);
    }

    #[test]
    fn keeps_multiple_valid_citations() {
        let input = "See [JHN 3:16] and [ROM 8:28].";
        assert_eq!(scrub_invalid_citations(input, &["JHN 3:16", "ROM 8:28"]), input);
    }

    #[test]
    fn case_insensitive_match() {
        let input = "See [jhn 3:16].";
        assert_eq!(scrub_invalid_citations(input, &["JHN 3:16"]), input);
    }

    #[test]
    fn removes_invalid_citation() {
        let input = "Unsubstantiated claim [MAT 5:3].";
        let result = scrub_invalid_citations(input, &["JHN 3:16"]);
        assert!(!result.contains("[MAT 5:3]"));
        assert!(result.contains("Unsubstantiated claim"));
    }

    #[test]
    fn removes_multiple_phantom_citations() {
        let input = "See [JHN 3:16] and [ROM 8:28].";
        let result = scrub_invalid_citations(input, &[]);
        assert!(!result.contains("[JHN 3:16]"));
        assert!(!result.contains("[ROM 8:28]"));
    }

    #[test]
    fn removes_invalid_while_preserving_valid() {
        let input = "Valid [JHN 3:16] and phantom [MAT 5:3].";
        let result = scrub_invalid_citations(input, &["JHN 3:16"]);
        assert!(result.contains("[JHN 3:16]"));
        assert!(!result.contains("[MAT 5:3]"));
    }

    #[test]
    fn edge_cases() {
        assert_eq!(scrub_invalid_citations("No citations here at all.", &["JHN 3:16"]), "No citations here at all.");
        assert_eq!(scrub_invalid_citations("", &["JHN 3:16"]), "");
        assert_eq!(scrub_invalid_citations("Some text with (parens) and {braces}.", &[]), "Some text with (parens) and {braces}.");
    }

    #[test]
    fn find_invalid_lists_what_scrub_removes() {
        let input = "Valid [JHN 3:16] and phantom [MAT 5:3] and again [MAT 5:3].";
        let invalid = find_invalid_citations(input, &["JHN 3:16"]);
        assert_eq!(invalid, vec!["MAT 5:3".to_string()]);
        assert!(find_invalid_citations(input, &["JHN 3:16", "MAT 5:3"]).is_empty());
        assert!(find_invalid_citations("No citations.", &[]).is_empty());
    }
}
