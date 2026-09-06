//! Original language morphology and Strong's concordance lookup.
//!
//! Provides instant morphological parsing and dictionary lookup for:
//! - Strong's Concordance (Hebrew H1..H8674, Greek G1..G5624)
//! - MorphHB / Westminster Leningrad Codex (Hebrew Old Testament)
//! - OpenGNT Robinson Morphological Analysis (Greek New Testament)
//!
//! EXPERIMENTAL (deferred full port): the `HebrewMorphAnalysis` and
//! `RobinsonMorphAnalysis` parsers below cover a useful SUBSET of their TS
//! counterparts (`lib/morph-utils.ts`, OpenGNT layers) — several stems,
//! aspects, and all person/gender/number/state decoding are not yet ported,
//! and there are no differential tests against TS. They have no production
//! callers (`lib/retrieval/enrichment.ts` still uses the TS datasets).
//! Treat their output as best-effort until the full port lands.

use anyhow::{bail, Context, Result};
use biblelm_types::normalize_book;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

// ---------------------------------------------------------------------------
// Strong's Dictionary
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StrongsEntry {
    pub id: String,
    pub transliteration: String,
    /// Original-language headword (Hebrew/Aramaic/Greek script).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lexeme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pronunciation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_definition: Option<String>,
    /// Gloss text. NOTE: `data/strongs-dict.json` carries no long-form
    /// `definition` field, so this is `None` for dictionary-built entries
    /// (kept for API compatibility with hand-built entries).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
}

