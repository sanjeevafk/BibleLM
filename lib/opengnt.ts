import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';

export type OpenGntMorphWord = {
  w: string;
  s?: string;
  r?: string;
  d?: string;
  l?: string;
};

export type OpenGntInterlinearWord = {
  w: string;
  i?: string;
};

export type OpenGntClauseBook = {
  verses: Record<string, Record<string, { ids: string[] }>>;
  clauses?: Record<string, { st?: string }>;
};

type MorphBook = Record<string, Record<string, OpenGntMorphWord[]>>;
type InterlinearBook = Record<string, Record<string, OpenGntInterlinearWord[]>>;

export type OpenGntVerseLayers = {
  morphology?: OpenGntMorphWord[];
  interlinear?: OpenGntInterlinearWord[];
  clauses?: { ids: string[]; meta?: Record<string, { st?: string }> };
};

const DATA_DIR = path.join(process.cwd(), 'data', 'opengnt');
const INDEX_PATH = path.join(process.cwd(), 'data', 'opengnt-index.json');

type IndexEntry = { morph?: string; interlinear?: string; clause?: string };

const indexCache: Record<string, IndexEntry> = {};
const bookCache = new Map<
  string,
  { morph?: MorphBook | null; interlinear?: InterlinearBook | null; clause?: OpenGntClauseBook | null }
>();
const inFlight = new Map<string, Promise<unknown>>();

const brotliDecompress = promisify(zlib.brotliDecompress);
const gunzip = promisify(zlib.gunzip);

const BOOK_ALIASES: Record<string, string> = {
  mat: 'MAT',
  matt: 'MAT',
  matthew: 'MAT',
  mrk: 'MRK',
  mark: 'MRK',
  luk: 'LUK',
  luke: 'LUK',
  jhn: 'JHN',
  joh: 'JHN',
  john: 'JHN',
  act: 'ACT',
  acts: 'ACT',
  rom: 'ROM',
  romans: 'ROM',
  '1co': '1CO',
  '1cor': '1CO',
  '1corinthians': '1CO',
  '2co': '2CO',
  '2cor': '2CO',
  '2corinthians': '2CO',
  gal: 'GAL',
  galatians: 'GAL',
  eph: 'EPH',
  ephesians: 'EPH',
  php: 'PHP',
  phil: 'PHP',
  philippians: 'PHP',
  col: 'COL',
  colossians: 'COL',
  '1th': '1TH',
  '1thess': '1TH',
  '1thessalonians': '1TH',
  '2th': '2TH',
  '2thess': '2TH',
  '2thessalonians': '2TH',
  '1ti': '1TI',
  '1tim': '1TI',
  '1timothy': '1TI',
  '2ti': '2TI',
  '2tim': '2TI',
  '2timothy': '2TI',
  tit: 'TIT',
  titus: 'TIT',
  phm: 'PHM',
  philem: 'PHM',
  philemon: 'PHM',
  heb: 'HEB',
  hebrews: 'HEB',
  jas: 'JAS',
  james: 'JAS',
  '1pe': '1PE',
  '1pet': '1PE',
  '1peter': '1PE',
  '2pe': '2PE',
  '2pet': '2PE',
  '2peter': '2PE',
  '1jn': '1JN',
  '1john': '1JN',
  '2jn': '2JN',
  '2john': '2JN',
  '3jn': '3JN',
  '3john': '3JN',
  jud: 'JUD',
  jude: 'JUD',
  rev: 'REV',
  revelation: 'REV'
};

function loadIndexSync(): void {
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, IndexEntry>;
    for (const [book, entry] of Object.entries(parsed)) {
      indexCache[book.toUpperCase()] = entry;
    }
  } catch (error) {
    console.warn('OpenGNT index load failed', error);
  }
}

loadIndexSync();

function normalizeBook(input: string): string {
  if (!input) return input;
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if (indexCache[upper]) return upper;
  const cleaned = trimmed.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return BOOK_ALIASES[cleaned] || upper;
}

async function loadLayer<T>(bookRaw: string, layer: keyof IndexEntry): Promise<T | null> {
  const book = normalizeBook(bookRaw);
  const key = `${book}:${layer}`;
  const existing = bookCache.get(book)?.[layer];
  if (existing !== undefined) return existing as T | null;
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T | null>;

  const file = indexCache[book]?.[layer];
  if (!file) {
    const cached = bookCache.get(book) || {};
    (cached as Record<keyof IndexEntry, MorphBook | InterlinearBook | OpenGntClauseBook | null>)[layer] = null;
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
      (cached as Record<keyof IndexEntry, MorphBook | InterlinearBook | OpenGntClauseBook | null>)[layer] =
        data as unknown as MorphBook | InterlinearBook | OpenGntClauseBook;
      bookCache.set(book, cached);
      return data;
    } catch (error) {
      console.warn(`OpenGNT layer load failed for ${book} ${layer}`, error);
      const cached = bookCache.get(book) || {};
      (cached as Record<keyof IndexEntry, MorphBook | InterlinearBook | OpenGntClauseBook | null>)[layer] = null;
      bookCache.set(book, cached);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, loader);
  return loader as Promise<T | null>;
}

function parseReference(reference: string): { book: string; chapter: number; verse: number } | null {
  const match = reference.trim().match(/^([A-Za-z0-9]+)\s+(\d+):(\d+)/);
  if (!match) return null;
  return {
    book: normalizeBook(match[1]),
    chapter: Number.parseInt(match[2], 10),
    verse: Number.parseInt(match[3], 10)
  };
}

export async function getOpenGNTLayers(reference: string): Promise<OpenGntVerseLayers | null> {
  const parsed = parseReference(reference);
  if (!parsed) return null;
  const { book, chapter, verse } = parsed;

  const [morph, interlinear, clause] = await Promise.all([
    loadLayer<MorphBook>(book, 'morph'),
    loadLayer<InterlinearBook>(book, 'interlinear'),
    loadLayer<OpenGntClauseBook>(book, 'clause')
  ]);

  const chapterKey = String(chapter);
  const verseKey = String(verse);
  const result: OpenGntVerseLayers = {};

  const morphVerse = morph?.[chapterKey]?.[verseKey];
  if (morphVerse && morphVerse.length > 0) {
    result.morphology = morphVerse;
  }

  const interlinearVerse = interlinear?.[chapterKey]?.[verseKey];
  if (interlinearVerse && interlinearVerse.length > 0) {
    result.interlinear = interlinearVerse;
  }

  const clauseVerse = clause?.verses?.[chapterKey]?.[verseKey];
  if (clauseVerse?.ids?.length) {
    result.clauses = {
      ids: clauseVerse.ids,
      meta: clause.clauses
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}
