import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';
import bibleIndexData from '../data/bible-full-index.json';

type TranslationBook = Record<string, Record<string, string>>;
type IndexedVerse = { text?: string };

const DATA_DIR = path.join(process.cwd(), 'data', 'translations');
const INDEX_PATH = path.join(process.cwd(), 'data', 'translations-index.json');

const indexCache: Record<string, Record<string, string>> = {};
const bookCache = new Map<string, TranslationBook | null>();
const inFlight = new Map<string, Promise<TranslationBook | null>>();
const BIBLE_INDEX = bibleIndexData as Record<string, IndexedVerse>;

const brotliDecompress = promisify(zlib.brotliDecompress);
const gunzip = promisify(zlib.gunzip);

const TRANSLATION_ALIASES: Record<string, string> = {
  BSB: 'BSB',
  KJV: 'KJV',
  WEB: 'WEB',
  NHEB: 'NHEB',
  ASV: 'ASV'
};

const BOOK_NUMBER_TO_CODE: Record<number, string> = {
  1: 'GEN',
  2: 'EXO',
  3: 'LEV',
  4: 'NUM',
  5: 'DEU',
  6: 'JOS',
  7: 'JDG',
  8: 'RUT',
  9: '1SA',
  10: '2SA',
  11: '1KI',
  12: '2KI',
  13: '1CH',
  14: '2CH',
  15: 'EZR',
  16: 'NEH',
  17: 'EST',
  18: 'JOB',
  19: 'PSA',
  20: 'PRO',
  21: 'ECC',
  22: 'SNG',
  23: 'ISA',
  24: 'JER',
  25: 'LAM',
  26: 'EZK',
  27: 'DAN',
  28: 'HOS',
  29: 'JOL',
  30: 'AMO',
  31: 'OBA',
  32: 'JON',
  33: 'MIC',
  34: 'NAM',
  35: 'HAB',
  36: 'ZEP',
  37: 'HAG',
  38: 'ZEC',
  39: 'MAL',
  40: 'MAT',
  41: 'MRK',
  42: 'LUK',
  43: 'JHN',
  44: 'ACT',
  45: 'ROM',
  46: '1CO',
  47: '2CO',
  48: 'GAL',
  49: 'EPH',
  50: 'PHP',
  51: 'COL',
  52: '1TH',
  53: '2TH',
  54: '1TI',
  55: '2TI',
  56: 'TIT',
  57: 'PHM',
  58: 'HEB',
  59: 'JAS',
  60: '1PE',
  61: '2PE',
  62: '1JN',
  63: '2JN',
  64: '3JN',
  65: 'JUD',
  66: 'REV'
};

const BOOK_ALIASES: Record<string, string> = {
  gen: 'GEN',
  genesis: 'GEN',
  ge: 'GEN',
  exo: 'EXO',
  exod: 'EXO',
  exodus: 'EXO',
  lev: 'LEV',
  leviticus: 'LEV',
  num: 'NUM',
  numbers: 'NUM',
  deu: 'DEU',
  deut: 'DEU',
  deuteronomy: 'DEU',
  jos: 'JOS',
  josh: 'JOS',
  joshua: 'JOS',
  jdg: 'JDG',
  judg: 'JDG',
  judges: 'JDG',
  rut: 'RUT',
  ruth: 'RUT',
  '1sa': '1SA',
  '1sam': '1SA',
  '1samuel': '1SA',
  '2sa': '2SA',
  '2sam': '2SA',
  '2samuel': '2SA',
  '1ki': '1KI',
  '1kgs': '1KI',
  '1kings': '1KI',
  '2ki': '2KI',
  '2kgs': '2KI',
  '2kings': '2KI',
  '1ch': '1CH',
  '1chr': '1CH',
  '1chronicles': '1CH',
  '2ch': '2CH',
  '2chr': '2CH',
  '2chronicles': '2CH',
  ezr: 'EZR',
  ezra: 'EZR',
  neh: 'NEH',
  nehemiah: 'NEH',
  est: 'EST',
  esth: 'EST',
  esther: 'EST',
  job: 'JOB',
  psa: 'PSA',
  ps: 'PSA',
  psalm: 'PSA',
  psalms: 'PSA',
  pro: 'PRO',
  prov: 'PRO',
  proverbs: 'PRO',
  ecc: 'ECC',
  eccl: 'ECC',
  ecclesiastes: 'ECC',
  sng: 'SNG',
  song: 'SNG',
  songofsongs: 'SNG',
  songofsolomon: 'SNG',
  isa: 'ISA',
  isaiah: 'ISA',
  jer: 'JER',
  jeremiah: 'JER',
  lam: 'LAM',
  lamentations: 'LAM',
  ezk: 'EZK',
  ezek: 'EZK',
  ezekiel: 'EZK',
  dan: 'DAN',
  daniel: 'DAN',
  hos: 'HOS',
  hosea: 'HOS',
  jol: 'JOL',
  joel: 'JOL',
  amo: 'AMO',
  amos: 'AMO',
  oba: 'OBA',
  obad: 'OBA',
  obadiah: 'OBA',
  jon: 'JON',
  jonah: 'JON',
  mic: 'MIC',
  micah: 'MIC',
  nam: 'NAM',
  nah: 'NAM',
  nahum: 'NAM',
  hab: 'HAB',
  habakkuk: 'HAB',
  zep: 'ZEP',
  zeph: 'ZEP',
  zephaniah: 'ZEP',
  hag: 'HAG',
  haggai: 'HAG',
  zec: 'ZEC',
  zech: 'ZEC',
  zechariah: 'ZEC',
  mal: 'MAL',
  malachi: 'MAL',
  mat: 'MAT',
  matt: 'MAT',
  matthew: 'MAT',
  mrk: 'MRK',
  mar: 'MRK',
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
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    for (const [translation, books] of Object.entries(parsed)) {
      indexCache[translation.toUpperCase()] = books;
    }
  } catch (error) {
    console.warn('Translations index load failed', error);
  }
}

