import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import readline from 'readline';

type TranslationBook = Record<string, Record<string, string>>;

const SOURCE_DIR = path.join(process.cwd(), 'datasets', 'bible_databases', 'formats', 'csv');
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'translations');
const INDEX_PATH = path.join(process.cwd(), 'data', 'translations-index.json');
const HASH_PATH = path.join(OUTPUT_DIR, '.translations.hash');

const TRANSLATION_FILES = [
  { code: 'BSB', file: 'BSB.csv', required: true },
  { code: 'KJV', file: 'KJV.csv', required: true },
  { code: 'NHEB', file: 'NHEB.csv', required: false },
  { code: 'ASV', file: 'ASV.csv', required: true }
];

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
  // Roman-numeral prefixed forms used by bible_databases CSVs (e.g. "I Samuel", "II Kings")
  isamuel: '1SA',
  iisamuel: '2SA',
  ikings: '1KI',
  iikings: '2KI',
  ichronicles: '1CH',
  iichronicles: '2CH',
  icorinthians: '1CO',
  iicorinthians: '2CO',
  ithessalonians: '1TH',
  iithessalonians: '2TH',
  itimothy: '1TI',
  iitimothy: '2TI',
  ipeter: '1PE',
  iipeter: '2PE',
  ijohn: '1JN',
  iijohn: '2JN',
  iiijohn: '3JN',
  revelationofjohn: 'REV',
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

const HEADER_TOKENS = new Set([
  'book',
  'bookname',
  'bookid',
  'chapter',
  'chap',
  'verse',
  'versenum',
  'text',
  'content',
  'reference',
  'ref'
]);

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeHeader(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function detectDelimiter(line: string): string {
  const evaluate = (delimiter: string) => {
    const parsed = parseDelimitedLine(line, delimiter);
    const normalized = parsed.map(normalizeHeader);
    const hasHeader = normalized.some((h) => HEADER_TOKENS.has(h));
    return { hasHeader };
  };

  const tabEval = evaluate('\t');
  const commaEval = evaluate(',');

  if (tabEval.hasHeader && !commaEval.hasHeader) return '\t';
  if (commaEval.hasHeader && !tabEval.hasHeader) return ',';
  if (line.includes('\t')) return '\t';
  return ',';
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const output: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      output.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  output.push(current);
  return output.map((value) => value.trim());
}

function normalizeBook(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const num = Number.parseInt(trimmed, 10);
    return BOOK_NUMBER_TO_CODE[num] || trimmed;
  }
  const cleaned = trimmed.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const mapped = BOOK_ALIASES[cleaned];
  if (mapped) return mapped;
  return trimmed.toUpperCase();
}

