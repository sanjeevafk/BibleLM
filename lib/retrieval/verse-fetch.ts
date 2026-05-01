/**
 * All I/O for fetching verse text — PostgreSQL, local translation files,
 * and external API fallbacks. Also includes direct-reference parsing and
 * the API-fallback retrieval path.
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { ensureDbReady, getDbPool } from '../db';
import {
  fetchVerseTextWithFallback,
  type VerseContext,
} from '../bible-fetch';
import { getTranslationVerse } from '../translations';
import { LOCAL_TRANSLATIONS } from './types';
import { parseReferenceKey, cloneVerses } from './verse-utils';
import { applyTopicGuards, applyCuratedTopicalLists } from './topic-guards';
import { enrichOriginalLanguages } from './enrichment';
import { getBM25Engine } from './search';
import type { RetrievalDebugState } from './types';

let bibleIndexCache: Record<string, VerseContext> | null = null;

function shouldUseDb(): boolean {
  if (process.env.BIBLELM_DISABLE_DB === '1') return false;
  return Boolean(process.env.POSTGRES_URL && process.env.POSTGRES_URL.trim());
}

function shouldUseExternalFallback(): boolean {
  return process.env.BIBLELM_DISABLE_EXTERNAL_FALLBACK !== '1';
}

function getBibleIndexPath(): string {
  return path.join(process.cwd(), 'data', 'bible-full-index.json');
}

function getBibleIndex(): Record<string, VerseContext> {
  if (bibleIndexCache) return bibleIndexCache;
  try {
    const raw = fs.readFileSync(getBibleIndexPath(), 'utf8');
    bibleIndexCache = JSON.parse(raw) as Record<string, VerseContext>;
  } catch (error) {
    console.warn('[retrieval] bible-full-index.json load failed; indexed fallback unavailable.', error);
    bibleIndexCache = {};
  }
  return bibleIndexCache;
}

// ---------------------------------------------------------------------------
// Reference key parsing
// ---------------------------------------------------------------------------

export function extractDirectReferences(
  query: string
): Array<{ book: string; chapter: number; verse: number; endVerse?: number }> {
  const results: Array<{ book: string; chapter: number; verse: number; endVerse?: number }> = [];

  const regex = /\b(?:([1-3])\s*)?(Gen|Exo|Lev|Num|Deu|Jos|Jdg|Rut|Sa|Ki|Ch|Ezr|Neh|Est|Job|Ps|Pro|Ecc|Song|Isa|Jer|Lam|Eze|Ezk|Dan|Hos|Joe|Amo|Oba|Jon|Mic|Nah|Hab|Zep|Hag|Zec|Mal|Mat|Mrk|Luk|Jhn|Act|Rom|Cor|Gal|Eph|Phil|Phm|Col|The|Tim|Tit|Heb|Jas|Pet|Jude|Rev)[a-z]*\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\b/gi;

  const bookMap: Record<string, string> = {
    // Law
    'GEN': 'GEN', 'EXO': 'EXO', 'LEV': 'LEV', 'NUM': 'NUM', 'DEU': 'DEU',
    // History
    'JOS': 'JOS', 'JDG': 'JDG', 'RUT': 'RUT', '1SA': '1SA', '2SA': '2SA', '1KI': '1KI', '2KI': '2KI',
    '1CH': '1CH', '2CH': '2CH', 'EZR': 'EZR', 'NEH': 'NEH', 'EST': 'EST',
    // Wisdom
    'JOB': 'JOB', 'PSA': 'PSA', 'PRO': 'PRO', 'ECC': 'ECC', 'SNG': 'SNG',
    // Prophets
    'ISA': 'ISA', 'JER': 'JER', 'LAM': 'LAM', 'EZK': 'EZK', 'EZE': 'EZK', 'DAN': 'DAN',
    'HOS': 'HOS', 'JOL': 'JOL', 'JOE': 'JOL', 'AMO': 'AMO', 'OBA': 'OBA', 'JON': 'JON',
    'MIC': 'MIC', 'NAM': 'NAM', 'NAH': 'NAM', 'HAB': 'HAB', 'ZEP': 'ZEP', 'HAG': 'HAG',
    'ZEC': 'ZEC', 'MAL': 'MAL',
    // Gospels & Acts
    'MAT': 'MAT', 'MRK': 'MRK', 'MAR': 'MRK', 'LUK': 'LUK', 'JHN': 'JHN', 'JOH': 'JHN', 'ACT': 'ACT',
    // Epistles
    'ROM': 'ROM', '1CO': '1CO', '2CO': '2CO', 'GAL': 'GAL', 'EPH': 'EPH', 'PHP': 'PHP', 'PHI': 'PHP',
    'COL': 'COL', '1TH': '1TH', '2TH': '2TH', '1TI': '1TI', '2TI': '2TI', 'TIT': 'TIT', 'PHM': 'PHM',
    'HEB': 'HEB', 'JAS': 'JAS', 'JAM': 'JAS', '1PE': '1PE', '2PE': '2PE', '1JN': '1JN', '2JN': '2JN',
    '3JN': '3JN', 'JUD': 'JUD', 'REV': 'REV',
    // Shorthand Fallbacks
    'PS': 'PSA', 'SAM': '1SA', 'KIN': '1KI', 'CHR': '1CH', 'COR': '1CO', 'THE': '1TH',
    'TIM': '1TI', 'PET': '1PE', '1JO': '1JN', '2JO': '2JN', '3JO': '3JN',
    '1JOH': '1JN', '2JOH': '2JN', '3JOH': '3JN',
    '1JHN': '1JN', '2JHN': '2JN', '3JHN': '3JN',
  };

  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(query)) !== null) {
    const num = match[1] || '';
    const namePart = match[2].toUpperCase().substring(0, 3);
    
    // Attempt lookup with prefix + 3-char name (e.g. '1CO')
    // Fallback to name alone if no numeric prefix found (e.g. 'GEN')
    const key = (num + namePart).trim();
    let bookCode = bookMap[key] || bookMap[namePart] || key;

    // Handle the case where prefix was provided but not in key (e.g. "2 Samuel" -> num=2, namePart=SAM -> key=2SAM)
    // bookMap['2SAM'] is not there, so it falls back to bookMap['SAM'] ('1SA') then we override '1' with '2'.
    if (num && bookCode && bookCode.length === 3 && /^[123]/.test(bookCode)) {
      bookCode = num + bookCode.substring(1);
    } else if (num && bookCode && !/^[123]/.test(bookCode)) {
      // e.g. "1 John" -> num=1, namePart=JOH -> bookMap['JOH']='JHN' -> result '1JHN'
      // We check if a numbered variant exists in our map (like 1JOH -> 1JN)
      const numberedKey = num + bookCode;
      bookCode = bookMap[numberedKey] || (num + bookCode);
    }

    results.push({
      book: bookCode,
      chapter: parseInt(match[3], 10),
      verse: parseInt(match[4], 10),
      endVerse: match[5] ? parseInt(match[5], 10) : undefined,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// DB fetch
// ---------------------------------------------------------------------------

async function fetchVersesByRefs(
  pool: Pool,
  refs: Array<{ book: string; chapter: number; verse: number }>,
  translation: string
): Promise<VerseContext[]> {
  if (refs.length === 0) return [];

  const values: Array<string | number> = [translation];
  const tuples: string[] = [];
  refs.forEach((ref, index) => {
    const base = index * 3;
    tuples.push(`($${base + 2}::text, $${base + 3}::int, $${base + 4}::int)`);
    values.push(ref.book, ref.chapter, ref.verse);
  });

  const result = await pool.query<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
    translation: string;
  }>(
    `WITH refs(book, chapter, verse) AS (VALUES ${tuples.join(', ')})
     SELECT v.book, v.chapter, v.verse, v.text, v.translation
     FROM verses v
     JOIN refs r ON v.book = r.book AND v.chapter = r.chapter AND v.verse = r.verse
     WHERE v.translation = $1;`,
    values,
  );

  return result.rows.map((row) => ({
    reference: `${row.book} ${row.chapter}:${row.verse}`,
    translation: row.translation,
    text: row.text,
    original: [],
  }));
}

// ---------------------------------------------------------------------------
// resolveVerseText — single verse, tries local → index → API
// ---------------------------------------------------------------------------

export async function resolveVerseText(verseId: string, translation: string): Promise<VerseContext | null> {
  // Prefer local translation file first
  if (LOCAL_TRANSLATIONS.has(translation)) {
    const localText = await getTranslationVerse(verseId, translation);
    if (localText) return { reference: verseId, translation, text: localText, original: [] };
  }

  // BSB uses the bundled bible-index.json
  if (translation === 'BSB') {
    const indexed = getBibleIndex()[verseId];
    if (indexed?.text) {
      return {
        reference: verseId,
        translation: 'BSB',
        text: indexed.text,
        original: indexed.original ? indexed.original.map((orig) => ({ ...orig })) : [],
      };
    }
  }

  // External API fallback (optional for deterministic/offline JSON-only runs)
  if (!shouldUseExternalFallback()) {
    return null;
  }

  // External API fallback
  const parsed = parseReferenceKey(verseId);
  if (parsed) {
    const fetched = await fetchVerseTextWithFallback({
      translation,
      reference: verseId,
      book: parsed.book,
      chapter: parsed.chapter,
      startVerse: parsed.verse,
    });
    if (fetched) return { reference: verseId, translation, text: fetched, original: [] };
  }

  return null;
}

// ---------------------------------------------------------------------------
// fetchVersesByIds — bulk fetch with DB-first, API fallback
// ---------------------------------------------------------------------------

export async function fetchVersesByIds(verseIds: string[], translation: string): Promise<VerseContext[]> {
  if (verseIds.length === 0) return [];

  const refs = verseIds
    .map((id) => parseReferenceKey(id))
    .filter((ref): ref is { book: string; chapter: number; verse: number } => Boolean(ref));

  const byId = new Map<string, VerseContext>();

  if (refs.length > 0 && shouldUseDb()) {
    try {
      await ensureDbReady();
      const pool = getDbPool();
      const rows = await fetchVersesByRefs(pool, refs, translation);
      for (const row of rows) byId.set(row.reference, row);
    } catch (error) {
      console.warn('DB verse fetch failed; falling back to local/API', error);
    }
  }

  const unresolvedIds = verseIds.filter((id) => !byId.has(id));
  const resolvedVerses = await Promise.all(
    unresolvedIds.map(async (verseId) => {
      try {
        return await resolveVerseText(verseId, translation);
      } catch (error) {
        console.warn('Verse hydration failed; continuing with remaining verses', { verseId, error });
        return null;
      }
    })
  );

  resolvedVerses.forEach((resolved) => {
    if (resolved) byId.set(resolved.reference, resolved);
  });

  return verseIds.map((id) => byId.get(id)).filter((v): v is VerseContext => Boolean(v));
}

// ---------------------------------------------------------------------------
// applyTranslationOverride
// ---------------------------------------------------------------------------

export async function applyTranslationOverride(verses: VerseContext[], translation: string): Promise<VerseContext[]> {
  if (!LOCAL_TRANSLATIONS.has(translation)) return verses;
  for (const verse of verses) {
    const text = await getTranslationVerse(verse.reference, translation);
    if (text) {
      verse.text = text;
      verse.translation = translation;
    }
  }
  return verses;
}

// ---------------------------------------------------------------------------
// attachIndexedOriginals — attach bundled Strong's from BIBLE_INDEX
// ---------------------------------------------------------------------------

export function attachIndexedOriginals(verses: VerseContext[]): void {
  const index = getBibleIndex();
  for (const verse of verses) {
    const indexed = index[verse.reference];
    if (indexed?.original && indexed.original.length > 0) {
      verse.original = indexed.original.map((orig) => ({ ...orig }));
    }
  }
}

// ---------------------------------------------------------------------------
// fetchContextWindow — retrieve preceding and following verses for a hit
// ---------------------------------------------------------------------------

export async function fetchContextWindow(
  verseId: string,
  translation: string,
  windowSize: number = 1
): Promise<VerseContext[]> {
  const parsed = parseReferenceKey(verseId);
  if (!parsed) return [];

  const refs: string[] = [];
  
  // Calculate window (e.g. -1, 0, +1)
  for (let i = -windowSize; i <= windowSize; i++) {
    const v = parsed.verse + i;
    if (v > 0) {
      refs.push(`${parsed.book} ${parsed.chapter}:${v}`);
    }
  }

  // Bulk fetch these IDs
  // Note: This might span chapters/books in a future upgrade, 
  // but for now we stick to the same chapter.
  return fetchVersesByIds(refs, translation);
}

// ---------------------------------------------------------------------------
// fetchContextWindowsBatch — batch context window fetch (single DB pass)
// ---------------------------------------------------------------------------

/**
 * Retrieves surrounding context verses for multiple verseIds in a single
 * DB/API call, eliminating the N+1 pattern that occurs when fetchContextWindow
 * is called separately inside a .map().
 *
 * For each verseId we expand a window of [verse-windowSize .. verse+windowSize],
 * deduplicate all refs across every ID, then fetch them all at once.
 */
