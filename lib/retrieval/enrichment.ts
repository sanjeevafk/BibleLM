/**
 * Original language enrichment — Strong's dictionary, morphology codes,
 * OpenHebrew Bible layers, and OpenGNT layers.
 */

import { getMorphhbWords } from '../morphhb';
import { getStrongsEntry } from '../datasets/strongs';
import { getOpenHebrewBibleLayers, type OpenHebrewVerseLayers } from '../openhebrewbible';
import { getOpenGNTLayers, type OpenGntVerseLayers } from '../opengnt';
import { fetchExternalWithTimeoutBudget, type VerseContext } from '../bible-fetch';
import { OT_BOOKS, NT_BOOKS } from './types';
import { parseReferenceKey } from './verse-utils';

// ---------------------------------------------------------------------------
// Bolls.life tag parsing (used only on enrichment fallback path)
// ---------------------------------------------------------------------------

function bkbToBollsPath(bookCode: string, chapter: number): string {
  const map: Record<string, number> = {
    'GEN': 1, 'EXO': 2, 'LEV': 3, 'NUM': 4, 'DEU': 5,
    'JOS': 6, 'JDG': 7, 'RUT': 8, '1SA': 9, '2SA': 10,
    '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14, 'EZR': 15,
    'NEH': 16, 'EST': 17, 'JOB': 18, 'PSA': 19, 'PRO': 20,
    'ECC': 21, 'SNG': 22, 'ISA': 23, 'JER': 24, 'LAM': 25,
    'EZK': 26, 'DAN': 27, 'HOS': 28, 'JOL': 29, 'AMO': 30,
    'OBA': 31, 'JON': 32, 'MIC': 33, 'NAM': 34, 'HAB': 35,
    'ZEP': 36, 'HAG': 37, 'ZEC': 38, 'MAL': 39,
    'MAT': 40, 'MRK': 41, 'LUK': 42, 'JHN': 43, 'ACT': 44,
    'ROM': 45, '1CO': 46, '2CO': 47, 'GAL': 48, 'EPH': 49,
    'PHP': 50, 'COL': 51, '1TH': 52, '2TH': 53, '1TI': 54,
    '2TI': 55, 'TIT': 56, 'PHM': 57, 'HEB': 58, 'JAS': 59,
    '1PE': 60, '2PE': 61, '1JN': 62, '2JN': 63, '3JN': 64,
    'JUD': 65, 'REV': 66,
  };
  const bookNum = map[bookCode];
  if (bookNum === undefined) {
    throw new Error(`Unknown book code: ${bookCode}`);
  }
  return `${bookNum}/${chapter}`;
}

function parseOriginalTags(text: string): Array<{ word: string; strongs: string; gloss?: string }> {
  const words: Array<{ word: string; strongs: string; gloss?: string }> = [];
  const cleanLine = text.replace(/<span.*?>/g, '').replace(/<\/span>/g, '');
  const parts = cleanLine.split('<S>');

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) continue;

    const endStrongsIdx = part.indexOf('</S>');
    if (endStrongsIdx !== -1) {
      const strongs = part.substring(0, endStrongsIdx);
      const wordPart = parts[i - 1].replace(/<\/S>/g, '').trim();
      const lastSpace = wordPart.lastIndexOf(' ');
      const word = lastSpace === -1 ? wordPart : wordPart.substring(lastSpace + 1);
      const cleanWord = word.replace(/[,.;:!?]/g, '');
      if (cleanWord && strongs) {
        words.push({ word: cleanWord, strongs });
      }
    }
  }
  return words;
}

// ---------------------------------------------------------------------------
// Layer formatters
// ---------------------------------------------------------------------------

function formatOpenHebrewLayers(layers: OpenHebrewVerseLayers): string {
  const parts: string[] = [];
  if (layers.clauses?.words?.length) {
    const clauseIds = Array.from(new Set(layers.clauses.words.map((w) => w.c).filter(Boolean)));
    if (clauseIds.length > 0) parts.push(`Clauses: ${clauseIds.join(', ')}`);
  }
  if (layers.poetic?.paragraph?.length) parts.push(`Paragraph break at word(s) ${layers.poetic.paragraph.join(', ')}`);
  if (layers.poetic?.poetic?.length) parts.push(`Poetic line break at word(s) ${layers.poetic.poetic.join(', ')}`);
  if (layers.alignments?.length) parts.push(`Alignments: ${layers.alignments.length} word pairs`);
  if (layers.gloss?.length) {
    const glossSamples = layers.gloss.filter((w) => w.g && w.g.length > 2).slice(0, 3).map((w) => `${w.w}=${w.g}`);
    if (glossSamples.length > 0) parts.push(`Glosses: ${glossSamples.join('; ')}`);
  }
  return parts.join(' | ');
}

