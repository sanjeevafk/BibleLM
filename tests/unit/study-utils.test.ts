import { describe, expect, it } from 'vitest';

import {
  buildPericopeSegments,
  chapterCount,
  findActivePericope,
  isVerseInFocus,
  parseChapterRef,
  parseStudyRef,
  pericopesForChapter,
  toDisplayRef,
  toStudyParam,
  verseCount,
} from '@/lib/study-utils';

const SAMPLE = [
  { id: 'a', title: 'Sending the 72', book: 'LUK', chapter: 10, startVerse: 1, endVerse: 24, reference: 'LUK 10:1-24' },
  { id: 'b', title: 'Good Samaritan', book: 'LUK', chapter: 10, startVerse: 25, endVerse: 37, reference: 'LUK 10:25-37' },
  { id: 'c', title: 'Martha and Mary', book: 'LUK', chapter: 10, startVerse: 38, endVerse: 42, reference: 'LUK 10:38-42' },
  { id: 'other', title: 'Prodigal Son', book: 'LUK', chapter: 15, startVerse: 11, endVerse: 32, reference: 'LUK 15:11-32' },
];

describe('parseStudyRef', () => {
  it('parses dotted deep-link refs', () => {
    expect(parseStudyRef('LUK.10.25')).toEqual({ book: 'LUK', chapter: 10, verse: 25, endVerse: undefined });
  });

  it('parses display refs with ranges', () => {
    expect(parseStudyRef('LUK 10:25-37')).toEqual({ book: 'LUK', chapter: 10, verse: 25, endVerse: 37 });
    expect(parseStudyRef('Luke 10:25')).toEqual({ book: 'LUK', chapter: 10, verse: 25, endVerse: undefined });
  });

  it('rejects unknown books and inverted ranges', () => {
    expect(parseStudyRef('XYZ 10:25')).toBeNull();
    expect(parseStudyRef('LUK 10:37-25')).toBeNull();
    expect(parseStudyRef('not a ref')).toBeNull();
    expect(parseStudyRef('')).toBeNull();
  });
});

describe('parseChapterRef', () => {
  it('parses spaced and dotted chapter refs', () => {
    expect(parseChapterRef('LUK 10')).toEqual({ book: 'LUK', chapter: 10 });
    expect(parseChapterRef('LUK.10')).toEqual({ book: 'LUK', chapter: 10 });
  });

  it('rejects garbage', () => {
    expect(parseChapterRef('LUK')).toBeNull();
    expect(parseChapterRef('ZZZ 10')).toBeNull();
  });
});

describe('canon counts', () => {
  it('knows Luke 10 has 42 verses and 24 chapters', () => {
    expect(verseCount('LUK', 10)).toBe(42);
    expect(chapterCount('LUK')).toBe(24);
    expect(verseCount('PSA', 119)).toBe(176);
  });

  it('returns 0 for unknown books/chapters', () => {
    expect(verseCount('ZZZ', 1)).toBe(0);
    expect(verseCount('LUK', 99)).toBe(0);
    expect(chapterCount('ZZZ')).toBe(0);
  });
});

describe('pericope helpers', () => {
  it('filters and orders pericopes for a chapter', () => {
    const items = pericopesForChapter(SAMPLE, 'LUK', 10);
    expect(items.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('finds the pericope containing a verse', () => {
    const items = pericopesForChapter(SAMPLE, 'LUK', 10);
    expect(findActivePericope(items, 33)?.id).toBe('b');
    expect(findActivePericope(items, 1)?.id).toBe('a');
    expect(findActivePericope(items, 42)?.id).toBe('c');
  });

  it('builds proportional segments that cover the chapter', () => {
    const items = pericopesForChapter(SAMPLE, 'LUK', 10);
    const segments = buildPericopeSegments(items, 42);
    expect(segments).toHaveLength(3);
    const total = segments.reduce((sum, s) => sum + s.widthPct, 0);
    expect(total).toBeCloseTo(100, 5);
    // 13/42 of the chapter for v25-37.
    expect(segments[1].widthPct).toBeCloseTo((13 / 42) * 100, 5);
  });

  it('fills gaps between pericopes with unlabeled segments', () => {
    const segments = buildPericopeSegments([SAMPLE[1]], 42);
    expect(segments).toHaveLength(3);
    expect(segments[0].pericope).toBeNull();
    expect(segments[2].pericope).toBeNull();
    const total = segments.reduce((sum, s) => sum + s.widthPct, 0);
    expect(total).toBeCloseTo(100, 5);
  });

  it('returns a single full-chapter segment when nothing is catalogued', () => {
    const segments = buildPericopeSegments([], 42);
    expect(segments).toHaveLength(1);
    expect(segments[0].widthPct).toBeCloseTo(100, 5);
  });
});

describe('focus helpers', () => {
  it('matches verses inside a citation range', () => {
    expect(isVerseInFocus(30, { verse: 25, endVerse: 37 })).toBe(true);
    expect(isVerseInFocus(24, { verse: 25, endVerse: 37 })).toBe(false);
    expect(isVerseInFocus(25, { verse: 25 })).toBe(true);
    expect(isVerseInFocus(26, { verse: 25 })).toBe(false);
    expect(isVerseInFocus(25, null)).toBe(false);
  });

  it('round-trips deep-link params', () => {
    const ref = { book: 'LUK', chapter: 10, verse: 25, endVerse: 37 };
    expect(toStudyParam(ref)).toBe('LUK.10.25');
    expect(toDisplayRef(ref)).toBe('LUK 10:25-37');
    expect(parseStudyRef(toStudyParam(ref))?.book).toBe('LUK');
  });
});
