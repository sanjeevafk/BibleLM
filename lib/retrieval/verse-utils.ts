/**
 * Pure verse-manipulation utilities — no I/O, no network calls.
 * Safe to import from any module without concern for circular deps.
 */

import type { VerseContext } from '../bible-fetch';

// ---------------------------------------------------------------------------
// Stopwords (used by tokenizer and TSK coverage)
// ---------------------------------------------------------------------------

export const FALLBACK_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'when', 'where', 'which',
  'can', 'could', 'should', 'would', 'does', 'did', 'are', 'is', 'to', 'of', 'in', 'on',
  'a', 'an', 'about', 'christian', 'christians', 'bible', 'say',
]);

export function tokenizeFallbackQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !FALLBACK_STOPWORDS.has(token))
    )
  );
}

// ---------------------------------------------------------------------------
// Reference parsing
// ---------------------------------------------------------------------------

export type ParsedReference = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

export function parseReferenceKey(reference: string): { book: string; chapter: number; verse: number } | null {
  const match = reference.trim().match(/^([A-Z0-9]{3})\s+(\d+):(\d+)/i);
  if (!match) return null;
  return {
    book: match[1].toUpperCase(),
    chapter: Number.parseInt(match[2], 10),
    verse: Number.parseInt(match[3], 10),
  };
}

export function parseReferenceRange(reference: string): ParsedReference | null {
  const match = reference.match(/^([1-3]?[A-Z]{2,3})\s+(\d+):(\d+)(?:[-–](\d+))?$/i);
  if (!match) return null;
  const [, book, chapter, verseStart, verseEnd] = match;
  const start = Number.parseInt(verseStart, 10);
  const end = Number.parseInt(verseEnd || verseStart, 10);
  if (!book || Number.isNaN(start) || Number.isNaN(end)) return null;
  return {
    book: book.toUpperCase(),
    chapter: Number.parseInt(chapter, 10),
    verseStart: start,
    verseEnd: end,
  };
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

export function dedupeVerses(verses: VerseContext[]): VerseContext[] {
  const seen = new Set<string>();
  const deduped: VerseContext[] = [];
  for (const verse of verses) {
    const key = `${verse.reference}|${verse.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(verse);
  }
  return deduped;
}

export function dedupeByVerseId(verses: VerseContext[]): VerseContext[] {
  const seen = new Set<string>();
  const deduped: VerseContext[] = [];
  for (const verse of verses) {
    const key = verse.reference.trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(verse);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

export function cloneVerses(verses: VerseContext[]): VerseContext[] {
  return verses.map((verse) => ({
    ...verse,
    original: verse.original ? verse.original.map((orig) => ({ ...orig })) : [],
  }));
}

// ---------------------------------------------------------------------------
// Grouping / merging sequential verses
// ---------------------------------------------------------------------------

export function mergeLayerText(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n${b}`;
}

export function groupSequentialVerses(verses: VerseContext[]): VerseContext[] {
  const grouped: VerseContext[] = [];
  let current: VerseContext | null = null;
  let currentRef: ParsedReference | null = null;

  const pushCurrent = () => {
    if (current) grouped.push(current);
  };

  for (const verse of verses) {
    const parsed = parseReferenceRange(verse.reference);
    if (!current || !currentRef || !parsed) {
      pushCurrent();
      current = { ...verse, original: verse.original ? [...verse.original] : [] };
      currentRef = parsed;
      continue;
    }

    const canMerge =
      parsed.book === currentRef.book &&
      parsed.chapter === currentRef.chapter &&
      parsed.verseStart === currentRef.verseEnd + 1 &&
      verse.translation === current.translation &&
      Boolean(verse.isCrossReference) === Boolean(current.isCrossReference);

    if (canMerge) {
      currentRef.verseEnd = parsed.verseEnd;
      current.reference = `${currentRef.book} ${currentRef.chapter}:${currentRef.verseStart}-${currentRef.verseEnd}`;
      current.text = `${current.text} ${verse.text}`.replace(/\s+/g, ' ').trim();
      current.original = [...(current.original || []), ...(verse.original || [])];
      current.openHebrew = mergeLayerText(current.openHebrew, verse.openHebrew);
      current.openGnt = mergeLayerText(current.openGnt, verse.openGnt);
    } else {
      pushCurrent();
      current = { ...verse, original: verse.original ? [...verse.original] : [] };
      currentRef = parsed;
    }
  }

  pushCurrent();
  return grouped;
}

export function normalizeVerses(verses: VerseContext[]): VerseContext[] {
  return groupSequentialVerses(dedupeVerses(verses));
}
