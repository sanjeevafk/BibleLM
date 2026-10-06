/**
 * study-compact — pure transforms that merge raw interlinear datasets into
 * compact per-chapter token files served as static assets.
 *
 * NT input:  OpenGNT morph book `{ ch: { v: [{ w, s, r, d, l }] } }` plus
 *            interlinear book `{ ch: { v: [{ w, i }] } }`.
 * OT input:  MorphHB book `{ ch: { v: [{ t, s, m }] } }` plus Strong's dict.
 * Output:    `{ verses: { "25": [{ w, s, m?, tr?, g? }] } }`.
 *
 * No I/O here — the build script and unit tests share these functions.
 */

export type CompactToken = {
  /** Original script word. */
  w: string;
  /** Normalized Strong's id, e.g. "G4541" / "H7225". */
  s: string;
  /** Morphology code, e.g. "A-NSM" / "HR/Ncfsa". */
  m?: string;
  /** Transliteration. */
  tr?: string;
  /** Contextual gloss / short definition. */
  g?: string;
};

export type CompactChapter = {
  verses: Record<string, CompactToken[]>;
};

type MorphWord = { w?: string; s?: string; r?: string; l?: string };
type InterlinearWord = { w?: string; i?: string };
type MorphHbWord = { t?: string; s?: string; m?: string };
type StrongsMini = { transliteration?: string; short_definition?: string; definition?: string };

function normalizeStrongs(raw: string | undefined, testament: 'NT' | 'OT'): string {
  const upper = (raw || '').trim().toUpperCase();
  if (!upper) return '';
  if (/^[HG]\d+$/.test(upper)) return upper;
  if (/^\d+$/.test(upper)) return `${testament === 'NT' ? 'G' : 'H'}${upper}`;
  return upper;
}

function cleanGloss(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-') return undefined;
  const cleaned = trimmed.replace(/^[,.;:!?]+|[,.;:!?]+$/g, '').trim();
  return cleaned || undefined;
}

/** Merges one NT chapter of OpenGNT morph + interlinear layers. */
export function compactNtChapter(
  morphBook: Record<string, Record<string, MorphWord[]>>,
  interlinearBook: Record<string, Record<string, InterlinearWord[]>> | null,
  chapter: number
): CompactChapter {
  const morphChapter = morphBook?.[String(chapter)] ?? {};
  const interlinearChapter = interlinearBook?.[String(chapter)] ?? {};
  const verses: Record<string, CompactToken[]> = {};

  for (const [verse, words] of Object.entries(morphChapter)) {
    if (!Array.isArray(words)) continue;
    const glosses = interlinearChapter[verse] ?? [];
    const tokens: CompactToken[] = [];
    for (let idx = 0; idx < words.length; idx += 1) {
      const word = words[idx];
      const strongs = normalizeStrongs(word?.s, 'NT');
      if (!word?.w || !strongs) continue;
      const aligned = glosses[idx]?.w === word.w ? glosses[idx]?.i : glosses.find((g) => g.w === word.w)?.i;
      const token: CompactToken = { w: word.w, s: strongs };
      if (word.r) token.m = word.r;
      if (word.l) token.tr = word.l;
      const gloss = cleanGloss(aligned);
      if (gloss) token.g = gloss;
      tokens.push(token);
    }
    if (tokens.length > 0) verses[verse] = tokens;
  }
  return { verses };
}

/** Merges one OT chapter of MorphHB words with Strong's glosses. */
export function compactOtChapter(
  morphBook: Record<string, Record<string, MorphHbWord[]>>,
  strongsDict: Record<string, StrongsMini> | null,
  chapter: number
): CompactChapter {
  const morphChapter = morphBook?.[String(chapter)] ?? {};
  const verses: Record<string, CompactToken[]> = {};

  for (const [verse, words] of Object.entries(morphChapter)) {
    if (!Array.isArray(words)) continue;
    const tokens: CompactToken[] = [];
    for (const word of words) {
      const strongs = normalizeStrongs(word?.s, 'OT');
      if (!word?.t || !strongs) continue;
      const token: CompactToken = { w: word.t, s: strongs };
      if (word.m) token.m = word.m;
      const entry = strongsDict?.[strongs];
      if (entry?.transliteration) token.tr = entry.transliteration;
      const gloss = entry?.short_definition || entry?.definition;
      if (gloss) token.g = gloss;
      tokens.push(token);
    }
    if (tokens.length > 0) verses[verse] = tokens;
  }
  return { verses };
}