export async function fetchContextWindowsBatch(
  verseIds: string[],
  translation: string,
  windowSize: number = 1
): Promise<VerseContext[]> {
  if (verseIds.length === 0) return [];

  const allRefs = new Set<string>();

  for (const verseId of verseIds) {
    const parsed = parseReferenceKey(verseId);
    if (!parsed) continue;
    for (let i = -windowSize; i <= windowSize; i++) {
      const v = parsed.verse + i;
      if (v > 0) {
        allRefs.add(`${parsed.book} ${parsed.chapter}:${v}`);
      }
    }
  }

  // Single bulk fetch for all window refs across all target verses
  return fetchVersesByIds(Array.from(allRefs), translation);
}

type PassageCandidate = {
  passageId: string;
  anchorVerse: string;
  verseIds: string[];
  score: number;
};

function overlapRatio(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const verseId of setA) {
    if (setB.has(verseId)) intersection += 1;
  }
  return intersection / Math.max(setA.size, setB.size, 1);
}

export function mergeOverlappingPassages(
  candidates: PassageCandidate[],
  overlapThreshold = 0.6
): PassageCandidate[] {
  const merged: PassageCandidate[] = [];

  for (const candidate of candidates) {
    let mergedExisting = false;
    for (let i = 0; i < merged.length; i += 1) {
      const existing = merged[i];
      if (overlapRatio(existing.verseIds, candidate.verseIds) <= overlapThreshold) continue;
      const keepCandidate = candidate.verseIds.length > existing.verseIds.length;
      const winner = keepCandidate ? candidate : existing;
      merged[i] = {
        ...winner,
        score: Math.max(existing.score, candidate.score),
      };
      mergedExisting = true;
      break;
    }
    if (!mergedExisting) merged.push(candidate);
  }

  return merged.sort((a, b) => b.score - a.score);
}

