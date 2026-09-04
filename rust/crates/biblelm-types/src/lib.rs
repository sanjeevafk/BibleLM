//! Canonical Bible domain types shared by all BibleLM Rust crates.
//!
//! Mirrors the TypeScript sources of truth:
//! - Book codes: `lib/prompts.ts` `BOOK_CODE_TO_NAME`
//! - Alias map: `scripts/build-graph-index.ts` `BOOK_MAP` (see `book_map.rs`)

mod book_map;

use std::fmt;
use std::str::FromStr;

pub use book_map::BOOK_ALIASES;

/// Error type for domain parsing failures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseRefError(pub String);

impl fmt::Display for ParseRefError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid verse reference: {}", self.0)
    }
}

impl std::error::Error for ParseRefError {}

/// Canonical 3-letter book codes in canonical order (66 books).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum BookCode {
    Gen, Exo, Lev, Num, Deu, Jos, Jdg, Rut,
    Sa1, Sa2, Ki1, Ki2, Ch1, Ch2, Ezr, Neh, Est,
    Job, Psa, Pro, Ecc, Sng, Isa, Jer, Lam, Ezk, Dan,
    Hos, Jol, Amo, Oba, Jon, Mic, Nam, Hab, Zep, Hag, Zec, Mal,
    Mat, Mrk, Luk, Jhn, Act, Rom, Co1, Co2, Gal, Eph, Php, Col,
    Th1, Th2, Ti1, Ti2, Tit, Phm, Heb, Jas, Pe1, Pe2,
    Jn1, Jn2, Jn3, Jud, Rev,
}

