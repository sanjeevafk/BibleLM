/**
 * study-utils — pure, environment-agnostic helpers for the Side-by-Side
 * Study Pane. No I/O here so these functions stay unit-testable under node.
 */

export type StudyVerseRef = {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
};

export type PericopeLike = {
  id: string;
  title: string;
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
  reference: string;
};

/** Canonical 3-letter book codes supported by the local datasets. */
const KNOWN_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT',
  '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
  'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
  'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
  'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO',
  'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI',
  'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN',
  '3JN', 'JUD', 'REV',
]);

const OT_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT',
  '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
  'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
  'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
  'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
]);

/** Verse counts per chapter, indexed by book code. Standard Protestant canon. */
const CHAPTER_VERSE_COUNTS: Record<string, number[]> = {
  GEN: [31, 25, 24, 26, 32, 22, 24, 22, 29, 32, 32, 20, 18, 24, 21, 16, 27, 33, 38, 18, 34, 24, 20, 67, 34, 35, 46, 22, 35, 43, 55, 32, 20, 31, 29, 43, 36, 30, 23, 23, 57, 38, 34, 34, 28, 34, 31, 22, 33, 26],
  EXO: [22, 25, 22, 31, 23, 30, 25, 32, 35, 29, 10, 51, 22, 31, 27, 36, 16, 27, 25, 26, 36, 31, 33, 18, 40, 37, 21, 43, 46, 38, 18, 35, 23, 35, 35, 38, 29, 31, 43, 38],
  LEV: [17, 16, 17, 35, 26, 30, 38, 36, 24, 20, 47, 8, 59, 57, 33, 34, 16, 30, 37, 27, 24, 33, 44, 23, 55, 46, 34],
  NUM: [54, 34, 51, 49, 31, 27, 89, 26, 23, 36, 35, 16, 33, 45, 41, 50, 13, 32, 22, 29, 35, 41, 30, 25, 18, 65, 23, 31, 40, 16, 54, 42, 56, 29, 34, 13],
  DEU: [46, 37, 29, 49, 33, 25, 26, 20, 29, 22, 32, 32, 18, 29, 23, 22, 20, 22, 21, 20, 23, 30, 25, 22, 19, 19, 26, 68, 29, 20, 30, 52, 29, 12],
  JOS: [18, 24, 17, 24, 15, 27, 26, 35, 27, 43, 23, 24, 33, 15, 63, 10, 18, 28, 51, 9, 45, 34, 16, 33],
  JDG: [36, 23, 31, 24, 31, 40, 25, 35, 57, 18, 40, 15, 25, 20, 20, 31, 13, 31, 30, 48, 25],
  RUT: [22, 23, 18, 22],
  '1SA': [28, 36, 21, 22, 12, 21, 17, 22, 27, 27, 15, 25, 23, 52, 35, 23, 58, 30, 24, 42, 15, 23, 29, 22, 44, 25, 12, 25, 11, 31, 13],
  '2SA': [27, 32, 39, 12, 25, 23, 29, 18, 13, 19, 27, 31, 39, 33, 37, 23, 29, 33, 43, 26, 22, 51, 39, 25],
  '1KI': [53, 46, 28, 34, 18, 38, 51, 66, 28, 29, 43, 33, 34, 31, 34, 34, 24, 46, 21, 43, 29, 53],
  '2KI': [18, 25, 27, 44, 27, 33, 20, 29, 37, 36, 21, 21, 25, 29, 38, 20, 41, 37, 37, 21, 26, 20, 37, 20, 30],
  '1CH': [54, 55, 24, 43, 41, 66, 40, 40, 44, 14, 47, 41, 14, 17, 29, 43, 27, 17, 19, 8, 30, 19, 32, 31, 31, 32, 34, 21, 30],
  '2CH': [18, 18, 17, 22, 14, 42, 22, 18, 31, 19, 23, 16, 22, 15, 19, 14, 19, 34, 11, 37, 20, 12, 21, 27, 28, 23, 9, 27, 36, 27, 21, 33, 25, 33, 27, 23],
  EZR: [11, 70, 13, 24, 17, 22, 28, 36, 15, 44],
  NEH: [11, 20, 32, 23, 19, 19, 73, 18, 38, 39, 36, 47, 31],
  EST: [22, 23, 15, 17, 14, 14, 10, 17, 32, 3],
  JOB: [22, 13, 26, 21, 27, 30, 21, 22, 35, 22, 20, 25, 28, 22, 35, 22, 16, 21, 29, 29, 34, 30, 17, 25, 6, 14, 23, 28, 25, 31, 40, 22, 33, 37, 16, 33, 24, 41, 30, 32, 26, 17],
  PSA: [6, 12, 8, 8, 12, 10, 17, 9, 20, 18, 7, 8, 6, 7, 5, 11, 15, 50, 14, 9, 13, 31, 6, 10, 22, 12, 14, 9, 11, 12, 24, 11, 22, 22, 28, 12, 40, 22, 13, 17, 13, 11, 5, 26, 17, 11, 9, 14, 20, 23, 19, 9, 6, 7, 23, 13, 11, 11, 17, 12, 8, 12, 11, 10, 13, 20, 7, 35, 36, 5, 24, 20, 28, 23, 10, 12, 20, 72, 13, 19, 16, 8, 18, 12, 13, 17, 7, 18, 52, 17, 16, 15, 5, 23, 11, 13, 12, 9, 9, 5, 8, 28, 22, 35, 45, 48, 43, 13, 31, 7, 10, 10, 9, 8, 18, 19, 2, 29, 176, 7, 8, 9, 4, 8, 5, 6, 5, 6, 8, 8, 3, 18, 3, 3, 21, 26, 9, 8, 24, 13, 10, 7, 12, 15, 21, 10, 20, 14, 9, 6],
  PRO: [33, 22, 35, 27, 23, 35, 27, 36, 18, 32, 31, 28, 25, 35, 33, 33, 28, 24, 29, 30, 31, 29, 35, 34, 28, 28, 27, 28, 27, 33, 31],
  ECC: [18, 26, 22, 16, 20, 12, 29, 17, 18, 20, 10, 14],
  SNG: [17, 17, 11, 16, 16, 12, 13, 14],
  ISA: [31, 22, 26, 6, 30, 13, 25, 22, 21, 34, 16, 6, 22, 32, 9, 14, 14, 7, 25, 6, 17, 25, 18, 23, 12, 21, 13, 29, 24, 33, 9, 20, 24, 17, 10, 22, 38, 22, 8, 31, 29, 25, 28, 28, 25, 13, 15, 22, 26, 11, 23, 15, 12, 17, 13, 12, 21, 14, 21, 22, 11, 12, 19, 12, 25, 24],
  JER: [19, 37, 25, 31, 31, 30, 34, 22, 26, 25, 23, 17, 27, 22, 21, 21, 27, 23, 15, 18, 14, 30, 40, 10, 38, 24, 22, 17, 32, 24, 40, 44, 26, 22, 19, 32, 21, 28, 18, 16, 18, 22, 13, 30, 5, 28, 7, 47, 39, 46, 64, 34],
  LAM: [22, 22, 66, 22, 22],
  EZK: [28, 10, 27, 17, 17, 14, 27, 18, 11, 22, 25, 28, 23, 23, 8, 63, 24, 32, 14, 49, 32, 31, 49, 27, 17, 21, 36, 26, 21, 26, 18, 32, 33, 31, 15, 38, 28, 23, 29, 49, 26, 20, 27, 31, 25, 24, 23, 35],
  DAN: [21, 49, 30, 37, 31, 28, 28, 27, 27, 21, 45, 13],
  HOS: [11, 23, 5, 19, 15, 11, 16, 14, 17, 15, 12, 14, 16, 9],
  JOL: [20, 32, 21],
  AMO: [15, 16, 15, 13, 27, 14, 17, 14, 15],
  OBA: [21],
  JON: [17, 10, 10, 11],
  MIC: [16, 13, 12, 13, 15, 16, 20],
  NAM: [15, 13, 19],
  HAB: [17, 20, 19],
  ZEP: [18, 15, 20],
  HAG: [15, 23],
  ZEC: [21, 13, 10, 14, 11, 15, 14, 23, 17, 12, 17, 14, 9, 21],
  MAL: [14, 17, 18, 6],
  MAT: [25, 23, 17, 25, 48, 34, 29, 34, 38, 42, 30, 50, 58, 36, 39, 28, 27, 35, 30, 34, 46, 46, 39, 51, 46, 75, 66, 20],
  MRK: [45, 28, 35, 41, 43, 56, 37, 38, 50, 52, 33, 44, 37, 72, 47, 20],
  LUK: [80, 52, 38, 44, 39, 49, 50, 56, 62, 42, 54, 59, 35, 35, 32, 31, 37, 43, 48, 47, 38, 71, 56, 53],
  JHN: [51, 25, 36, 54, 47, 71, 53, 59, 41, 42, 57, 50, 38, 31, 27, 33, 26, 40, 42, 31, 25],
  ACT: [26, 47, 26, 37, 42, 15, 60, 40, 43, 48, 30, 25, 52, 28, 41, 40, 34, 28, 41, 38, 40, 30, 35, 27, 27, 32, 44, 31],
  ROM: [32, 29, 31, 25, 21, 23, 25, 39, 33, 21, 36, 21, 14, 23, 33, 27],
  '1CO': [31, 16, 23, 21, 13, 20, 40, 13, 27, 33, 34, 31, 13, 40, 58, 24],
  '2CO': [24, 17, 18, 18, 21, 18, 16, 24, 15, 18, 33, 21, 14],
  GAL: [24, 21, 29, 31, 26, 18],
  EPH: [23, 22, 21, 32, 33, 24],
  PHP: [30, 30, 21, 23],
  COL: [29, 23, 25, 18],
  '1TH': [10, 20, 13, 18, 28],
  '2TH': [12, 17, 18],
  '1TI': [20, 15, 16, 16, 25, 21],
  '2TI': [18, 26, 17, 22],
  TIT: [16, 15, 15],
  PHM: [25],
  HEB: [14, 18, 19, 16, 14, 20, 28, 13, 28, 39, 40, 29, 25],
  JAS: [27, 26, 18, 17, 20],
  '1PE': [25, 25, 22, 19, 14],
  '2PE': [21, 22, 18],
  '1JN': [10, 29, 24, 21, 21],
  '2JN': [13],
  '3JN': [15],
  JUD: [25],
  REV: [20, 29, 22, 11, 14, 17, 17, 13, 21, 11, 19, 17, 18, 20, 8, 21, 18, 24, 21, 15, 27, 21],
};

