'use server';

import path from 'path';

import { loadJsonDataset, markDatasetMissing, resolveDatasetPath } from './base';

export type MorphWord = {
  t: string;
  s: string;
  m: string;
};

type MorphBookData = Record<string, Record<string, MorphWord[]>>;

const MORPHHB_INDEX_PATH = resolveDatasetPath('data', 'morphhb-index.json');
const MORPHHB_DATA_DIR = resolveDatasetPath('data', 'morphhb');

const OSIS_TO_BOOK: Record<string, string> = {
  Gen: 'GEN',
  Exod: 'EXO',
  Lev: 'LEV',
  Num: 'NUM',
  Deut: 'DEU',
  Josh: 'JOS',
  Judg: 'JDG',
  Ruth: 'RUT',
  '1Sam': '1SA',
  '2Sam': '2SA',
  '1Kgs': '1KI',
  '2Kgs': '2KI',
  '1Chr': '1CH',
  '2Chr': '2CH',
  Ezra: 'EZR',
  Neh: 'NEH',
  Esth: 'EST',
  Job: 'JOB',
  Ps: 'PSA',
  Prov: 'PRO',
  Eccl: 'ECC',
  Song: 'SNG',
  Isa: 'ISA',
  Jer: 'JER',
  Lam: 'LAM',
  Ezek: 'EZK',
  Dan: 'DAN',
  Hos: 'HOS',
  Joel: 'JOL',
  Amos: 'AMO',
  Obad: 'OBA',
  Jonah: 'JON',
  Mic: 'MIC',
  Nah: 'NAM',
  Hab: 'HAB',
  Zeph: 'ZEP',
  Hag: 'HAG',
  Zech: 'ZEC',
  Mal: 'MAL',
};

const OSIS_TO_BOOK_UPPER: Record<string, string> = Object.fromEntries(
  Object.entries(OSIS_TO_BOOK).map(([key, value]) => [key.toUpperCase(), value])
);

function normalizeBook(input: string): string {
  if (!input) return input;
  const trimmed = input.replace(/\s+/g, '');
  const upper = trimmed.toUpperCase();
  return OSIS_TO_BOOK[trimmed] || OSIS_TO_BOOK_UPPER[upper] || upper;
}

async function loadMorphHBIndex(): Promise<Record<string, string> | null> {
  return loadJsonDataset<Record<string, string>>('morphhb:index', [MORPHHB_INDEX_PATH]);
}

export async function loadMorphHB(bookRaw: string): Promise<MorphBookData | null> {
  const book = normalizeBook(bookRaw);
  const datasetKey = `morphhb:${book}`;
  const index = await loadMorphHBIndex();
  const file = index?.[book];
  if (!file) {
    markDatasetMissing(datasetKey);
    return null;
  }

  return loadJsonDataset<MorphBookData>(datasetKey, [
    path.join(MORPHHB_DATA_DIR, file),
  ]);
}

export async function getMorphForVerse(
  bookRaw: string,
  chapter: number,
  verse: number
): Promise<MorphWord[] | null> {
  const data = await loadMorphHB(bookRaw);
  if (!data) {
    return null;
  }

  return data[String(chapter)]?.[String(verse)] || null;
}
