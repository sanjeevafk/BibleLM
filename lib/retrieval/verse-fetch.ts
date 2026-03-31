/**
 * All I/O for fetching verse text — PostgreSQL, local translation files,
 * and external API fallbacks. Also includes direct-reference parsing and
 * the API-fallback retrieval path.
 */

import { Pool } from 'pg';
import { ensureDbReady, getDbPool } from '../db';
import {
  fetchVerseTextWithFallback,
  type VerseContext,
} from '../bible-fetch';
import { getTranslationVerse } from '../translations';
import bibleIndexData from '../../data/bible-index.json';
import { LOCAL_TRANSLATIONS } from './types';
import { parseReferenceKey, cloneVerses } from './verse-utils';
import { applyTopicGuards, applyCuratedTopicalLists } from './topic-guards';
import { enrichOriginalLanguages } from './enrichment';
import { getLexicalFuse } from './search';
import type { RetrievalDebugState } from './types';

const BIBLE_INDEX = bibleIndexData as Record<string, VerseContext>;

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
    const indexed = BIBLE_INDEX[verseId];
    if (indexed?.text) {
      return {
        reference: verseId,
        translation: 'BSB',
        text: indexed.text,
        original: indexed.original ? indexed.original.map((orig) => ({ ...orig })) : [],
      };
    }
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

  if (refs.length > 0) {
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
  for (const verse of verses) {
    const indexed = BIBLE_INDEX[verse.reference];
    if (indexed?.original && indexed.original.length > 0) {
      verse.original = indexed.original.map((orig) => ({ ...orig }));
    }
  }
}

// ---------------------------------------------------------------------------
// fallBackBundledLexicalSearch — search using local bible-index.json
// ---------------------------------------------------------------------------

export async function fallbackBundledLexicalSearch(
  query: string,
  translation: string,
  limit = 6
): Promise<VerseContext[]> {
  const topK = Math.max(1, Math.floor(limit));
  const hits = getLexicalFuse().search(query, { limit: topK * 3 });
  const verseIds = hits.map((hit) => hit.item.verseId).slice(0, topK);
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

        const dbMatch = BIBLE_INDEX[`${ref.book} ${ref.chapter}:${ref.verse}`];
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
    const lexicalFallback = await fallbackBundledLexicalSearch(query, translation, 6);
    const existingRefs = new Set(verses.map(v => v.reference));
    const newVerses = lexicalFallback.filter(v => !existingRefs.has(v.reference));
    if (newVerses.length > 0) verses.push(...newVerses);
  }

  // Post-process
  const guarded = applyTopicGuards(query, verses, debugState, 'api_fallback');
  const finalVerses = applyCuratedTopicalLists(query, guarded, debugState, 'api_fallback');
  return enrichOriginalLanguages(finalVerses);
}
