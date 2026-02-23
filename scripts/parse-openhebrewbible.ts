import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import readline from 'readline';
import { execSync } from 'child_process';

const SOURCE_DIR = path.join(process.cwd(), 'datasets', 'OpenHebrewBible');
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'openhebrewbible');
const INDEX_PATH = path.join(process.cwd(), 'data', 'openhebrewbible-index.json');
const HASH_PATH = path.join(OUTPUT_DIR, '.openhebrewbible.hash');

const BOOK_NUM_TO_CODE: Record<number, string> = {
  1: 'Gen',
  2: 'Exo',
  3: 'Lev',
  4: 'Num',
  5: 'Deu',
  6: 'Jos',
  7: 'Jdg',
  8: 'Rut',
  9: '1Sa',
  10: '2Sa',
  11: '1Ki',
  12: '2Ki',
  13: '1Ch',
  14: '2Ch',
  15: 'Ezr',
  16: 'Neh',
  17: 'Est',
  18: 'Job',
  19: 'Psa',
  20: 'Pro',
  21: 'Ecc',
  22: 'Sng',
  23: 'Isa',
  24: 'Jer',
  25: 'Lam',
  26: 'Ezk',
  27: 'Dan',
  28: 'Hos',
  29: 'Jol',
  30: 'Amo',
  31: 'Oba',
  32: 'Jon',
  33: 'Mic',
  34: 'Nam',
  35: 'Hab',
  36: 'Zep',
  37: 'Hag',
  38: 'Zec',
  39: 'Mal'
};

const SOURCE_FILES = {
  versification: path.join(
    SOURCE_DIR,
    '019-BHSA_to_KJV_versification',
    'BHSA_KJV_versification_all_mappings.csv'
  ),
  alignments: path.join(SOURCE_DIR, '001-aligning-BHS-WLC', 'final-mapping-data.csv'),
  clauses: path.join(SOURCE_DIR, '004-WLC-with-clause-segmentation', 'WLC-with-clause-segmentation.csv'),
  paragraph: path.join(SOURCE_DIR, '010-BHS-paragraph-and-poetic-line-division', 'BHS-paragraph-division-done.csv'),
  poetry: path.join(SOURCE_DIR, '010-BHS-paragraph-and-poetic-line-division', 'BHS-poetry-formatting-simplified.csv'),
  extendedGloss: path.join(SOURCE_DIR, '011-BHS-extended-gloss', 'BHS-extended-gloss.csv'),
  clauseTranslationZip: path.join(SOURCE_DIR, 'BHSA-clause-translation.csv.zip'),
  clauseTranslationCsv: path.join(SOURCE_DIR, 'BHSA-clause-translation.csv'),
  featuresZip: path.join(SOURCE_DIR, 'BHSA-with-extended-features.csv.zip'),
  featuresCsv: path.join(SOURCE_DIR, 'BHSA-with-extended-features.csv')
};

type VerseKeyed<T> = Record<string, Record<string, T>>;

type ClauseWord = { w: string; c: string };

type ClauseBook = {
  verses: VerseKeyed<{ words: ClauseWord[] }>;
  clauses?: Record<string, { bhsa?: string }>;
};

type PoeticVerse = {
  paragraph?: number[];
  poetic?: number[];
};

type GlossWord = {
  w: string;
  c?: string;
  s?: string;
  m?: string;
  md?: string;
  lex?: string;
  tr?: string;
  g?: string;
};

type IndexEntry = {
  clauses?: string;
  poetic?: string;
  alignments?: string;
  gloss?: string;
};

type IndexMap = Record<string, IndexEntry>;

