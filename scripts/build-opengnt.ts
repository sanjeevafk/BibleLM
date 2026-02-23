import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import readline from 'readline';
import { execFileSync } from 'child_process';

type MorphBook = Record<string, Record<string, Array<{ w: string; s?: string; r?: string; d?: string; l?: string }>>>;
type InterlinearBook = Record<string, Record<string, Array<{ w: string; i?: string }>>>;
type ClauseBook = {
  verses: Record<string, Record<string, { ids: string[] }>>;
  clauses?: Record<string, { st?: string }>;
};

const SOURCE_DIR = path.join(process.cwd(), '..', 'datasets', 'OpenGNT');
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'opengnt');
const INDEX_PATH = path.join(process.cwd(), 'data', 'opengnt-index.json');
const HASH_PATH = path.join(OUTPUT_DIR, '.opengnt.hash');

const SOURCE_FILES = {
  baseTextZip: path.join(SOURCE_DIR, 'OpenGNT_BASE_TEXT.zip'),
  baseTextCsv: path.join(SOURCE_DIR, 'OpenGNT_version3_3.csv'),
  keyedZip: path.join(SOURCE_DIR, 'OpenGNT_keyedFeatures.csv.zip'),
  keyedCsv: path.join(SOURCE_DIR, 'OpenGNT_keyedFeatures.csv'),
  morphZip: path.join(SOURCE_DIR, 'OpenGNT_morphology_English.csv.zip'),
  morphCsv: path.join(SOURCE_DIR, 'OpenGNT_morphology_English.csv'),
  interlinearZip: path.join(SOURCE_DIR, 'OpenGNT_interlinear_Berean.csv.zip'),
  interlinearCsv: path.join(SOURCE_DIR, 'OpenGNT_interlinear_Berean.csv'),
  clauseZip: path.join(SOURCE_DIR, 'OpenGNT_TranslationByClause.csv.zip'),
  clauseCsv: path.join(SOURCE_DIR, 'OpenGNT_TranslationByClause.csv')
};

const BOOK_NUM_TO_CODE: Record<number, string> = {
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

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function unzipIfNeeded(zipPath: string, outDir: string, expectedFile: string) {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`Missing zip file at ${zipPath}`);
  }
  const target = path.join(outDir, expectedFile);
  if (fs.existsSync(target)) return;
  execFileSync('unzip', ['-o', zipPath, '-d', outDir], { stdio: 'inherit' });
  if (!fs.existsSync(target)) {
    throw new Error(`Expected unzip output at ${target}`);
  }
}

function parseBracketField(raw: string): string[] {
  const cleaned = raw.replace(/[〔〕]/g, '').trim();
  if (!cleaned) return [];
  return cleaned.split('｜').map((part) => part.trim());
}

function gzipCompress(payload: Buffer) {
  return zlib.gzipSync(payload, { level: 9 });
}

function brotliCompress(payload: Buffer) {
  return zlib.brotliCompressSync(payload, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
}

async function loadMorphologyMap(): Promise<Map<string, { s?: string; r?: string; d?: string }>> {
  const map = new Map<string, { s?: string; r?: string; d?: string }>();
  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.morphCsv),
    crlfDelay: Infinity
  });
  let isHeader = true;
  for await (const line of rl) {
    const cleanLine = line.replace(/^\uFEFF/, '');
    if (!cleanLine.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (cleanLine.startsWith('OGNTsort')) continue;
    }
    const parts = cleanLine.split('\t');
    if (parts.length < 4) continue;
    const ogntSort = parts[0]?.trim();
    if (!ogntSort) continue;
    map.set(ogntSort, {
      s: parts[1]?.trim() || undefined,
      r: parts[2]?.trim() || undefined,
      d: parts[3]?.trim() || undefined
    });
  }
  return map;
}

async function loadInterlinearMap(): Promise<Map<string, { it?: string; lt?: string; st?: string }>> {
  const map = new Map<string, { it?: string; lt?: string; st?: string }>();
  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.interlinearCsv),
    crlfDelay: Infinity
  });
  for await (const line of rl) {
    const cleanLine = line.replace(/^\uFEFF/, '');
    if (!cleanLine.trim()) continue;
    const parts = cleanLine.split('\t');
    if (parts.length < 2) continue;
    const ogntSort = parts[0]?.trim();
    if (!ogntSort || !/^\d+$/.test(ogntSort)) continue;
    const payload = parts.slice(1).join('\t').trim();
    const segments = payload.split('｜').map((seg) => seg.trim());
    map.set(ogntSort, {
      it: segments[0] || undefined,
      lt: segments[1] || undefined,
      st: segments[2] || undefined
    });
  }
  return map;
}

