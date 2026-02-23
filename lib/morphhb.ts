import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import zlib from 'zlib';

export type MorphWord = {
  t: string; // Hebrew text
  s: string; // Strong's number (e.g., H7225)
  m: string; // Morph code (e.g., HR/Ncfsa)
};

type BookData = Record<string, Record<string, MorphWord[]>>;

const MORPHHB_DIR = path.join(process.cwd(), 'data', 'morphhb');
const INDEX_PATH = path.join(process.cwd(), 'data', 'morphhb-index.json');

const bookCache = new Map<string, BookData | null>();
const inFlight = new Map<string, Promise<BookData | null>>();
const indexCache: Record<string, string> = {};

function loadIndexSync(): void {
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [book, file] of Object.entries(parsed)) {
      indexCache[book] = file;
    }
  } catch (error) {
    console.warn('MorphHB index load failed', error);
  }
}

loadIndexSync();

const brotliDecompress = promisify(zlib.brotliDecompress);
const gunzip = promisify(zlib.gunzip);

async function loadBook(book: string): Promise<BookData | null> {
  const existing = bookCache.get(book);
  if (existing !== undefined) return existing;
  const pending = inFlight.get(book);
  if (pending) return pending;

  const file = indexCache[book];
  if (!file) {
    bookCache.set(book, null);
    return null;
  }

  const filePath = path.join(MORPHHB_DIR, file);
  const loader = (async () => {
    try {
      const raw = await fs.promises.readFile(filePath);
      let inflated: string;
      if (file.endsWith('.br')) {
        inflated = (await brotliDecompress(raw)).toString('utf8');
      } else if (file.endsWith('.gz')) {
        inflated = (await gunzip(raw)).toString('utf8');
      } else {
        inflated = raw.toString('utf8');
      }
      const data = JSON.parse(inflated) as BookData;
      bookCache.set(book, data);
      return data;
    } catch (error) {
      console.warn(`MorphHB book load failed for ${book}`, error);
      bookCache.set(book, null);
      return null;
    } finally {
      inFlight.delete(book);
    }
  })();

  inFlight.set(book, loader);
  return loader;
}

export async function getMorphhbWords(book: string, chapter: number, verse: number): Promise<MorphWord[] | null> {
  const data = await loadBook(book);
  if (!data) return null;
  const chapterData = data[String(chapter)];
  if (!chapterData) return null;
  return chapterData[String(verse)] || null;
}