function parseReference(raw: string): { book: string; chapter: number; verse: number } | null {
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const match = cleaned.match(/^(.+?)\s+(\d+):(\d+)$/);
  if (match) {
    return {
      book: normalizeBook(match[1]),
      chapter: Number.parseInt(match[2], 10),
      verse: Number.parseInt(match[3], 10)
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

function gzipCompress(payload: Buffer) {
  return zlib.gzipSync(payload, { level: 9 });
}

function brotliCompress(payload: Buffer) {
  return zlib.brotliCompressSync(payload, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
}

async function parseTranslationFile(filePath: string): Promise<Record<string, TranslationBook>> {
  const fileStream = fs.createReadStream(filePath, 'utf8');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let headers: string[] | null = null;
  let headerMap: Map<string, number> | null = null;
  let delimiter = ',';
  const books: Record<string, TranslationBook> = {};
  let lineIndex = 0;
  let skipped = 0;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    if (lineIndex === 0) {
      delimiter = detectDelimiter(line);
      const parsed = parseDelimitedLine(line, delimiter);
      const normalized = parsed.map(normalizeHeader);
      const hasHeader = normalized.some((h) => HEADER_TOKENS.has(h));
      if (hasHeader) {
        headers = parsed;
        headerMap = new Map<string, number>();
        normalized.forEach((h, idx) => headerMap?.set(h, idx));
        lineIndex += 1;
        continue;
      }
    }

    const values = parseDelimitedLine(line, delimiter);
    let bookVal: string | undefined;
    let chapterVal: string | undefined;
    let verseVal: string | undefined;
    let textVal: string | undefined;
    let refVal: string | undefined;

    if (headerMap) {
      const pick = (keys: string[]) => {
        for (const key of keys) {
          const idx = headerMap?.get(key);
          if (idx !== undefined && values[idx]) return values[idx];
        }
        return undefined;
      };
      bookVal = pick(['book', 'bookname', 'bookid', 'osis', 'osisid']);
      chapterVal = pick(['chapter', 'chap', 'ch']);
      verseVal = pick(['verse', 'versenum', 'v']);
      textVal = pick(['text', 'versetext', 'content', 'versecontent']);
      refVal = pick(['reference', 'ref']);
    } else {
      bookVal = values[0];
      chapterVal = values[1];
      verseVal = values[2];
      textVal = values[3];
    }

    let ref: { book: string; chapter: number; verse: number } | null = null;
    if (bookVal && chapterVal && verseVal) {
      ref = {
        book: normalizeBook(bookVal),
        chapter: Number.parseInt(String(chapterVal), 10),
        verse: Number.parseInt(String(verseVal), 10)
      };
    } else if (refVal) {
      ref = parseReference(refVal);
    } else if (verseVal && typeof verseVal === 'string' && verseVal.includes(':')) {
      ref = parseReference(verseVal);
    }

    if (!ref || !textVal) {
      skipped += 1;
      lineIndex += 1;
      continue;
    }

    const bookCode = ref.book;
    if (!books[bookCode]) books[bookCode] = {};
    const chapterKey = String(ref.chapter);
    const verseKey = String(ref.verse);
    if (!books[bookCode][chapterKey]) books[bookCode][chapterKey] = {};
    books[bookCode][chapterKey][verseKey] = String(textVal).trim();
    lineIndex += 1;
  }

  if (skipped > 0) {
    console.warn(`Skipped ${skipped} rows in ${path.basename(filePath)} due to missing fields.`);
  }

  return books;
}

async function main() {
  ensureDir(OUTPUT_DIR);

  if (!fs.existsSync(SOURCE_DIR)) {
    if (fs.existsSync(INDEX_PATH) && fs.existsSync(HASH_PATH)) {
      console.log('Translations source not present; using committed outputs.');
      return;
    }
    throw new Error(
      `Translations source not found at:\n  ${SOURCE_DIR}\n\n` +
      `Expected KJV.csv, WEB.csv, ASV.csv inside that directory.\n` +
      `Make sure the bible_databases dataset is cloned into datasets/bible_databases/.`
    );
  }

  const availableEntries = TRANSLATION_FILES.filter((entry) => {
    const filePath = path.join(SOURCE_DIR, entry.file);
    if (!fs.existsSync(filePath)) {
      if (entry.required) {
        throw new Error(`Missing translation file at ${filePath}`);
      }
      console.warn(`Optional translation source missing for ${entry.code}: ${filePath}`);
      return false;
    }
    return true;
  });

  const hash = crypto.createHash('sha256');
  for (const entry of availableEntries) {
    const filePath = path.join(SOURCE_DIR, entry.file);
    hash.update(fs.readFileSync(filePath));
  }
  const digest = hash.digest('hex');

  if (fs.existsSync(INDEX_PATH) && fs.existsSync(HASH_PATH)) {
    const prev = fs.readFileSync(HASH_PATH, 'utf8').trim();
    if (prev === digest) {
      console.log('Translations outputs are up to date; skipping regeneration.');
      return;
    }
  }

  const index: Record<string, Record<string, string>> = {};

  for (const entry of availableEntries) {
    const filePath = path.join(SOURCE_DIR, entry.file);
    const books = await parseTranslationFile(filePath);
    index[entry.code] = {};

    for (const [book, data] of Object.entries(books)) {
      const fileBase = `${entry.code.toLowerCase()}-${book}.json`;
      const jsonPath = path.join(OUTPUT_DIR, fileBase);
      const gzPath = `${jsonPath}.gz`;
      const brPath = `${jsonPath}.br`;
      const payload = Buffer.from(JSON.stringify(data));
      fs.writeFileSync(jsonPath, payload);
      fs.writeFileSync(gzPath, gzipCompress(payload));
      fs.writeFileSync(brPath, brotliCompress(payload));
      index[entry.code][book] = `${fileBase}.br`;
      console.log(`Wrote ${entry.code} ${book} -> ${brPath}`);
    }
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index));
  fs.writeFileSync(HASH_PATH, `${digest}\n`);
  console.log(`Wrote index -> ${INDEX_PATH}`);
}

void main().catch((err) => {
  console.error('build-translations failed:', err);
  process.exitCode = 1;
});