async function loadClauseMap(): Promise<Map<string, { clauseTag?: string; clauseId?: string }>> {
  const map = new Map<string, { clauseTag?: string; clauseId?: string }>();
  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.keyedCsv),
    crlfDelay: Infinity
  });
  let isHeader = true;
  for await (const line of rl) {
    const cleanLine = line.replace(/^\uFEFF/, '');
    if (!cleanLine.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (cleanLine.startsWith('FEATURESsort1')) continue;
    }
    const parts = cleanLine.split('\t');
    if (parts.length < 7) continue;
    const ogntField = parseBracketField(parts[5] || '');
    const clauseField = parseBracketField(parts[6] || '');
    const ogntSort = ogntField[0]?.trim();
    if (!ogntSort) continue;
    map.set(ogntSort, {
      clauseTag: clauseField[3]?.trim() || undefined,
      clauseId: clauseField[4]?.trim() || undefined
    });
  }
  return map;
}

async function loadClauseTranslations(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.clauseCsv),
    crlfDelay: Infinity
  });
  let isHeader = true;
  for await (const line of rl) {
    const cleanLine = line.replace(/^\uFEFF/, '');
    if (!cleanLine.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (cleanLine.startsWith('LevinsohnClauseID')) continue;
    }
    const parts = cleanLine.split('\t');
    if (parts.length < 4) continue;
    const clauseId = parts[0]?.trim();
    const st = parts[3]?.trim();
    if (clauseId && st) {
      map.set(clauseId, st);
    }
  }
  return map;
}

function ensureMorphVerse(
  books: Record<string, MorphBook>,
  book: string,
  chapter: string,
  verse: string
) {
  if (!books[book]) books[book] = {};
  if (!books[book][chapter]) books[book][chapter] = {};
  if (!books[book][chapter][verse]) books[book][chapter][verse] = [];
  return books[book][chapter][verse];
}

function ensureInterlinearVerse(
  books: Record<string, InterlinearBook>,
  book: string,
  chapter: string,
  verse: string
) {
  if (!books[book]) books[book] = {};
  if (!books[book][chapter]) books[book][chapter] = {};
  if (!books[book][chapter][verse]) books[book][chapter][verse] = [];
  return books[book][chapter][verse];
}

function ensureClauseVerse(
  books: Record<string, ClauseBook>,
  book: string,
  chapter: string,
  verse: string
) {
  if (!books[book]) books[book] = { verses: {} };
  if (!books[book].verses[chapter]) books[book].verses[chapter] = {};
  if (!books[book].verses[chapter][verse]) {
    books[book].verses[chapter][verse] = { ids: [] };
  }
  return books[book].verses[chapter][verse];
}