type VerseRef = { bookNum: number; bookCode: string; chapter: number; verse: number };

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function unzipIfNeeded(zipPath: string, outDir: string) {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Missing zip file at ${zipPath}`);
  }
  const fileName = path.basename(zipPath, '.zip');
  const target = path.join(outDir, fileName);
  if (fs.existsSync(target)) return;
  execSync(`unzip -o "${zipPath}" -d "${outDir}"`, { stdio: 'inherit' });
  if (!fs.existsSync(target)) {
    throw new Error(`Expected unzip output at ${target}`);
  }
}

async function hashFile(hash: crypto.Hash, filePath: string) {
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
}

function brotliCompress(payload: Buffer) {
  return zlib.brotliCompressSync(payload, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
}

function gzipCompress(payload: Buffer) {
  return zlib.gzipSync(payload, { level: 9 });
}

function writeLayerBook(
  index: IndexMap,
  layer: keyof IndexEntry,
  bookCode: string,
  payload: unknown
) {
  const json = JSON.stringify(payload);
  const baseName = `${layer}-${bookCode}.json`;
  const gzPath = path.join(OUTPUT_DIR, `${baseName}.gz`);
  const brPath = path.join(OUTPUT_DIR, `${baseName}.br`);
  const buffer = Buffer.from(json);
  fs.writeFileSync(gzPath, gzipCompress(buffer));
  fs.writeFileSync(brPath, brotliCompress(buffer));

  if (!index[bookCode]) index[bookCode] = {};
  index[bookCode][layer] = `${baseName}.br`;
  console.log(`Wrote ${layer} ${bookCode} -> ${brPath}`);
}

async function parseVersificationMap(): Promise<Map<number, VerseRef>> {
  const map = new Map<number, VerseRef>();
  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.versification),
    crlfDelay: Infinity
  });

  let isHeader = true;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (line.includes('KJVverseSort')) continue;
    }
    const [kjvPart] = line.split('\t');
    if (!kjvPart) continue;
    const cleaned = kjvPart.replace(/[〔〕]/g, '');
    const parts = cleaned.split('｜').map((p) => p.trim());
    if (parts.length < 4) continue;
    const verseSort = Number.parseInt(parts[0], 10);
    const bookNum = Number.parseInt(parts[1], 10);
    const chapter = Number.parseInt(parts[2], 10);
    const verse = Number.parseInt(parts[3], 10);
    const bookCode = BOOK_NUM_TO_CODE[bookNum];
    if (!bookCode || Number.isNaN(verseSort)) continue;
    map.set(verseSort, { bookNum, bookCode, chapter, verse });
  }

  return map;
}

async function parseClauseTranslations(): Promise<Map<string, string>> {
  unzipIfNeeded(SOURCE_FILES.clauseTranslationZip, SOURCE_DIR);
  const map = new Map<string, string>();
  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.clauseTranslationCsv),
    crlfDelay: Infinity
  });
  let isHeader = true;
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (line.startsWith('clauseID')) continue;
    }
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const clauseId = parts[0].trim();
    if (!clauseId) continue;
    const bhsa = parts[1]?.trim() || '';
    if (bhsa) map.set(clauseId, bhsa);
  }
  return map;
}

async function parseExtendedGlossMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.extendedGloss),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const id = Number.parseInt(parts[0], 10);
    if (Number.isNaN(id)) continue;
    const gloss = parts.slice(1).join('\t').trim();
    if (gloss) map.set(id, gloss);
  }

  return map;
}

async function parseAlignments(
  verseMap: Map<number, VerseRef>,
  index: IndexMap
): Promise<{ wlcSortToVerse: number[]; bhsSortToVerse: number[] }> {
  const wlcSortToVerse: number[] = [];
  const bhsSortToVerse: number[] = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.alignments),
    crlfDelay: Infinity
  });

  let currentBook: string | null = null;
  let currentBookData: VerseKeyed<Array<[number, number]>> = {};
  let currentVerseId: number | null = null;
  let currentPairs: Array<[number, number]> = [];
  let isHeader = true;

  const flushVerse = () => {
    if (currentVerseId === null) return;
    const ref = verseMap.get(currentVerseId);
    if (!ref) return;
    const chapterKey = String(ref.chapter);
    const verseKey = String(ref.verse);
    if (!currentBookData[chapterKey]) currentBookData[chapterKey] = {};
    currentBookData[chapterKey][verseKey] = currentPairs;
  };

  const flushBook = () => {
    if (currentBook && Object.keys(currentBookData).length > 0) {
      writeLayerBook(index, 'alignments', currentBook, currentBookData);
    }
    currentBookData = {};
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (line.startsWith('mappingSort')) continue;
    }
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const kjvVerseId = Number.parseInt(parts[1], 10);
    const wlcSort = Number.parseInt(parts[2], 10);
    const bhsSort = Number.parseInt(parts[3], 10);
    if (Number.isNaN(kjvVerseId) || Number.isNaN(wlcSort) || Number.isNaN(bhsSort)) continue;

    wlcSortToVerse[wlcSort] = kjvVerseId;
    bhsSortToVerse[bhsSort] = kjvVerseId;

    if (currentVerseId !== kjvVerseId) {
      flushVerse();
      currentVerseId = kjvVerseId;
      currentPairs = [];

      const ref = verseMap.get(kjvVerseId);
      if (ref) {
        if (currentBook !== ref.bookCode) {
          flushBook();
          currentBook = ref.bookCode;
        }
      }
    }

    currentPairs.push([wlcSort, bhsSort]);
  }

  flushVerse();
  flushBook();

  return { wlcSortToVerse, bhsSortToVerse };
}

async function parseClauseSegmentation(
  verseMap: Map<number, VerseRef>,
  clauseTranslations: Map<string, string>,
  index: IndexMap
) {
  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.clauses),
    crlfDelay: Infinity
  });

  let currentBook: string | null = null;
  let currentBookVerses: VerseKeyed<{ words: ClauseWord[] }> = {};
  let currentVerseId: number | null = null;
  let currentWords: ClauseWord[] = [];
  let clauseIds = new Set<string>();
  let isHeader = true;

  const flushVerse = () => {
    if (currentVerseId === null) return;
    const ref = verseMap.get(currentVerseId);
    if (!ref) return;
    const chapterKey = String(ref.chapter);
    const verseKey = String(ref.verse);
    if (!currentBookVerses[chapterKey]) currentBookVerses[chapterKey] = {};
    currentBookVerses[chapterKey][verseKey] = { words: currentWords };
  };

  const flushBook = () => {
    if (!currentBook || Object.keys(currentBookVerses).length === 0) {
      clauseIds = new Set();
      currentBookVerses = {};
      return;
    }
    const clauseMeta: Record<string, { bhsa?: string }> = {};
    for (const id of clauseIds) {
      const bhsa = clauseTranslations.get(id);
      if (bhsa) clauseMeta[id] = { bhsa };
    }
    const payload: ClauseBook = { verses: currentBookVerses };
    if (Object.keys(clauseMeta).length > 0) payload.clauses = clauseMeta;
    writeLayerBook(index, 'clauses', currentBook, payload);
    clauseIds = new Set();
    currentBookVerses = {};
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (line.startsWith('Verse')) continue;
    }
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const verseId = Number.parseInt(parts[0], 10);
    const word = parts[2]?.trim() || '';
    const clauseId = parts[3]?.trim() || '';
    if (Number.isNaN(verseId) || !word) continue;

    if (currentVerseId !== verseId) {
      flushVerse();
      currentVerseId = verseId;
      currentWords = [];

      const ref = verseMap.get(verseId);
      if (ref) {
        if (currentBook !== ref.bookCode) {
          flushBook();
          currentBook = ref.bookCode;
        }
      }
    }

    if (clauseId) clauseIds.add(clauseId);
    currentWords.push({ w: word, c: clauseId });
  }

  flushVerse();
  flushBook();
}

function ensureVerse<T>(bookData: VerseKeyed<T>, chapter: number, verse: number, init: T): T {
  const chapterKey = String(chapter);
  const verseKey = String(verse);
  if (!bookData[chapterKey]) bookData[chapterKey] = {} as Record<string, T>;
  if (!bookData[chapterKey][verseKey]) bookData[chapterKey][verseKey] = init;
  return bookData[chapterKey][verseKey];
}

async function parsePoeticDivision(
  verseMap: Map<number, VerseRef>,
  bhsSortToVerse: number[],
  index: IndexMap
) {
  const poeticByBook: Record<string, VerseKeyed<PoeticVerse>> = {};
  const bhsSortToWordIndex = new Map<number, number>();

  const paragraphRl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.paragraph),
    crlfDelay: Infinity
  });

  let currentVerseId: number | null = null;
  let wordIndex = 0;

  for await (const line of paragraphRl) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const bhsSort = Number.parseInt(parts[0], 10);
    if (Number.isNaN(bhsSort)) continue;
    const verseId = bhsSortToVerse[bhsSort];
    if (!verseId) continue;

    if (currentVerseId !== verseId) {
      currentVerseId = verseId;
      wordIndex = 1;
    } else {
      wordIndex += 1;
    }
    bhsSortToWordIndex.set(bhsSort, wordIndex);

    const marker = parts[1]?.trim();
    if (marker) {
      const ref = verseMap.get(verseId);
      if (!ref) continue;
      if (!poeticByBook[ref.bookCode]) poeticByBook[ref.bookCode] = {};
      const verseEntry = ensureVerse(poeticByBook[ref.bookCode], ref.chapter, ref.verse, {} as PoeticVerse);
      if (!verseEntry.paragraph) verseEntry.paragraph = [];
      verseEntry.paragraph.push(wordIndex);
    }
  }

  const poetryRl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.poetry),
    crlfDelay: Infinity
  });

  let isHeader = true;
  for await (const line of poetryRl) {
    if (!line.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (line.startsWith('BHSsort')) continue;
    }
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const bhsSort = Number.parseInt(parts[0], 10);
    if (Number.isNaN(bhsSort)) continue;
    const marker = parts[1]?.trim();
    if (!marker) continue;
    const verseId = bhsSortToVerse[bhsSort];
    if (!verseId) continue;
    const wordPos = bhsSortToWordIndex.get(bhsSort);
    if (!wordPos) continue;
    const ref = verseMap.get(verseId);
    if (!ref) continue;
    if (!poeticByBook[ref.bookCode]) poeticByBook[ref.bookCode] = {};
    const verseEntry = ensureVerse(poeticByBook[ref.bookCode], ref.chapter, ref.verse, {} as PoeticVerse);
    if (!verseEntry.poetic) verseEntry.poetic = [];
    verseEntry.poetic.push(wordPos);
  }

  for (const [bookCode, data] of Object.entries(poeticByBook)) {
    writeLayerBook(index, 'poetic', bookCode, data);
  }
}

async function parseGlossFeatures(
  extendedGlossMap: Map<number, string>,
  index: IndexMap
) {
  unzipIfNeeded(SOURCE_FILES.featuresZip, SOURCE_DIR);

  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.featuresCsv),
    crlfDelay: Infinity
  });

  let header: string[] | null = null;
  let idxSort = -1;
  let idxKjv = -1;
  let idxClause = -1;
  let idxPointed = -1;
  let idxTranslit = -1;
  let idxLexeme = -1;
  let idxStrong = -1;
  let idxStrongExt = -1;
  let idxMorph = -1;
  let idxMorphDetail = -1;
  let idxGloss = -1;
  let idxGlossExt = -1;
  let currentBook: string | null = null;
  let currentBookData: VerseKeyed<GlossWord[]> = {};

  const flushBook = () => {
    if (!currentBook || Object.keys(currentBookData).length === 0) return;
    writeLayerBook(index, 'gloss', currentBook, currentBookData);
    currentBookData = {};
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!header) {
      header = line.split('\t');
      idxSort = header.indexOf('BHSwordSort');
      idxKjv = header.indexOf('〔KJVverseSort｜KJVbook｜KJVchapter｜KJVverse〕');
      idxClause = header.indexOf('clauseID');
      idxPointed = header.indexOf('BHSwordPointed');
      idxTranslit = header.indexOf('SBLstyleTransliteration');
      idxLexeme = header.indexOf('HebrewLexeme');
      idxStrong = header.indexOf('StrongNumber');
      idxStrongExt = header.indexOf('extendedStrongNumber');
      idxMorph = header.indexOf('morphologyCode');
      idxMorphDetail = header.indexOf('morphologyDetail');
      idxGloss = header.indexOf('ETCBCgloss');
      idxGlossExt = header.indexOf('extendedGloss');
      continue;
    }
    const cols = line.split('\t');
    if (idxSort < 0 || idxKjv < 0 || idxPointed < 0) continue;

    const sort = Number.parseInt(cols[idxSort] || '', 10);
    const kjvRaw = cols[idxKjv] || '';
    const kjvParts = kjvRaw.replace(/[〔〕]/g, '').split('｜');
    if (kjvParts.length < 4) continue;
    const bookNum = Number.parseInt(kjvParts[1], 10);
    const chapter = Number.parseInt(kjvParts[2], 10);
    const verse = Number.parseInt(kjvParts[3], 10);
    const bookCode = BOOK_NUM_TO_CODE[bookNum];
    if (!bookCode) continue;

    if (currentBook !== bookCode) {
      flushBook();
      currentBook = bookCode;
    }

    const pointed = stripTags(cols[idxPointed] || '');
    if (!pointed) continue;

    const word: GlossWord = { w: pointed };

    const clauseId = cols[idxClause]?.trim();
    if (clauseId) word.c = clauseId;

    const strong = cols[idxStrongExt]?.trim() || cols[idxStrong]?.trim();
    if (strong) word.s = strong;

    const morph = cols[idxMorph]?.trim();
    if (morph) word.m = morph;

    const morphDetail = cols[idxMorphDetail]?.trim();
    if (morphDetail) word.md = morphDetail;

    const lexeme = stripTags(cols[idxLexeme] || '');
    if (lexeme) word.lex = lexeme;

    const translit = cols[idxTranslit]?.trim();
    if (translit) word.tr = translit;

    let gloss = cols[idxGlossExt]?.trim();
    if (!gloss && !Number.isNaN(sort)) {
      gloss = extendedGlossMap.get(sort) || '';
    }
    if (!gloss) {
      gloss = cols[idxGloss]?.trim() || '';
    }
    if (gloss) word.g = gloss;

    const chapterKey = String(chapter);
    const verseKey = String(verse);
    if (!currentBookData[chapterKey]) currentBookData[chapterKey] = {};
    if (!currentBookData[chapterKey][verseKey]) currentBookData[chapterKey][verseKey] = [];
    currentBookData[chapterKey][verseKey].push(word);
  }

  flushBook();
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const sourceExists = fs.existsSync(SOURCE_DIR);
  const hasIndex = fs.existsSync(INDEX_PATH);

  if (!sourceExists) {
    if (hasIndex && fs.existsSync(HASH_PATH)) {
      console.log('OpenHebrewBible source not present; using committed outputs.');
      return;
    }
    throw new Error(`OpenHebrewBible source not found at ${SOURCE_DIR}. Commit data/openhebrewbible outputs or provide sources.`);
  }

  unzipIfNeeded(SOURCE_FILES.clauseTranslationZip, SOURCE_DIR);
  unzipIfNeeded(SOURCE_FILES.featuresZip, SOURCE_DIR);

  const hash = crypto.createHash('sha256');
  await hashFile(hash, SOURCE_FILES.versification);
  await hashFile(hash, SOURCE_FILES.alignments);
  await hashFile(hash, SOURCE_FILES.clauses);
  await hashFile(hash, SOURCE_FILES.paragraph);
  await hashFile(hash, SOURCE_FILES.poetry);
  await hashFile(hash, SOURCE_FILES.extendedGloss);
  await hashFile(hash, SOURCE_FILES.clauseTranslationCsv);
  await hashFile(hash, SOURCE_FILES.featuresCsv);
  const digest = hash.digest('hex');

  if (hasIndex && fs.existsSync(HASH_PATH)) {
    const prev = fs.readFileSync(HASH_PATH, 'utf8').trim();
    if (prev === digest) {
      console.log('OpenHebrewBible outputs are up to date; skipping regeneration.');
      return;
    }
  }

  const index: IndexMap = {};

  const verseMap = await parseVersificationMap();
  const clauseTranslations = await parseClauseTranslations();
  const extendedGlossMap = await parseExtendedGlossMap();

  const { bhsSortToVerse } = await parseAlignments(verseMap, index);
  await parseClauseSegmentation(verseMap, clauseTranslations, index);
  await parsePoeticDivision(verseMap, bhsSortToVerse, index);
  await parseGlossFeatures(extendedGlossMap, index);

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
  fs.writeFileSync(HASH_PATH, `${digest}\n`);
  console.log(`Wrote index -> ${INDEX_PATH}`);
}

main().catch((error) => {
  console.error('OpenHebrewBible build failed', error);
  process.exit(1);
});