/// Normalizes Strong's IDs like "h1234" or " g3056 " to "H1234" or "G3056".
pub fn normalize_strongs_id(raw: &str) -> String {
    raw.trim().to_uppercase()
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StrongsDictionary {
    entries: HashMap<String, StrongsEntry>,
}

impl StrongsDictionary {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn insert(&mut self, entry: StrongsEntry) {
        let key = normalize_strongs_id(&entry.id);
        self.entries.insert(key, entry);
    }

    pub fn lookup(&self, id: &str) -> Option<&StrongsEntry> {
        let key = normalize_strongs_id(id);
        self.entries.get(&key)
    }

    /// Loads dictionary from JSON string (e.g. `data/strongs-dict.json`,
    /// shaped `{H1|G1: {lexeme, transliteration, pronunciation,
    /// short_definition}}`). All four fields are preserved through the
    /// binary encoding — v1 binaries that kept only transliteration are
    /// rejected on decode (rebuild with `biblelm-build strongs`).
    pub fn from_json_str(json_str: &str) -> Result<Self> {
        let raw_map: HashMap<String, serde_json::Value> = serde_json::from_str(json_str)
            .context("parsing strongs-dict JSON")?;

        let mut dict = StrongsDictionary::new();
        for (id, val) in raw_map {
            let get = |key: &str| {
                val.get(key)
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            };
            dict.insert(StrongsEntry {
                id,
                transliteration: get("transliteration").unwrap_or_default(),
                lexeme: get("lexeme"),
                pronunciation: get("pronunciation"),
                short_definition: get("short_definition"),
                definition: get("definition"),
            });
        }
        Ok(dict)
    }

    // Binary format v2: magic "BLMS" | u32 version=2 | u64 n
    // per entry (sorted by id): u16 len+id, u16 len+transliteration,
    // u16 len+lexeme, u16 len+pronunciation, u16 len+short_definition,
    // u16 len+definition (absent fields encode as empty).

    pub fn encode_binary(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        buf.extend_from_slice(b"BLMS");
        buf.extend_from_slice(&2u32.to_le_bytes());
        buf.extend_from_slice(&(self.entries.len() as u64).to_le_bytes());

        // Deterministic iteration order by key
        let mut sorted_entries: Vec<&StrongsEntry> = self.entries.values().collect();
        sorted_entries.sort_by(|a, b| a.id.cmp(&b.id));

        for entry in sorted_entries {
            push_str16(&mut buf, &entry.id);
            push_str16(&mut buf, &entry.transliteration);
            push_str16(&mut buf, entry.lexeme.as_deref().unwrap_or(""));
            push_str16(&mut buf, entry.pronunciation.as_deref().unwrap_or(""));
            push_str16(&mut buf, entry.short_definition.as_deref().unwrap_or(""));
            push_str16(&mut buf, entry.definition.as_deref().unwrap_or(""));
        }
        buf
    }

    pub fn decode_binary(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < 16 {
            bail!("truncated BLMS header: got {} bytes", bytes.len());
        }
        if &bytes[0..4] != b"BLMS" {
            bail!("invalid BLMS magic header");
        }
        let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
        if version != 2 {
            bail!("unsupported BLMS version: {version} (rebuild with `biblelm-build strongs`)");
        }
        let n = u64::from_le_bytes(bytes[8..16].try_into().unwrap()) as usize;

        let mut offset = 16;
        let mut dict = StrongsDictionary::new();
        let read_field = |offset: &mut usize, what: &str| -> Result<String> {
            if *offset + 2 > bytes.len() {
                bail!("unexpected EOF reading {what} len");
            }
            let len = u16::from_le_bytes(bytes[*offset..*offset + 2].try_into().unwrap()) as usize;
            *offset += 2;
            if *offset + len > bytes.len() {
                bail!("unexpected EOF reading {what} string");
            }
            let s = std::str::from_utf8(&bytes[*offset..*offset + len])
                .with_context(|| format!("invalid utf8 in strongs {what}"))?
                .to_string();
            *offset += len;
            Ok(s)
        };

        for _ in 0..n {
            let id = read_field(&mut offset, "id")?;
            let transliteration = read_field(&mut offset, "transliteration")?;
            let lexeme = read_field(&mut offset, "lexeme")?;
            let pronunciation = read_field(&mut offset, "pronunciation")?;
            let short_definition = read_field(&mut offset, "short definition")?;
            let definition = read_field(&mut offset, "definition")?;

            let none_if_empty = |s: String| if s.is_empty() { None } else { Some(s) };
            dict.insert(StrongsEntry {
                id,
                transliteration,
                lexeme: none_if_empty(lexeme),
                pronunciation: none_if_empty(pronunciation),
                short_definition: none_if_empty(short_definition),
                definition: none_if_empty(definition),
            });
        }
        if offset != bytes.len() {
            bail!("trailing bytes in BLMS index");
        }

        Ok(dict)
    }
}

fn push_str16(buf: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    buf.extend_from_slice(&(b.len() as u16).to_le_bytes());
    buf.extend_from_slice(b);
}

// ---------------------------------------------------------------------------
// Hebrew Morphology (MorphHB / WLC)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HebrewWord {
    #[serde(rename = "t")]
    pub text: String,
    #[serde(rename = "s")]
    pub strongs: String,
    #[serde(rename = "m")]
    pub morph: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HebrewMorphAnalysis {
    pub language: &'static str, // "Hebrew" | "Aramaic"
    pub prefixes: Vec<&'static str>,
    pub pos: &'static str,
    pub stem: Option<&'static str>,
    pub aspect: Option<&'static str>,
    pub raw_code: String,
}

impl HebrewMorphAnalysis {
    /// Parses a MorphHB code like "HR/Ncfsa" or "HVqp3ms".
    ///
    /// EXPERIMENTAL subset: POS + Qal..Hithpael stems + a reduced aspect
    /// set. Person/gender/number/state suffixes and `/`-separated
    /// multi-segments (handled by TS `decodeMorph`) are not decoded yet.
    pub fn parse(code: &str) -> Self {
        let clean = code.trim();
        let is_aramaic = clean.starts_with('A');
        let language = if is_aramaic { "Aramaic" } else { "Hebrew" };

        // Strip leading 'H' or 'A' language prefix if present
        let after_lang = if clean.starts_with('H') || clean.starts_with('A') {
            &clean[1..]
        } else {
            clean
        };

        let mut prefixes = Vec::new();
        let main_part = if let Some((pfx, rest)) = after_lang.split_once('/') {
            // Parse prefixes: C=Conjunction, R=Preposition, d=Article
            for ch in pfx.chars() {
                match ch {
                    'C' => prefixes.push("Conjunction"),
                    'R' => prefixes.push("Preposition"),
                    'd' => prefixes.push("Definite Article"),
                    'i' => prefixes.push("Interrogative"),
                    _ => {}
                }
            }
            rest
        } else {
            after_lang
        };

        // Main part pos: V=Verb, N=Noun, A=Adjective, P=Pronoun, etc.
        let mut pos = "Unknown";
        let mut stem = None;
        let mut aspect = None;

        let chars: Vec<char> = main_part.chars().collect();
        if let Some(&p) = chars.first() {
            match p {
                'V' | 'v' => {
                    pos = "Verb";
                    if chars.len() > 1 {
                        stem = match chars[1] {
                            'q' => Some("Qal"),
                            'n' => Some("Niphal"),
                            'p' => Some("Piel"),
                            'P' => Some("Pual"),
                            'h' => Some("Hiphil"),
                            'H' => Some("Hophal"),
                            't' => Some("Hithpael"),
                            _ => None,
                        };
                    }
                    if chars.len() > 2 {
                        aspect = match chars[2] {
                            'p' => Some("Perfect"),
                            'i' => Some("Imperfect"),
                            'v' => Some("Sequential"),
                            'm' => Some("Imperative"),
                            'a' => Some("Infinitive Absolute"),
                            'c' => Some("Infinitive Construct"),
                            'r' => Some("Participle Active"),
                            's' => Some("Participle Passive"),
                            _ => None,
                        };
                    }
                }
                'N' | 'n' => pos = "Noun",
                'A' | 'a' => pos = "Adjective",
                'P' | 'p' => pos = "Pronoun",
                'R' | 'r' => pos = "Preposition",
                'C' | 'c' => pos = "Conjunction",
                'D' | 'd' => pos = "Adverb",
                'T' | 't' => pos = "Particle",
                _ => {}
            }
        }

        Self {
            language,
            prefixes,
            pos,
            stem,
            aspect,
            raw_code: clean.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HebrewBookData {
    pub chapters: BTreeMap<u32, BTreeMap<u32, Vec<HebrewWord>>>,
}

impl HebrewBookData {
    pub fn from_json_str(json_str: &str) -> Result<Self> {
        let raw: BTreeMap<String, BTreeMap<String, Vec<HebrewWord>>> =
            serde_json::from_str(json_str).context("parsing Hebrew book JSON")?;

        let mut chapters = BTreeMap::new();
        for (ch_str, v_map) in raw {
            let ch: u32 = ch_str.parse().unwrap_or(0);
            if ch == 0 {
                continue;
            }
            let mut verses = BTreeMap::new();
            for (v_str, words) in v_map {
                let v: u32 = v_str.parse().unwrap_or(0);
                if v == 0 {
                    continue;
                }
                verses.insert(v, words);
            }
            chapters.insert(ch, verses);
        }

        Ok(Self { chapters })
    }

    pub fn get_verse(&self, chapter: u32, verse: u32) -> Option<&[HebrewWord]> {
        self.chapters
            .get(&chapter)
            .and_then(|v_map| v_map.get(&verse))
            .map(|v| v.as_slice())
    }
}

// ---------------------------------------------------------------------------
// Greek Morphology (OpenGNT / Robinson)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GreekWord {
    #[serde(rename = "w")]
    pub word: String,
    #[serde(rename = "s", default)]
    pub strongs: Option<String>,
    #[serde(rename = "r", default)]
    pub parsing: Option<String>,
    #[serde(rename = "d", default)]
    pub definition: Option<String>,
    #[serde(rename = "l", default)]
    pub lemma: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GreekInterlinearWord {
    #[serde(rename = "w")]
    pub word: String,
    #[serde(rename = "i", default)]
    pub interlinear: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RobinsonMorphAnalysis {
    pub pos: &'static str,
    pub tense: Option<&'static str>,
    pub voice: Option<&'static str>,
    pub mood: Option<&'static str>,
    pub case: Option<&'static str>,
    pub number: Option<&'static str>,
    pub gender: Option<&'static str>,
    pub person: Option<&'static str>,
    pub raw_code: String,
}

impl RobinsonMorphAnalysis {
    /// Parses Robinson's Morphological Analysis code like "V-AAI-3S" or "N-NSM".
    ///
    /// EXPERIMENTAL subset: core verb/nominal slots only. Extended tags
    /// and edge-case codes beyond the common patterns are best-effort.
    pub fn parse(code: &str) -> Self {
        let clean = code.trim();
        let parts: Vec<&str> = clean.split('-').collect();
        if parts.is_empty() {
            return Self {
                raw_code: clean.to_string(),
                ..Default::default()
            };
        }

        let pos = match parts[0] {
            "V" => "Verb",
            "N" => "Noun",
            "A" => "Adjective",
            "T" => "Definite Article",
            "P" | "R_PRO" => "Pronoun",
            "PREP" => "Preposition",
            "CONJ" => "Conjunction",
            "ADV" => "Adverb",
            "PRT" => "Particle",
            "INJ" => "Interjection",
            _ => "Word",
        };

        let mut tense = None;
        let mut voice = None;
        let mut mood = None;
        let mut case = None;
        let mut number = None;
        let mut gender = None;
        let mut person = None;

        if pos == "Verb" {
            if let Some(tvm) = parts.get(1) {
                let chars: Vec<char> = tvm.chars().collect();
                if let Some(&t) = chars.first() {
                    tense = match t {
                        'P' => Some("Present"),
                        'I' => Some("Imperfect"),
                        'F' => Some("Future"),
                        'A' => Some("Aorist"),
                        'X' => Some("Perfect"),
                        'Y' => Some("Pluperfect"),
                        _ => None,
                    };
                }
                if let Some(&v) = chars.get(1) {
                    voice = match v {
                        'A' => Some("Active"),
                        'M' => Some("Middle"),
                        'P' => Some("Passive"),
                        'E' => Some("Middle/Passive"),
                        _ => None,
                    };
                }
                if let Some(&m) = chars.get(2) {
                    mood = match m {
                        'I' => Some("Indicative"),
                        'S' => Some("Subjunctive"),
                        'O' => Some("Optative"),
                        'M' => Some("Imperative"),
                        'N' => Some("Infinitive"),
                        'P' => Some("Participle"),
                        _ => None,
                    };
                }
            }

            if let Some(pn) = parts.get(2) {
                let chars: Vec<char> = pn.chars().collect();
                if let Some(&p) = chars.first() {
                    person = match p {
                        '1' => Some("1st"),
                        '2' => Some("2nd"),
                        '3' => Some("3rd"),
                        _ => None,
                    };
                }
                if let Some(&n) = chars.get(1) {
                    number = match n {
                        'S' => Some("Singular"),
                        'P' => Some("Plural"),
                        _ => None,
                    };
                }
            }
        } else if matches!(pos, "Noun" | "Adjective" | "Definite Article" | "Pronoun") {
            if let Some(cng) = parts.get(1) {
                let chars: Vec<char> = cng.chars().collect();
                if let Some(&c) = chars.first() {
                    case = match c {
                        'N' => Some("Nominative"),
                        'G' => Some("Genitive"),
                        'D' => Some("Dative"),
                        'A' => Some("Accusative"),
                        'V' => Some("Vocative"),
                        _ => None,
                    };
                }
                if let Some(&n) = chars.get(1) {
                    number = match n {
                        'S' => Some("Singular"),
                        'P' => Some("Plural"),
                        _ => None,
                    };
                }
                if let Some(&g) = chars.get(2) {
                    gender = match g {
                        'M' => Some("Masculine"),
                        'F' => Some("Feminine"),
                        'N' => Some("Neuter"),
                        _ => None,
                    };
                }
            }
        }

        Self {
            pos,
            tense,
            voice,
            mood,
            case,
            number,
            gender,
            person,
            raw_code: clean.to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GreekBookData {
    pub chapters: BTreeMap<u32, BTreeMap<u32, Vec<GreekWord>>>,
}

impl GreekBookData {
    pub fn from_json_str(json_str: &str) -> Result<Self> {
        let raw: BTreeMap<String, BTreeMap<String, Vec<GreekWord>>> =
            serde_json::from_str(json_str).context("parsing Greek book JSON")?;

        let mut chapters = BTreeMap::new();
        for (ch_str, v_map) in raw {
            let ch: u32 = ch_str.parse().unwrap_or(0);
            if ch == 0 {
                continue;
            }
            let mut verses = BTreeMap::new();
            for (v_str, words) in v_map {
                let v: u32 = v_str.parse().unwrap_or(0);
                if v == 0 {
                    continue;
                }
                verses.insert(v, words);
            }
            chapters.insert(ch, verses);
        }

        Ok(Self { chapters })
    }

    pub fn get_verse(&self, chapter: u32, verse: u32) -> Option<&[GreekWord]> {
        self.chapters
            .get(&chapter)
            .and_then(|v_map| v_map.get(&verse))
            .map(|v| v.as_slice())
    }
}

// ---------------------------------------------------------------------------
// Combined Datasets & Formatters (matching lib/retrieval/enrichment.ts)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct MorphDataset {
    pub strongs: StrongsDictionary,
    pub hebrew_books: HashMap<String, HebrewBookData>,
    pub greek_books: HashMap<String, GreekBookData>,
}

impl MorphDataset {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_hebrew_book(&mut self, book_raw: &str, json_str: &str) -> Result<()> {
        let book = normalize_book(book_raw).map(|b| b.code().to_string()).unwrap_or_else(|| book_raw.to_uppercase());
        let data = HebrewBookData::from_json_str(json_str)?;
        self.hebrew_books.insert(book, data);
        Ok(())
    }

    pub fn load_greek_book(&mut self, book_raw: &str, json_str: &str) -> Result<()> {
        let book = normalize_book(book_raw).map(|b| b.code().to_string()).unwrap_or_else(|| book_raw.to_uppercase());
        let data = GreekBookData::from_json_str(json_str)?;
        self.greek_books.insert(book, data);
        Ok(())
    }

    pub fn get_hebrew_verse(&self, book_raw: &str, chapter: u32, verse: u32) -> Option<&[HebrewWord]> {
        let book = normalize_book(book_raw).map(|b| b.code().to_string()).unwrap_or_else(|| book_raw.to_uppercase());
        self.hebrew_books.get(&book)?.get_verse(chapter, verse)
    }

    pub fn get_greek_verse(&self, book_raw: &str, chapter: u32, verse: u32) -> Option<&[GreekWord]> {
        let book = normalize_book(book_raw).map(|b| b.code().to_string()).unwrap_or_else(|| book_raw.to_uppercase());
        self.greek_books.get(&book)?.get_verse(chapter, verse)
    }
}

/// Formats Greek morphology samples matching TypeScript `formatOpenGntLayers`.
pub fn format_opengnt_morphology(words: &[GreekWord]) -> String {
    let samples: Vec<String> = words
        .iter()
        .take(4)
        .map(|w| {
            let mut tags = Vec::new();
            if let Some(s) = &w.strongs {
                if !s.is_empty() {
                    tags.push(s.as_str());
                }
            }
            if let Some(r) = &w.parsing {
                if !r.is_empty() {
                    tags.push(r.as_str());
                }
            }
            if tags.is_empty() {
                w.word.clone()
            } else {
                format!("{} ({})", w.word, tags.join(" "))
            }
        })
        .collect();

    if samples.is_empty() {
        String::new()
    } else {
        format!("Greek morphology: {}", samples.join("; "))
    }
}

/// Formats Hebrew morphology samples.
pub fn format_morphhb_morphology(words: &[HebrewWord]) -> String {
    let samples: Vec<String> = words
        .iter()
        .take(4)
        .map(|w| format!("{} ({})", w.text, w.morph))
        .collect();

    if samples.is_empty() {
        String::new()
    } else {
        format!("Hebrew morphology: {}", samples.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strongs_dictionary_roundtrip() {
        let mut dict = StrongsDictionary::new();
        dict.insert(StrongsEntry {
            id: "H7225".to_string(),
            transliteration: "re'shith".to_string(),
            lexeme: Some("ראשית".to_string()),
            pronunciation: Some("ray-sheeth'".to_string()),
            short_definition: Some("beginning".to_string()),
            definition: None,
        });
        dict.insert(StrongsEntry {
            id: "G3056".to_string(),
            transliteration: "logos".to_string(),
            lexeme: Some("λογος".to_string()),
            pronunciation: None,
            short_definition: None,
            definition: Some("a word, speech, divine utterance".to_string()),
        });

        assert_eq!(dict.len(), 2);
        assert_eq!(dict.lookup("h7225").unwrap().transliteration, "re'shith");
        assert_eq!(dict.lookup("G3056").unwrap().definition.as_deref(), Some("a word, speech, divine utterance"));

        let encoded = dict.encode_binary();
        let decoded = StrongsDictionary::decode_binary(&encoded).expect("decode failed");

        assert_eq!(decoded.len(), 2);
        // Every field survives the binary roundtrip (v1 dropped all but two).
        assert_eq!(decoded.lookup("H7225").unwrap(), dict.lookup("H7225").unwrap());
        assert_eq!(decoded.lookup("G3056").unwrap(), dict.lookup("G3056").unwrap());
        // Legacy v1 binaries are rejected with a rebuild hint.
        let mut v1 = encoded.clone();
        v1[4..8].copy_from_slice(&1u32.to_le_bytes());
        assert!(StrongsDictionary::decode_binary(&v1).is_err());
    }

    #[test]
    fn strongs_json_shape_preserves_all_fields() {
        // Real `data/strongs-dict.json` shape: no long `definition` field.
        let json = r#"{
            "H7225": {"lexeme": "ראשית", "transliteration": "rêʼshîyth", "pronunciation": "ray-sheeth'", "short_definition": "beginning"},
            "G3056": {"lexeme": "λογος", "transliteration": "lógos", "pronunciation": "log'-os", "short_definition": "account"}
        }"#;
        let dict = StrongsDictionary::from_json_str(json).unwrap();
        let h = dict.lookup("H7225").unwrap();
        assert_eq!(h.transliteration, "rêʼshîyth");
        assert_eq!(h.lexeme.as_deref(), Some("ראשית"));
        assert_eq!(h.pronunciation.as_deref(), Some("ray-sheeth'"));
        assert_eq!(h.short_definition.as_deref(), Some("beginning"));

        let back = StrongsDictionary::decode_binary(&dict.encode_binary()).unwrap();
        assert_eq!(back.lookup("H7225").unwrap(), h);
        assert_eq!(back.lookup("G3056").unwrap().lexeme.as_deref(), Some("λογος"));
    }

    #[test]
    fn hebrew_morph_analysis() {
        let parsed = HebrewMorphAnalysis::parse("HR/Ncfsa");
        assert_eq!(parsed.language, "Hebrew");
        assert_eq!(parsed.prefixes, vec!["Preposition"]);
        assert_eq!(parsed.pos, "Noun");

        let verb = HebrewMorphAnalysis::parse("HVqp3ms");
        assert_eq!(verb.pos, "Verb");
        assert_eq!(verb.stem, Some("Qal"));
        assert_eq!(verb.aspect, Some("Perfect"));
    }

    #[test]
    fn robinson_morph_analysis() {
        let verb = RobinsonMorphAnalysis::parse("V-AAI-3S");
        assert_eq!(verb.pos, "Verb");
        assert_eq!(verb.tense, Some("Aorist"));
        assert_eq!(verb.voice, Some("Active"));
        assert_eq!(verb.mood, Some("Indicative"));
        assert_eq!(verb.person, Some("3rd"));
        assert_eq!(verb.number, Some("Singular"));

        let noun = RobinsonMorphAnalysis::parse("N-NSM");
        assert_eq!(noun.pos, "Noun");
        assert_eq!(noun.case, Some("Nominative"));
        assert_eq!(noun.number, Some("Singular"));
        assert_eq!(noun.gender, Some("Masculine"));
    }

    #[test]
    fn formatting_matches_ts() {
        let greek_words = vec![
            GreekWord {
                word: "Ἐν".into(),
                strongs: Some("G1722".into()),
                parsing: Some("PREP".into()),
                definition: None,
                lemma: None,
            },
            GreekWord {
                word: "ἀρχῇ".into(),
                strongs: Some("G746".into()),
                parsing: Some("N-DSF".into()),
                definition: None,
                lemma: None,
            },
        ];

        let formatted = format_opengnt_morphology(&greek_words);
        assert_eq!(formatted, "Greek morphology: Ἐν (G1722 PREP); ἀρχῇ (G746 N-DSF)");
    }
}