export function isKnownBook(book: string): boolean {
  return KNOWN_BOOKS.has(book.toUpperCase());
}

export function isOldTestament(book: string): boolean {
  return OT_BOOKS.has(book.toUpperCase());
}

/** Number of chapters in a book (0 when unknown). */
export function chapterCount(book: string): number {
  const counts = CHAPTER_VERSE_COUNTS[book.toUpperCase()];
  return counts ? counts.length : 0;
}

/** Number of verses in a book/chapter (0 when unknown). */
export function verseCount(book: string, chapter: number): number {
  const counts = CHAPTER_VERSE_COUNTS[book.toUpperCase()];
  if (!counts || chapter < 1 || chapter > counts.length) return 0;
  return counts[chapter - 1];
}

function normalizeBookToken(token: string): string | null {
  const cleaned = token.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!cleaned) return null;
  if (KNOWN_BOOKS.has(cleaned)) return cleaned;
  // Allow dotted "LUK" style and common Johannine shorthands.
  const aliases: Record<string, string> = {
    JN: 'JHN', JOH: 'JHN', JOHN: 'JHN',
    MAR: 'MRK', MARK: 'MRK', MATT: 'MAT', MATTHEW: 'MAT',
    LUKE: 'LUK', PS: 'PSA', PSALM: 'PSA', PSALMS: 'PSA',
    SONG: 'SNG', PHIL: 'PHP', JAM: 'JAS',
  };
  const mapped = aliases[cleaned];
  return mapped && KNOWN_BOOKS.has(mapped) ? mapped : null;
}