export async function fetchPassageWindowCandidates(
  query: string,
  maxCandidates = 10
): Promise<PassageCandidate[]> {
  if (!shouldUseDb()) {
    return [];
  }
  try {
    await ensureDbReady();
    const pool = getDbPool();
    const q = `%${query.toLowerCase().trim()}%`;
    const result = await pool.query<{
      passage_id: string;
      anchor_verse: string;
      verse_ids: string[];
      vote_total?: number | null;
    }>(
      `SELECT passage_id, anchor_verse, verse_ids, 0::int as vote_total
       FROM passage_windows
       WHERE lower(text) LIKE $1
       ORDER BY passage_id
       LIMIT $2`,
      [q, maxCandidates]
    );

    return result.rows.map((row, index) => ({
      passageId: row.passage_id,
      anchorVerse: row.anchor_verse,
      verseIds: (row.verse_ids ?? []).map((id) => String(id).toUpperCase()),
      score: Math.max(0.01, 1 - (index / Math.max(result.rows.length, 1))),
    }));
  } catch (error) {
    console.warn('[retrieval] Passage candidate query failed; skipping passage retrieval.', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// fallBackBundledLexicalSearch — search using local bible-index.json
// ---------------------------------------------------------------------------

export async function fallbackBundledLexicalSearch(
  query: string,
  translation: string,
  limit = 25
): Promise<VerseContext[]> {
  const engine = await getBM25Engine();
  const hits = engine.search(query, limit);
  const verseIds = hits.map((hit) => hit.doc.id);
  return fetchVersesByIds(verseIds, translation);
}


// ---------------------------------------------------------------------------
// retrieveContextViaApis — fallback when DB has nothing useful
// ---------------------------------------------------------------------------

const tenCommandments: string[] = [
  'EXO 20:3', 'EXO 20:4', 'EXO 20:7', 'EXO 20:8', 'EXO 20:12', 'EXO 20:13', 'EXO 20:14', 'EXO 20:15', 'EXO 20:16', 'EXO 20:17',
];

const freedomFromSlaveryVerses: string[] = [
  'GAL 3:28', 'GAL 4:7', 'ROM 6:6', '1CO 7:22', 'PHM 1:16',
];

export async function retrieveContextViaApis(
  query: string,
  translation: string,
  debugState?: RetrievalDebugState
): Promise<VerseContext[]> {
  const verses: VerseContext[] = [];
  const normalizedQuery = query.toLowerCase();
  const canUseIndex = translation === 'BSB';

  // Priority commandment injection
  const prioritizedRefs: string[] = [];
  const addPriority = (index: number, keywords: string[]) => {
    if (keywords.some((k) => normalizedQuery.includes(k))) {
      const ref = tenCommandments[index];
      if (!prioritizedRefs.includes(ref)) {
        prioritizedRefs.push(ref);
      }
    }
  };

  addPriority(0, ['other gods', 'idolatry', 'idol', 'false gods', 'worship other']);
  addPriority(1, ['graven image', 'carved image', 'image worship', 'idols']);
  addPriority(2, ["take the lord's name", 'blaspheme', 'blasphemy', 'curse god', 'vain name']);
  addPriority(3, ['sabbath', 'rest day']);
  addPriority(4, ['honor father', 'honour father', 'honor mother', 'honour mother', 'disobey parents']);
  addPriority(5, ['murder', 'kill', 'killing', 'homicide']);
  addPriority(6, ['adultery', 'unfaithful spouse', 'cheat on spouse']);
  addPriority(7, ['theft', 'steal', 'stealing', 'rob', 'robbery']);
  addPriority(8, ['false witness', 'perjury', 'lie in court', 'slander']);
  addPriority(9, ['covet', 'coveting', 'envy your neighbor', 'envy thy neighbor']);

  if (prioritizedRefs.length > 0) {
    const hydrated = await fetchVersesByIds(prioritizedRefs, translation);
    // Unshift in reverse order so the ones matched first appear first in the final array
    for (const v of hydrated.slice().reverse()) {
      if (!verses.some(existing => existing.reference === v.reference)) {
        verses.unshift(v);
      }
    }
  }

  const freedomKeywords = ['slavery', 'slave', 'enslaved', 'servant', 'bondservant', 'bond servant', 'bondage', 'doulos', 'freedom from'];
  if (freedomKeywords.some((k) => normalizedQuery.includes(k))) {
    const hydratedFreedom = await fetchVersesByIds(freedomFromSlaveryVerses, translation);
    for (const v of hydratedFreedom.slice().reverse()) {
      if (!verses.some(existing => existing.reference === v.reference)) {
        verses.unshift(v);
      }
    }
  }

  // Direct reference parsing
  const directRefs = extractDirectReferences(query);
  if (directRefs.length > 0) {
    const directVerseResults = await Promise.all(
      directRefs.map(async (ref) => {
        const refKey = `${ref.book} ${ref.chapter}:${ref.verse}`;
        const refStr = `${ref.book} ${ref.chapter}:${ref.verse}${ref.endVerse ? '-' + ref.endVerse : ''}`;
        if (verses.some((v) => v.reference === refKey || v.reference.startsWith(refKey + '-'))) return null;

        const dbMatch = getBibleIndex()[`${ref.book} ${ref.chapter}:${ref.verse}`];
        if (dbMatch && canUseIndex) return cloneVerses([{ ...dbMatch, translation: 'BSB' }])[0];

        if (LOCAL_TRANSLATIONS.has(translation)) {
          const localText = await getTranslationVerse(refStr, translation);
          if (localText) return { reference: refStr, translation, text: localText, original: [] } satisfies VerseContext;
        }

        try {
          const vText = await fetchVerseTextWithFallback({
            translation, reference: refStr, book: ref.book,
            chapter: ref.chapter, startVerse: ref.verse, endVerse: ref.endVerse,
          });
          if (!vText) return null;
          return { reference: refStr, translation, text: vText, original: [] } satisfies VerseContext;
        } catch (error) {
          console.warn('Direct verse hydration failed; continuing with remaining verses', { reference: refStr, error });
          return null;
        }
      })
    );
    verses.push(...directVerseResults.filter((verse): verse is VerseContext => Boolean(verse)));
  }

  // Lexical fallback
  if (verses.length < 2) {
    const lexicalFallback = await fallbackBundledLexicalSearch(query, translation);
    const existingRefs = new Set(verses.map(v => v.reference));
    const newVerses = lexicalFallback.filter(v => !existingRefs.has(v.reference));
    if (newVerses.length > 0) verses.push(...newVerses);
  }

  // Post-process
  const guarded = applyTopicGuards(query, verses, debugState, 'api_fallback');
  const finalVerses = applyCuratedTopicalLists(query, guarded, debugState, 'api_fallback');
  return enrichOriginalLanguages(finalVerses);
}
