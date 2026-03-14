import path from 'path';

import { loadJsonDataset, markDatasetMissing, resolveDatasetPath } from './base';

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

type IndexEntry = { clauses?: string; poetic?: string; alignments?: string; gloss?: string };
type LayerName = keyof IndexEntry;

const INDEX_PATH = resolveDatasetPath('data', 'openhebrewbible-index.json');
const DATA_DIR = resolveDatasetPath('data', 'openhebrewbible');

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
  MAL: 'Mal',
};

const TITLE_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(BOOK_CODE_TO_TITLE).flatMap(([upper, title]) => [
    [upper, title],
    [title.toUpperCase(), title],
    [title, title],
  ])
);

function normalizeBook(input: string): string {
  if (!input) return input;
  const trimmed = input.replace(/\s+/g, '');
  const upper = trimmed.toUpperCase();
  return TITLE_ALIASES[upper] || trimmed;
}

async function loadOpenHebrewBibleIndex(): Promise<Record<string, IndexEntry> | null> {
  return loadJsonDataset<Record<string, IndexEntry>>('open-hebrew-bible:index', [INDEX_PATH]);
}

export async function loadOpenHebrewBibleLayer<T>(
  bookRaw: string,
  layer: LayerName
): Promise<T | null> {
  const book = normalizeBook(bookRaw);
  const datasetKey = `open-hebrew-bible:${book}:${layer}`;
  const index = await loadOpenHebrewBibleIndex();
  const file = index?.[book]?.[layer];
  if (!file) {
    markDatasetMissing(datasetKey);
    return null;
  }

  return loadJsonDataset<T>(datasetKey, [path.join(DATA_DIR, file)]);
}

export async function getOpenHebrewBibleLayers(
  bookRaw: string,
  chapter: number,
  verse: number
): Promise<OpenHebrewVerseLayers | null> {
  const book = normalizeBook(bookRaw);
  if (!book) return null;

  const [clauses, poetic, alignments, gloss] = await Promise.all([
    loadOpenHebrewBibleLayer<ClauseBook>(book, 'clauses'),
    loadOpenHebrewBibleLayer<PoeticBook>(book, 'poetic'),
    loadOpenHebrewBibleLayer<AlignmentBook>(book, 'alignments'),
    loadOpenHebrewBibleLayer<GlossBook>(book, 'gloss'),
  ]);

  const chapterKey = String(chapter);
  const verseKey = String(verse);
  const result: OpenHebrewVerseLayers = {};

  if (clauses?.verses?.[chapterKey]?.[verseKey]) {
    const words = clauses.verses[chapterKey][verseKey].words || [];
    const clauseMeta: Record<string, { bhsa?: string }> = {};
    if (clauses.clauses) {
      const ids = new Set(words.map((word) => word.c).filter(Boolean));
      for (const id of ids) {
        const meta = clauses.clauses[id];
        if (meta) {
          clauseMeta[id] = meta;
        }
      }
    }

    result.clauses = {
      words,
      clauseMeta: Object.keys(clauseMeta).length > 0 ? clauseMeta : undefined,
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