loadIndexSync();

function normalizeTranslation(input: string): string {
  const upper = input.trim().toUpperCase();
  return TRANSLATION_ALIASES[upper] || upper;
}

function normalizeBook(input: string): string {
  if (!input) return input;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number.parseInt(trimmed, 10);
    return BOOK_NUMBER_TO_CODE[num] || trimmed;
  }
  const cleaned = trimmed.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const mapped = BOOK_ALIASES[cleaned];
  if (mapped) return mapped;
  const upper = trimmed.toUpperCase();
  return BOOK_ALIASES[upper.toLowerCase()] || upper;
}

async function loadBook(translationRaw: string, bookRaw: string): Promise<TranslationBook | null> {
  const translation = normalizeTranslation(translationRaw);
  const book = normalizeBook(bookRaw);
  const key = `${translation}:${book}`;
  const existing = bookCache.get(key);
  if (existing !== undefined) return existing;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const file = indexCache[translation]?.[book];
  if (!file) {
    console.warn(`[translations] Missing index mapping for ${translation} ${book}`);
    bookCache.set(key, null);
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
      const data = JSON.parse(inflated) as TranslationBook;
      bookCache.set(key, data);
      return data;
    } catch (error) {
      console.warn(`[translations] Translation book load failed for ${translation} ${book}`, error);
      bookCache.set(key, null);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, loader);
  return loader;
}

function getWebIndexedVerse(reference: string): string | null {
  const direct = BIBLE_INDEX[reference]?.text;
  if (direct) return direct;

  const dotted = reference.match(/^([A-Z0-9]{3})\s+(\d+):(\d+)(?:\s*-\s*(\d+))?$/i);
  if (!dotted) return null;
  const book = normalizeBook(dotted[1]);
  const chapter = Number.parseInt(dotted[2], 10);
  const start = Number.parseInt(dotted[3], 10);
  const end = dotted[4] ? Number.parseInt(dotted[4], 10) : start;

  const parts: string[] = [];
  for (let verse = start; verse <= end; verse += 1) {
    const key = `${book} ${chapter}:${verse}`;
    const text = BIBLE_INDEX[key]?.text;
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function parseReference(ref: string): { book: string; chapter: number; verse: number; endVerse?: number } | null {
  const cleaned = ref.trim();
  const match = cleaned.match(/^(.+?)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?$/);
  if (match) {
    return {
      book: normalizeBook(match[1]),
      chapter: Number.parseInt(match[2], 10),
      verse: Number.parseInt(match[3], 10),
      endVerse: match[4] ? Number.parseInt(match[4], 10) : undefined
    };
  }

  const dotted = cleaned.match(/^([A-Za-z0-9]+)[\.:](\d+)[\.:](\d+)$/);
  if (dotted) {
    return {
      book: normalizeBook(dotted[1]),
      chapter: Number.parseInt(dotted[2], 10),
      verse: Number.parseInt(dotted[3], 10)
    };
  }
  return null;
}

export async function getTranslationVerse(
  reference: string,
  translation: string
): Promise<string | null> {
  if (!reference || !translation) return null;
  const parsed = parseReference(reference);
  if (!parsed) return null;

  const normalizedTranslation = normalizeTranslation(translation);

  if (normalizedTranslation === 'WEB') {
    const indexed = getWebIndexedVerse(`${parsed.book} ${parsed.chapter}:${parsed.verse}${parsed.endVerse ? `-${parsed.endVerse}` : ''}`);
    if (indexed) {
      return indexed;
    }
    console.warn(`[translations] WEB indexed verse missing for ${reference}`);
  }

  const data = await loadBook(translation, parsed.book);
  if (!data) {
    console.warn(`[translations] No translation data for ${normalizedTranslation} ${parsed.book}`);
    return null;
  }
  const chapterData = data[String(parsed.chapter)];
  if (!chapterData) {
    console.warn(`[translations] Missing chapter ${parsed.chapter} for ${normalizedTranslation} ${parsed.book}`);
    return null;
  }

  if (!parsed.endVerse || parsed.endVerse === parsed.verse) {
    const verseText = chapterData[String(parsed.verse)] || null;
    if (!verseText) {
      console.warn(`[translations] Missing verse ${parsed.book} ${parsed.chapter}:${parsed.verse} in ${normalizedTranslation}`);
    }
    return verseText;
  }

  const parts: string[] = [];
  for (let v = parsed.verse; v <= parsed.endVerse; v += 1) {
    const text = chapterData[String(v)];
    if (text) parts.push(text);
  }
  if (parts.length === 0) {
    console.warn(`[translations] Missing verse range ${reference} in ${normalizedTranslation}`);
    return null;
  }
  return parts.join(' ');
}