function formatOpenGntLayers(layers: OpenGntVerseLayers): string {
  const parts: string[] = [];
  if (layers.morphology?.length) {
    const morphSamples = layers.morphology.slice(0, 4).map((w) => {
      const tags = [w.s, w.r].filter(Boolean).join(' ');
      return tags ? `${w.w} (${tags})` : w.w;
    });
    if (morphSamples.length > 0) parts.push(`Greek morphology: ${morphSamples.join('; ')}`);
  }
  if (layers.interlinear?.length) {
    const interlinearSamples = layers.interlinear.filter((w) => w.i).slice(0, 4).map((w) => `${w.w}=${w.i}`);
    if (interlinearSamples.length > 0) parts.push(`Interlinear: ${interlinearSamples.join('; ')}`);
  }
  if (layers.clauses?.ids?.length) {
    let clauseText = layers.clauses.ids.join(', ');
    if (layers.clauses.meta) {
      const previews = layers.clauses.ids
        .map((id) => layers.clauses?.meta?.[id]?.st)
        .filter(Boolean)
        .slice(0, 2);
      if (previews.length > 0) clauseText += ` (${previews.join(' | ')})`;
    }
    parts.push(`Clause: ${clauseText}`);
  }
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Main enrichment entry point
// ---------------------------------------------------------------------------

export async function enrichOriginalLanguages(verses: VerseContext[]): Promise<VerseContext[]> {
  const allowExternalFallback = process.env.BIBLELM_DISABLE_EXTERNAL_FALLBACK !== '1';
  const normalizeHebrew = (input: string) =>
    input.replace(/[\u0591-\u05C7]/g, '').replace(/[^\u0590-\u05FF]/g, '');

  const fillMorphCodes = async (verse: VerseContext): Promise<void> => {
    const parsed = parseReferenceKey(verse.reference);
    if (!parsed || !OT_BOOKS.has(parsed.book) || !Array.isArray(verse.original) || verse.original.length === 0) return;

    const morphWords = await getMorphhbWords(parsed.book, parsed.chapter, parsed.verse);
    if (!morphWords || morphWords.length === 0) return;

    for (const original of verse.original) {
      if (original.morph) continue;
      const normalizedWord = normalizeHebrew(original.word || '');
      const exact = morphWords.find((w) => w.s === original.strongs && normalizeHebrew(w.t) === normalizedWord);
      const byStrongs = morphWords.find((w) => w.s === original.strongs);
      const byWord = morphWords.find((w) => normalizeHebrew(w.t) === normalizedWord);
      const match = exact || byStrongs || byWord;
      if (match?.m) original.morph = match.m;
    }
  };

  const hydrateOriginals = async (verse: VerseContext) => {
    await fillMorphCodes(verse);
    await Promise.all(
      verse.original.map(async (orig) => {
        const dictEntry = await getStrongsEntry(orig.strongs);
        if (dictEntry) {
          orig.gloss = dictEntry.short_definition || dictEntry.definition;
          orig.transliteration = dictEntry.transliteration;
        }
      })
    );
  };

  await Promise.all(
    verses.map(async (verse) => {
      const [bookRaw, cvRaw] = verse.reference.split(' ');
      const [chapterRaw = '', verseRaw = ''] = cvRaw?.split(':') ?? [];
      const chapterNum = Number.parseInt(chapterRaw, 10);
      const verseNum = Number.parseInt(verseRaw, 10);

      let hasOriginals = Array.isArray(verse.original) && verse.original.length > 0;
      if (hasOriginals) {
        await hydrateOriginals(verse);
      } else if (bookRaw && cvRaw && OT_BOOKS.has(bookRaw) && !Number.isNaN(chapterNum) && !Number.isNaN(verseNum)) {
        const morphWords = await getMorphhbWords(bookRaw, chapterNum, verseNum);
        if (morphWords && morphWords.length > 0) {
          verse.original = morphWords.map((w) => ({ word: w.t, strongs: w.s, morph: w.m }));
          await hydrateOriginals(verse);
          hasOriginals = true;
        }
      }

      if (!hasOriginals && allowExternalFallback) {
        try {
          const isOT = OT_BOOKS.has(verse.reference.split(' ')[0]);
          const trans = isOT ? 'WLC' : 'TR';
          const [book, cv] = verse.reference.split(' ');
          const [chapter, vNumStr] = cv.split(':');

          const bollsRef = bkbToBollsPath(book, parseInt(chapter, 10));
          const bollsUrl = new URL('https://bolls.life');
          bollsUrl.pathname = `/get-chapter/${encodeURIComponent(trans)}/${bollsRef}/`;
          const res = await fetchExternalWithTimeoutBudget(bollsUrl, {}, { source: 'bolls' });

          if (res?.ok) {
            const chapterData = await res.json();
            const matchV = chapterData.find((v: { verse: number; text: string }) => v.verse === parseInt(vNumStr, 10));
            if (matchV) {
              verse.original = parseOriginalTags(matchV.text);
              await hydrateOriginals(verse);
            }
          }
        } catch (err) {
          console.warn('Failed to fetch tagged fallback for', verse.reference, err);
        }
      }

      const layerTasks: Array<Promise<void>> = [];
      if (bookRaw && cvRaw && OT_BOOKS.has(bookRaw) && !Number.isNaN(chapterNum) && !Number.isNaN(verseNum)) {
        layerTasks.push((async () => {
          const layers = await getOpenHebrewBibleLayers(bookRaw, chapterNum, verseNum);
          if (layers) verse.openHebrew = formatOpenHebrewLayers(layers);
        })());
      }
      if (bookRaw && cvRaw && NT_BOOKS.has(bookRaw)) {
        layerTasks.push((async () => {
          const layers = await getOpenGNTLayers(verse.reference);
          if (layers) verse.openGnt = formatOpenGntLayers(layers);
        })());
      }
      if (layerTasks.length > 0) await Promise.all(layerTasks);
    })
  );

  return verses;
}
