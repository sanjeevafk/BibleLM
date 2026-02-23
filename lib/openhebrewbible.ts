import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';

export type ClauseWord = { w: string; c: string };
export type ClauseBook = {
  verses: Record<string, Record<string, { words: ClauseWord[] }>>;
  clauses?: Record<string, { bhsa?: string }>;
};

export type PoeticBook = Record<string, Record<string, { paragraph?: number[]; poetic?: number[] }>>;
export type AlignmentBook = Record<string, Record<string, Array<[number, number]>>>;
export type GlossWord = {
  w: string;
  c?: string;
  s?: string;
  m?: string;
  md?: string;
  lex?: string;
  tr?: string;
  g?: string;
};
export type GlossBook = Record<string, Record<string, GlossWord[]>>;

export type OpenHebrewVerseLayers = {
  clauses?: { words: ClauseWord[]; clauseMeta?: Record<string, { bhsa?: string }> };
  poetic?: { paragraph?: number[]; poetic?: number[] };
  alignments?: Array<[number, number]>;
  gloss?: GlossWord[];
};

const DATA_DIR = path.join(process.cwd(), 'data', 'openhebrewbible');
const INDEX_PATH = path.join(process.cwd(), 'data', 'openhebrewbible-index.json');

type IndexEntry = { clauses?: string; poetic?: string; alignments?: string; gloss?: string };
type LayerName = keyof IndexEntry;

const indexCache: Record<string, IndexEntry> = {};

function loadIndexSync() {
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { clauses?: string; poetic?: string; alignments?: string; gloss?: string }>;
    Object.assign(indexCache, parsed);
  } catch (error) {
    console.warn('OpenHebrewBible index load failed', error);
  }
}

loadIndexSync();

const bookCache = new Map<string, { clauses?: ClauseBook | null; poetic?: PoeticBook | null; alignments?: AlignmentBook | null; gloss?: GlossBook | null }>();
const inFlight = new Map<string, Promise<unknown>>();

const brotliDecompress = promisify(zlib.brotliDecompress);
const gunzip = promisify(zlib.gunzip);

const BOOK_CODE_TO_TITLE: Record<string, string> = {
  GEN: 'Gen',
  EXO: 'Exo',
  LEV: 'Lev',
  NUM: 'Num',
  DEU: 'Deu',
  JOS: 'Jos',
  JDG: 'Jdg',
  RUT: 'Rut',
  '1SA': '1Sa',
  '2SA': '2Sa',
  '1KI': '1Ki',
  '2KI': '2Ki',
  '1CH': '1Ch',
  '2CH': '2Ch',
  EZR: 'Ezr',
  NEH: 'Neh',
  EST: 'Est',
  JOB: 'Job',
  PSA: 'Psa',
  PRO: 'Pro',
  ECC: 'Ecc',
  SNG: 'Sng',
  ISA: 'Isa',
  JER: 'Jer',
  LAM: 'Lam',
  EZK: 'Ezk',
  DAN: 'Dan',
  HOS: 'Hos',
  JOL: 'Jol',
  AMO: 'Amo',
  OBA: 'Oba',
  JON: 'Jon',
  MIC: 'Mic',
  NAM: 'Nam',
  HAB: 'Hab',
  ZEP: 'Zep',
  HAG: 'Hag',
  ZEC: 'Zec',
  MAL: 'Mal'
};

const TITLE_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(BOOK_CODE_TO_TITLE).flatMap(([upper, title]) => [
    [upper, title],
    [title.toUpperCase(), title],
    [title, title]
  ])
);

function normalizeBook(input: string): string {
  if (!input) return input;
  const trimmed = input.replace(/\s+/g, '');
  const upper = trimmed.toUpperCase();
  if (indexCache[trimmed]) return trimmed;
  if (indexCache[upper]) return upper;
  if (TITLE_ALIASES[upper]) return TITLE_ALIASES[upper];
  return trimmed;
}

async function loadLayer<T>(book: string, layer: LayerName): Promise<T | null> {
  const key = `${book}:${layer}`;
  const existing = bookCache.get(book)?.[layer];
  if (existing !== undefined) return existing as T | null;
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T | null>;

  const file = indexCache[book]?.[layer];
  if (!file) {
    const cached = bookCache.get(book) || {};
    (cached as Record<LayerName, ClauseBook | PoeticBook | AlignmentBook | GlossBook | null>)[layer] = null;
    bookCache.set(book, cached);
    return null;
  }

  const loader = (async () => {
    try {
      const filePath = path.join(DATA_DIR, file);
      const raw = await fs.promises.readFile(filePath);
      let inflated: string;
      if (file.endsWith('.br')) {
        inflated = (await brotliDecompress(raw)).toString('utf8');
      } else if (file.endsWith('.gz')) {
        inflated = (await gunzip(raw)).toString('utf8');
      } else {
        inflated = raw.toString('utf8');
      }
      const data = JSON.parse(inflated) as T;
      const cached = bookCache.get(book) || {};
      (cached as Record<LayerName, ClauseBook | PoeticBook | AlignmentBook | GlossBook | null>)[layer] =
        data as unknown as ClauseBook | PoeticBook | AlignmentBook | GlossBook;
      bookCache.set(book, cached);
      return data;
    } catch (error) {
      console.warn(`OpenHebrewBible layer load failed for ${book} ${layer}`, error);
      const cached = bookCache.get(book) || {};
      (cached as Record<LayerName, ClauseBook | PoeticBook | AlignmentBook | GlossBook | null>)[layer] = null;
      bookCache.set(book, cached);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, loader);
  return loader as Promise<T | null>;
}

export async function getOpenHebrewBibleLayers(
  bookRaw: string,
  chapter: number,
  verse: number
): Promise<OpenHebrewVerseLayers | null> {
  const book = normalizeBook(bookRaw);
  if (!book) return null;

  const [clauses, poetic, alignments, gloss] = await Promise.all([
    loadLayer<ClauseBook>(book, 'clauses'),
    loadLayer<PoeticBook>(book, 'poetic'),
    loadLayer<AlignmentBook>(book, 'alignments'),
    loadLayer<GlossBook>(book, 'gloss')
  ]);

  const chapterKey = String(chapter);
  const verseKey = String(verse);
  const result: OpenHebrewVerseLayers = {};

  if (clauses?.verses?.[chapterKey]?.[verseKey]) {
    const words = clauses.verses[chapterKey][verseKey].words || [];
    const clauseMeta: Record<string, { bhsa?: string }> = {};
    if (clauses.clauses) {
      const ids = new Set(words.map((w) => w.c).filter(Boolean));
      for (const id of ids) {
        const meta = clauses.clauses[id];
        if (meta) clauseMeta[id] = meta;
      }
    }
    result.clauses = {
      words,
      clauseMeta: Object.keys(clauseMeta).length > 0 ? clauseMeta : undefined
    };
  }

  const poeticVerse = poetic?.[chapterKey]?.[verseKey];
  if (poeticVerse) {
    result.poetic = poeticVerse;
  }

  const alignmentVerse = alignments?.[chapterKey]?.[verseKey];
  if (alignmentVerse) {
    result.alignments = alignmentVerse;
  }

  const glossVerse = gloss?.[chapterKey]?.[verseKey];
  if (glossVerse) {
    result.gloss = glossVerse;
  }

  return Object.keys(result).length > 0 ? result : null;
}