impl BookCode {
    /// 3-letter code as used in verse IDs (`GEN 1:1`).
    pub fn code(self) -> &'static str {
        match self {
            BookCode::Gen => "GEN", BookCode::Exo => "EXO", BookCode::Lev => "LEV",
            BookCode::Num => "NUM", BookCode::Deu => "DEU", BookCode::Jos => "JOS",
            BookCode::Jdg => "JDG", BookCode::Rut => "RUT", BookCode::Sa1 => "1SA",
            BookCode::Sa2 => "2SA", BookCode::Ki1 => "1KI", BookCode::Ki2 => "2KI",
            BookCode::Ch1 => "1CH", BookCode::Ch2 => "2CH", BookCode::Ezr => "EZR",
            BookCode::Neh => "NEH", BookCode::Est => "EST", BookCode::Job => "JOB",
            BookCode::Psa => "PSA", BookCode::Pro => "PRO", BookCode::Ecc => "ECC",
            BookCode::Sng => "SNG", BookCode::Isa => "ISA", BookCode::Jer => "JER",
            BookCode::Lam => "LAM", BookCode::Ezk => "EZK", BookCode::Dan => "DAN",
            BookCode::Hos => "HOS", BookCode::Jol => "JOL", BookCode::Amo => "AMO",
            BookCode::Oba => "OBA", BookCode::Jon => "JON", BookCode::Mic => "MIC",
            BookCode::Nam => "NAM", BookCode::Hab => "HAB", BookCode::Zep => "ZEP",
            BookCode::Hag => "HAG", BookCode::Zec => "ZEC", BookCode::Mal => "MAL",
            BookCode::Mat => "MAT", BookCode::Mrk => "MRK", BookCode::Luk => "LUK",
            BookCode::Jhn => "JHN", BookCode::Act => "ACT", BookCode::Rom => "ROM",
            BookCode::Co1 => "1CO", BookCode::Co2 => "2CO", BookCode::Gal => "GAL",
            BookCode::Eph => "EPH", BookCode::Php => "PHP", BookCode::Col => "COL",
            BookCode::Th1 => "1TH", BookCode::Th2 => "2TH", BookCode::Ti1 => "1TI",
            BookCode::Ti2 => "2TI", BookCode::Tit => "TIT", BookCode::Phm => "PHM",
            BookCode::Heb => "HEB", BookCode::Jas => "JAS", BookCode::Pe1 => "1PE",
            BookCode::Pe2 => "2PE", BookCode::Jn1 => "1JN", BookCode::Jn2 => "2JN",
            BookCode::Jn3 => "3JN", BookCode::Jud => "JUD", BookCode::Rev => "REV",
        }
    }

    /// Full display name (`lib/prompts.ts` `BOOK_CODE_TO_NAME`).
    pub fn name(self) -> &'static str {
        match self {
            BookCode::Gen => "Genesis", BookCode::Exo => "Exodus", BookCode::Lev => "Leviticus",
            BookCode::Num => "Numbers", BookCode::Deu => "Deuteronomy", BookCode::Jos => "Joshua",
            BookCode::Jdg => "Judges", BookCode::Rut => "Ruth", BookCode::Sa1 => "1 Samuel",
            BookCode::Sa2 => "2 Samuel", BookCode::Ki1 => "1 Kings", BookCode::Ki2 => "2 Kings",
            BookCode::Ch1 => "1 Chronicles", BookCode::Ch2 => "2 Chronicles", BookCode::Ezr => "Ezra",
            BookCode::Neh => "Nehemiah", BookCode::Est => "Esther", BookCode::Job => "Job",
            BookCode::Psa => "Psalms", BookCode::Pro => "Proverbs", BookCode::Ecc => "Ecclesiastes",
            BookCode::Sng => "Song of Songs", BookCode::Isa => "Isaiah", BookCode::Jer => "Jeremiah",
            BookCode::Lam => "Lamentations", BookCode::Ezk => "Ezekiel", BookCode::Dan => "Daniel",
            BookCode::Hos => "Hosea", BookCode::Jol => "Joel", BookCode::Amo => "Amos",
            BookCode::Oba => "Obadiah", BookCode::Jon => "Jonah", BookCode::Mic => "Micah",
            BookCode::Nam => "Nahum", BookCode::Hab => "Habakkuk", BookCode::Zep => "Zephaniah",
            BookCode::Hag => "Haggai", BookCode::Zec => "Zechariah", BookCode::Mal => "Malachi",
            BookCode::Mat => "Matthew", BookCode::Mrk => "Mark", BookCode::Luk => "Luke",
            BookCode::Jhn => "John", BookCode::Act => "Acts", BookCode::Rom => "Romans",
            BookCode::Co1 => "1 Corinthians", BookCode::Co2 => "2 Corinthians", BookCode::Gal => "Galatians",
            BookCode::Eph => "Ephesians", BookCode::Php => "Philippians", BookCode::Col => "Colossians",
            BookCode::Th1 => "1 Thessalonians", BookCode::Th2 => "2 Thessalonians", BookCode::Ti1 => "1 Timothy",
            BookCode::Ti2 => "2 Timothy", BookCode::Tit => "Titus", BookCode::Phm => "Philemon",
            BookCode::Heb => "Hebrews", BookCode::Jas => "James", BookCode::Pe1 => "1 Peter",
            BookCode::Pe2 => "2 Peter", BookCode::Jn1 => "1 John", BookCode::Jn2 => "2 John",
            BookCode::Jn3 => "3 John", BookCode::Jud => "Jude", BookCode::Rev => "Revelation",
        }
    }

    /// All books in canonical order.
    pub fn all() -> [BookCode; 66] {
        [
            BookCode::Gen, BookCode::Exo, BookCode::Lev, BookCode::Num, BookCode::Deu,
            BookCode::Jos, BookCode::Jdg, BookCode::Rut, BookCode::Sa1, BookCode::Sa2,
            BookCode::Ki1, BookCode::Ki2, BookCode::Ch1, BookCode::Ch2, BookCode::Ezr,
            BookCode::Neh, BookCode::Est, BookCode::Job, BookCode::Psa, BookCode::Pro,
            BookCode::Ecc, BookCode::Sng, BookCode::Isa, BookCode::Jer, BookCode::Lam,
            BookCode::Ezk, BookCode::Dan, BookCode::Hos, BookCode::Jol, BookCode::Amo,
            BookCode::Oba, BookCode::Jon, BookCode::Mic, BookCode::Nam, BookCode::Hab,
            BookCode::Zep, BookCode::Hag, BookCode::Zec, BookCode::Mal, BookCode::Mat,
            BookCode::Mrk, BookCode::Luk, BookCode::Jhn, BookCode::Act, BookCode::Rom,
            BookCode::Co1, BookCode::Co2, BookCode::Gal, BookCode::Eph, BookCode::Php,
            BookCode::Col, BookCode::Th1, BookCode::Th2, BookCode::Ti1, BookCode::Ti2,
            BookCode::Tit, BookCode::Phm, BookCode::Heb, BookCode::Jas, BookCode::Pe1,
            BookCode::Pe2, BookCode::Jn1, BookCode::Jn2, BookCode::Jn3, BookCode::Jud,
            BookCode::Rev,
        ]
    }

    /// BSB dataset book names in dataset order (`I Samuel`, `Revelation of John`, …).
    /// Positional mapping is the most robust way to read `BSB.json`.
    pub fn bsb_names() -> [&'static str; 66] {
        [
            "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
            "Joshua", "Judges", "Ruth", "I Samuel", "II Samuel",
            "I Kings", "II Kings", "I Chronicles", "II Chronicles", "Ezra",
            "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
            "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations",
            "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
            "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk",
            "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew",
            "Mark", "Luke", "John", "Acts", "Romans",
            "I Corinthians", "II Corinthians", "Galatians", "Ephesians", "Philippians",
            "Colossians", "I Thessalonians", "II Thessalonians", "I Timothy", "II Timothy",
            "Titus", "Philemon", "Hebrews", "James", "I Peter",
            "II Peter", "I John", "II John", "III John", "Jude",
            "Revelation of John",
        ]
    }

    pub fn from_code(code: &str) -> Option<BookCode> {
        BookCode::all().into_iter().find(|b| b.code() == code)
    }
}

