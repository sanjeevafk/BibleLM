import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const MORPHHB_INDEX = path.join(DATA_DIR, 'morphhb-index.json');
const OPENHEBREW_INDEX = path.join(DATA_DIR, 'openhebrewbible-index.json');
const TRANSLATIONS_INDEX = path.join(DATA_DIR, 'translations-index.json');
const BIBLE_INDEX = path.join(DATA_DIR, 'bible-index.json');

const MAJOR_OPENHEBREW_BOOKS = ['Gen', 'Exo', 'Lev', 'Num', 'Deu', 'Psa', 'Isa'];
const REQUIRED_TRANSLATIONS = ['KJV', 'NHEB', 'ASV'];

let validationPromise: Promise<void> | null = null;

async function readJson<T = unknown>(filePath: string, label: string): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Data integrity check failed: missing or invalid ${label}.`);
  }
}

export async function validateDataIntegrity(): Promise<void> {
  if (validationPromise) {
    return validationPromise;
  }

  validationPromise = (async () => {
    const morphhbIndex = await readJson<Record<string, unknown>>(MORPHHB_INDEX, 'morphhb-index.json');
    const morphhbBooks = Object.keys(morphhbIndex || {});
    if (morphhbBooks.length !== 39) {
      throw new Error(
        `Data integrity check failed: morphhb-index.json expected 39 books, found ${morphhbBooks.length}.`
      );
    }

    const openHebrewIndex = await readJson<Record<string, Record<string, unknown>>>(
      OPENHEBREW_INDEX,
      'openhebrewbible-index.json'
    );
    for (const book of MAJOR_OPENHEBREW_BOOKS) {
      const layers = openHebrewIndex?.[book];
      if (!layers) {
        throw new Error(`Data integrity check failed: openhebrewbible-index.json missing ${book} layers.`);
      }
      const layerKeys = Object.keys(layers);
      if (layerKeys.length === 0) {
        throw new Error(`Data integrity check failed: openhebrewbible-index.json has no layers for ${book}.`);
      }
    }

    const translationsIndex = await readJson<Record<string, unknown>>(
      TRANSLATIONS_INDEX,
      'translations-index.json'
    );
    for (const required of REQUIRED_TRANSLATIONS) {
      if (!translationsIndex?.[required]) {
        throw new Error(
          `Data integrity check failed: translations-index.json missing ${required} translation.`
        );
      }
    }

    const bibleIndex = await readJson<Record<string, { text?: string }>>(BIBLE_INDEX, 'bible-index.json');
    const sample = Object.entries(bibleIndex).slice(0, 10);
    if (sample.length === 0) {
      throw new Error('Data integrity check failed: bible-index.json is empty.');
    }
    for (const [reference, verse] of sample) {
      if (!verse?.text || !verse.text.trim()) {
        throw new Error(`Data integrity check failed: bible-index.json has empty text for ${reference}.`);
      }
    }
  })();

  return validationPromise;
}