/**
 * Parses flexible study references:
 *  - "LUK.10.25", "LUK 10:25", "Luke 10:25", "LUK 10:25-37"
 * Returns null when the reference cannot be understood.
 */
export function parseStudyRef(input: string): StudyVerseRef | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Dotted form: BOOK.CHAPTER.VERSE[-END]
  const dotted = trimmed.match(/^([A-Za-z0-9]+)\.(\d+)\.(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (dotted) {
    const book = normalizeBookToken(dotted[1]);
    if (!book) return null;
    const chapter = Number.parseInt(dotted[2], 10);
    const verse = Number.parseInt(dotted[3], 10);
    const endVerse = dotted[4] ? Number.parseInt(dotted[4], 10) : undefined;
    if (!Number.isFinite(chapter) || !Number.isFinite(verse) || chapter < 1 || verse < 1) return null;
    if (endVerse !== undefined && (!Number.isFinite(endVerse) || endVerse < verse)) return null;
    return { book, chapter, verse, endVerse };
  }

  // Spaced form: BOOK CHAPTER:VERSE[-END]
  const spaced = trimmed.match(/^(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (spaced) {
    const book = normalizeBookToken(spaced[1]);
    if (!book) return null;
    const chapter = Number.parseInt(spaced[2], 10);
    const verse = Number.parseInt(spaced[3], 10);
    const endVerse = spaced[4] ? Number.parseInt(spaced[4], 10) : undefined;
    if (!Number.isFinite(chapter) || !Number.isFinite(verse) || chapter < 1 || verse < 1) return null;
    if (endVerse !== undefined && (!Number.isFinite(endVerse) || endVerse < verse)) return null;
    return { book, chapter, verse, endVerse };
  }

  return null;
}

/** Parses a "BOOK chapter" pair such as "LUK 10" or "LUK.10". */
export function parseChapterRef(input: string): { book: string; chapter: number } | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const dotted = trimmed.match(/^([A-Za-z0-9]+)\.(\d+)$/);
  const spaced = trimmed.match(/^(.+?)\s+(\d+)$/);
  const match = dotted || spaced;
  if (!match) return null;
  const book = normalizeBookToken(match[1]);
  if (!book) return null;
  const chapter = Number.parseInt(match[2], 10);
  if (!Number.isFinite(chapter) || chapter < 1) return null;
  return { book, chapter };
}

/** Canonical deep-link form: "LUK.10.25". */
export function toStudyParam(ref: StudyVerseRef): string {
  return `${ref.book}.${ref.chapter}.${ref.verse}`;
}

/** Canonical display form: "LUK 10:25-37". */
export function toDisplayRef(ref: StudyVerseRef): string {
  const base = `${ref.book} ${ref.chapter}:${ref.verse}`;
  return ref.endVerse && ref.endVerse !== ref.verse ? `${base}-${ref.endVerse}` : base;
}

/** All pericopes belonging to a chapter, ordered by start verse. */
export function pericopesForChapter<T extends PericopeLike>(
  pericopes: T[],
  book: string,
  chapter: number
): T[] {
  const upper = book.toUpperCase();
  return pericopes
    .filter((p) => p.book.toUpperCase() === upper && p.chapter === chapter)
    .sort((a, b) => a.startVerse - b.startVerse);
}

/** Finds the pericope containing a verse, or null. */
export function findActivePericope<T extends PericopeLike>(
  pericopes: T[],
  verse: number
): T | null {
  for (const p of pericopes) {
    if (verse >= p.startVerse && verse <= p.endVerse) return p;
  }
  return null;
}

export type PericopeSegment<T extends PericopeLike = PericopeLike> = {
  pericope: T | null;
  title: string;
  startVerse: number;
  endVerse: number;
  /** Proportional width in percent of the whole chapter. */
  widthPct: number;
};

/**
 * Builds proportional story-map segments for a chapter. Gaps between
 * pericopes become unlabeled segments so widths always sum to ~100%.
 */
export function buildPericopeSegments<T extends PericopeLike>(
  pericopes: T[],
  totalVerses: number
): PericopeSegment<T>[] {
  if (!Number.isFinite(totalVerses) || totalVerses <= 0) return [];
  const ordered = [...pericopes].sort((a, b) => a.startVerse - b.startVerse);
  const segments: PericopeSegment<T>[] = [];
  let cursor = 1;

  const pushGap = (start: number, end: number) => {
    if (end < start) return;
    segments.push({
      pericope: null,
      title: `v${start}–${end}`,
      startVerse: start,
      endVerse: end,
      widthPct: ((end - start + 1) / totalVerses) * 100,
    });
  };

  for (const p of ordered) {
    const start = Math.max(1, Math.min(p.startVerse, totalVerses));
    const end = Math.max(start, Math.min(p.endVerse, totalVerses));
    if (start > cursor) pushGap(cursor, Math.min(start - 1, totalVerses));
    segments.push({
      pericope: p,
      title: p.title,
      startVerse: start,
      endVerse: end,
      widthPct: ((end - start + 1) / totalVerses) * 100,
    });
    cursor = Math.max(cursor, end + 1);
  }
  if (cursor <= totalVerses) pushGap(cursor, totalVerses);
  if (segments.length === 0) pushGap(1, totalVerses);
  return segments;
}

/** True when a verse falls inside the focused range (citation or pericope). */
export function isVerseInFocus(
  verse: number,
  focus: { verse: number; endVerse?: number } | null | undefined
): boolean {
  if (!focus) return false;
  const end = focus.endVerse ?? focus.verse;
  return verse >= focus.verse && verse <= end;
}