/// Mirrors TS `normalizeBook`: strip non-alphanumeric, lowercase, exact lookup.
pub fn normalize_book(raw: &str) -> Option<BookCode> {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect();
    BOOK_ALIASES
        .binary_search_by_key(&cleaned.as_str(), |(alias, _)| *alias)
        .ok()
        .map(|idx| {
            let code = BOOK_ALIASES[idx].1;
            BookCode::from_code(code).expect("alias table must only contain valid codes")
        })
}

/// A single verse reference: `GEN 1:1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct VerseRef {
    pub book: BookCode,
    pub chapter: u32,
    pub verse: u32,
}

impl VerseRef {
    /// Canonical verse ID string: `GEN 1:1`.
    pub fn id(self) -> String {
        format!("{} {}:{}", self.book.code(), self.chapter, self.verse)
    }
}

impl fmt::Display for VerseRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.id())
    }
}

impl FromStr for VerseRef {
    type Err = ParseRefError;

    /// Parses `GEN 1:1` (strict canonical form).
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let err = || ParseRefError(s.to_string());
        let (book_part, rest) = s.split_once(' ').ok_or_else(err)?;
        let (ch_part, v_part) = rest.split_once(':').ok_or_else(err)?;
        let book = BookCode::from_code(book_part.trim()).ok_or_else(err)?;
        let chapter: u32 = ch_part.trim().parse().map_err(|_| err())?;
        let verse: u32 = v_part.trim().parse().map_err(|_| err())?;
        if chapter == 0 || verse == 0 {
            return Err(err());
        }
        Ok(VerseRef { book, chapter, verse })
    }
}

/// Strong's concordance identifier: `H8674` / `G5624`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct StrongId {
    pub hebrew: bool,
    pub number: u32,
}

impl FromStr for StrongId {
    type Err = ParseRefError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let err = || ParseRefError(s.to_string());
        let (lang, num) = s.split_at_checked(1).ok_or_else(err)?;
        let hebrew = match lang {
            "H" | "h" => true,
            "G" | "g" => false,
            _ => return Err(err()),
        };
        let number: u32 = num.parse().map_err(|_| err())?;
        let max = if hebrew { 8674 } else { 5624 };
        if number == 0 || number > max {
            return Err(err());
        }
        Ok(StrongId { hebrew, number })
    }
}

impl fmt::Display for StrongId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", if self.hebrew { 'H' } else { 'G' }, self.number)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn alias_table_covers_all_66_books() {
        let mut codes: Vec<&str> = BOOK_ALIASES.iter().map(|(_, c)| *c).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), 66, "alias table must resolve all 66 book codes");
        for book in BookCode::all() {
            assert!(codes.contains(&book.code()), "missing {}", book.code());
        }
    }

    #[test]
    fn normalize_book_matches_ts_behavior() {
        assert_eq!(normalize_book("Gen"), Some(BookCode::Gen));
        assert_eq!(normalize_book("gen"), Some(BookCode::Gen));
        assert_eq!(normalize_book("1John"), Some(BookCode::Jn1));
        assert_eq!(normalize_book("1 John"), Some(BookCode::Jn1));
        assert_eq!(normalize_book("Ps"), Some(BookCode::Psa));
        assert_eq!(normalize_book("Song"), Some(BookCode::Sng));
        assert_eq!(normalize_book("Jas"), Some(BookCode::Jas));
        assert_eq!(normalize_book("Hezekiah"), None);
        assert_eq!(normalize_book(""), None);
    }

    #[test]
    fn verse_ref_roundtrip() {
        let r: VerseRef = "JHN 3:16".parse().unwrap();
        assert_eq!(r.book, BookCode::Jhn);
        assert_eq!((r.chapter, r.verse), (3, 16));
        assert_eq!(r.id(), "JHN 3:16");
        assert!("GEN 1:1".parse::<VerseRef>().is_ok());
        assert!("1 JHN 99:99".parse::<VerseRef>().is_err());
        assert!("GEN 0:1".parse::<VerseRef>().is_err());
        assert!("Hezekiah 4:12".parse::<VerseRef>().is_err());
    }

    #[test]
    fn strong_id_bounds() {
        assert!("H8674".parse::<StrongId>().is_ok());
        assert!("G5624".parse::<StrongId>().is_ok());
        assert!("H8675".parse::<StrongId>().is_err());
        assert!("H0".parse::<StrongId>().is_err());
        assert!("X123".parse::<StrongId>().is_err());
    }
}
