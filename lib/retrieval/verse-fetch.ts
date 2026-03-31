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

  const regex = /\b(Gen|Exo|Lev|Num|Deu|Jos|Jdg|Rut|Sa|Ki|Ch|Ezr|Neh|Est|Job|Ps|Pro|Ecc|Song|Isa|Jer|Lam|Ezk|Dan|Hos|Joel|Amos|Obad|Jonah|Mic|Nahum|Hab|Zeph|Hag|Zech|Mal|Matt|Mark|Luke|John|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Titus|Philemon|Heb|James|Pet|John|Jude|Rev)[a-z]*\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\b/gi;

  const bookMap: Record<string, string> = {
    'GEN': 'GEN', 'EXO': 'EXO', 'LEV': 'LEV', 'NUM': 'NUM', 'DEU': 'DEU',
    'JOS': 'JOS', 'JDG': 'JDG', 'RUT': 'RUT', 'SA': '1SA', 'KI': '1KI', 'CH': '1CH',
    'PSA': 'PSA', 'PRO': 'PRO', 'ISA': 'ISA', 'MAT': 'MAT', 'MAR': 'MRK',
    'LUK': 'LUK', 'JOH': 'JHN', 'ROM': 'ROM', 'COR': '1CO', 'GAL': 'GAL', 'EPH': 'EPH',
    'PHI': 'PHP', 'COL': 'COL', 'THE': '1TH', 'TIM': '1TI', 'HEB': 'HEB', 'JAM': 'JAS',
    'PET': '1PE', 'REV': 'REV',
  };

  let match;
  while ((match = regex.exec(query)) !== null) {
    const bookRaw = match[1].substring(0, 3).toUpperCase();
    const bookCode = bookMap[bookRaw] || bookRaw;
    results.push({
      book: bookCode,
      chapter: parseInt(match[2], 10),
      verse: parseInt(match[3], 10),
      endVerse: match[4] ? parseInt(match[4], 10) : undefined,
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

const tenCommandments: VerseContext[] = [
  { reference: 'EXO 20:3', text: 'Thou shalt have no other gods before me.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:4', text: 'Thou shalt not make unto thee a graven image, nor any likeness of anything that is in heaven above, or that is in the earth beneath, or that is in the water under the earth.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:7', text: 'Thou shalt not take the name of Jehovah thy God in vain; for Jehovah will not hold him guiltless that taketh his name in vain.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:8', text: 'Remember the sabbath day, to keep it holy.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:12', text: 'Honor thy father and thy mother, that thy days may be long in the land which Jehovah thy God giveth thee.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:13', text: 'Thou shalt not kill.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:14', text: 'Thou shalt not commit adultery.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:15', text: 'Thou shalt not steal.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:16', text: 'Thou shalt not bear false witness against thy neighbor.', translation: 'ASV', original: [] },
  { reference: 'EXO 20:17', text: "Thou shalt not covet thy neighbor's house, thou shalt not covet thy neighbor's wife, nor his man-servant, nor his maid-servant, nor his ox, nor his ass, nor anything that is thy neighbor's.", translation: 'ASV', original: [] },
];

const freedomFromSlaveryVerses: VerseContext[] = [
  { reference: 'GAL 3:28', text: 'There can be neither Jew nor Greek, there can be neither bond nor free, there can be no male and female; for ye all are one in Christ Jesus.', translation: 'WEB', original: [] },
  { reference: 'GAL 4:7', text: 'So that thou art no longer a bondservant, but a son; and if a son, then an heir through God.', translation: 'WEB', original: [] },
  { reference: 'ROM 6:6', text: 'knowing this, that our old man was crucified with him, that the body of sin might be done away, that so we should no longer be in bondage to sin;', translation: 'WEB', original: [] },
  { reference: '1CO 7:22', text: "For he that was called in the Lord being a bondservant, is the Lord's freedman: likewise he that was called being free, is Christ's bondservant.", translation: 'WEB', original: [] },
  { reference: 'PHM 1:16', text: 'no longer as a bondservant, but more than a bondservant, a beloved brother, especially to me, but how much rather to thee, both in the flesh and in the Lord.', translation: 'WEB', original: [] },
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
  const prioritized: VerseContext[] = [];
  const addPriority = (index: number, keywords: string[]) => {
    if (keywords.some((k) => normalizedQuery.includes(k))) {
      const verse = tenCommandments[index];
      if (!verses.some((v) => v.reference === verse.reference) && !prioritized.some((v) => v.reference === verse.reference)) {
        prioritized.push(verse);
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

  for (const verse of prioritized.reverse()) verses.unshift(verse);

  const freedomKeywords = ['slav', 'slave', 'servant', 'bondservant', 'bond servant', 'bond', 'doulos', 'freedom', 'free'];
  if (freedomKeywords.some((k) => normalizedQuery.includes(k))) {
    for (const verse of freedomFromSlaveryVerses.slice().reverse()) {
      if (!verses.some((v) => v.reference === verse.reference)) verses.unshift(verse);
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
        if (dbMatch && canUseIndex) return cloneVerses([dbMatch])[0];

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
    if (lexicalFallback.length > 0) verses.push(...lexicalFallback);
  }

  // Post-process
  const guarded = applyTopicGuards(query, verses, debugState, 'api_fallback');
  const finalVerses = applyCuratedTopicalLists(query, guarded, debugState, 'api_fallback');
  return enrichOriginalLanguages(finalVerses);
}