async function main() {
  ensureDir(OUTPUT_DIR);

  if (!fs.existsSync(SOURCE_DIR)) {
    if (fs.existsSync(INDEX_PATH) && fs.existsSync(HASH_PATH)) {
      console.log('OpenGNT source not present; using committed outputs.');
      return;
    }
    console.warn(
      `OpenGNT source not found at ${SOURCE_DIR}. ` +
        'Skipping generation; commit data/opengnt outputs or provide sources.'
    );
    return;
  }

  const requiredZips = [
    SOURCE_FILES.baseTextZip,
    SOURCE_FILES.keyedZip,
    SOURCE_FILES.morphZip,
    SOURCE_FILES.interlinearZip,
    SOURCE_FILES.clauseZip
  ];

  for (const zipPath of requiredZips) {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Missing OpenGNT source zip at ${zipPath}`);
    }
  }

  const hash = crypto.createHash('sha256');
  for (const zipPath of requiredZips) {
    hash.update(fs.readFileSync(zipPath));
  }
  const digest = hash.digest('hex');

  if (fs.existsSync(INDEX_PATH) && fs.existsSync(HASH_PATH)) {
    const prev = fs.readFileSync(HASH_PATH, 'utf8').trim();
    if (prev === digest) {
      console.log('OpenGNT outputs are up to date; skipping regeneration.');
      return;
    }
  }

  unzipIfNeeded(SOURCE_FILES.baseTextZip, SOURCE_DIR, path.basename(SOURCE_FILES.baseTextCsv));
  unzipIfNeeded(SOURCE_FILES.keyedZip, SOURCE_DIR, path.basename(SOURCE_FILES.keyedCsv));
  unzipIfNeeded(SOURCE_FILES.morphZip, SOURCE_DIR, path.basename(SOURCE_FILES.morphCsv));
  unzipIfNeeded(SOURCE_FILES.interlinearZip, SOURCE_DIR, path.basename(SOURCE_FILES.interlinearCsv));
  unzipIfNeeded(SOURCE_FILES.clauseZip, SOURCE_DIR, path.basename(SOURCE_FILES.clauseCsv));

  const [morphMap, interlinearMap, clauseMap, clauseTranslations] = await Promise.all([
    loadMorphologyMap(),
    loadInterlinearMap(),
    loadClauseMap(),
    loadClauseTranslations()
  ]);

  const morphBooks: Record<string, MorphBook> = {};
  const interlinearBooks: Record<string, InterlinearBook> = {};
  const clauseBooks: Record<string, ClauseBook> = {};
  const clauseIdsByBook: Record<string, Set<string>> = {};

  const rl = readline.createInterface({
    input: fs.createReadStream(SOURCE_FILES.baseTextCsv),
    crlfDelay: Infinity
  });

  let isHeader = true;
  for await (const line of rl) {
    const cleanLine = line.replace(/^\uFEFF/, '');
    if (!cleanLine.trim()) continue;
    if (isHeader) {
      isHeader = false;
      if (cleanLine.startsWith('OGNTsort')) continue;
    }
    const parts = cleanLine.split('\t');
    if (parts.length < 8) continue;
    const ogntSort = parts[0]?.trim();
    if (!ogntSort) continue;
    const clauseIdRaw = parts[3]?.trim();
    const bookParts = parseBracketField(parts[6] || '');
    if (bookParts.length < 3) continue;
    const bookNum = Number.parseInt(bookParts[0], 10);
    const chapterNum = Number.parseInt(bookParts[1], 10);
    const verseNum = Number.parseInt(bookParts[2], 10);
    const bookCode = BOOK_NUM_TO_CODE[bookNum];
    if (!bookCode) continue;
    if (Number.isNaN(chapterNum) || Number.isNaN(verseNum)) continue;

    const wordParts = parseBracketField(parts[7] || '');
    const greek = wordParts[2] || wordParts[1] || wordParts[0] || '';
    const lexeme = wordParts[3] || '';
    const rmac = wordParts[4] || '';
    const strongs = wordParts[5] || '';

    const morphInfo = morphMap.get(ogntSort);
    const interlinearInfo = interlinearMap.get(ogntSort);
    const clauseInfo = clauseMap.get(ogntSort);
    const clauseId = clauseInfo?.clauseId || clauseIdRaw || '';

    const chapterKey = String(chapterNum);
    const verseKey = String(verseNum);

    const morphVerse = ensureMorphVerse(morphBooks, bookCode, chapterKey, verseKey);
    morphVerse.push({
      w: greek,
      s: strongs || morphInfo?.s,
      r: rmac || morphInfo?.r,
      d: morphInfo?.d,
      l: lexeme || undefined
    });

    if (interlinearInfo?.it || greek) {
      const interVerse = ensureInterlinearVerse(interlinearBooks, bookCode, chapterKey, verseKey);
      interVerse.push({
        w: greek,
        i: interlinearInfo?.it || undefined
      });
    }

    if (clauseId) {
      const clauseVerse = ensureClauseVerse(clauseBooks, bookCode, chapterKey, verseKey);
      if (!clauseVerse.ids.includes(clauseId)) {
        clauseVerse.ids.push(clauseId);
      }
      if (!clauseIdsByBook[bookCode]) clauseIdsByBook[bookCode] = new Set<string>();
      clauseIdsByBook[bookCode].add(clauseId);
    }
  }

  for (const [book, clauseBook] of Object.entries(clauseBooks)) {
    const ids = clauseIdsByBook[book];
    if (!ids) continue;
    const meta: Record<string, { st?: string }> = {};
    for (const id of ids) {
      const st = clauseTranslations.get(id);
      if (st) meta[id] = { st };
    }
    if (Object.keys(meta).length > 0) {
      clauseBook.clauses = meta;
    }
  }

  const index: Record<string, { morph?: string; interlinear?: string; clause?: string }> = {};

  const writeLayer = (book: string, layer: 'morph' | 'interlinear' | 'clause', payload: unknown) => {
    const baseName = `opengnt-${layer}-${book}.json`;
    const jsonPath = path.join(OUTPUT_DIR, baseName);
    const buffer = Buffer.from(JSON.stringify(payload));
    fs.writeFileSync(jsonPath, buffer);
    fs.writeFileSync(`${jsonPath}.gz`, gzipCompress(buffer));
    fs.writeFileSync(`${jsonPath}.br`, brotliCompress(buffer));
    if (!index[book]) index[book] = {};
    index[book][layer] = `${baseName}.br`;
    console.log(`Wrote ${layer} ${book} -> ${jsonPath}.br`);
  };

  for (const [book, data] of Object.entries(morphBooks)) {
    writeLayer(book, 'morph', data);
  }
  for (const [book, data] of Object.entries(interlinearBooks)) {
    writeLayer(book, 'interlinear', data);
  }
  for (const [book, data] of Object.entries(clauseBooks)) {
    writeLayer(book, 'clause', data);
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
  fs.writeFileSync(HASH_PATH, `${digest}\n`);
  console.log(`Wrote index -> ${INDEX_PATH}`);
}

void main().catch((err) => {
  console.error('build-opengnt failed:', err);
  process.exitCode = 1;
});
