import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';

type MorphWord = {
  t: string; // Hebrew text
  s: string; // Strong's number (e.g., H7225)
  m: string; // Morph code (e.g., HR/Ncfsa)
};

type BookData = Record<string, Record<string, MorphWord[]>>;

const SOURCE_DIR = path.join(process.cwd(), 'datasets', 'morphhb', 'wlc');
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'morphhb');
const HASH_PATH = path.join(OUTPUT_DIR, '.morphhb.hash');

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
  Mal: 'MAL'
};

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeWord(text: string): string {
  return decodeEntities(text).replace(/\//g, '').trim();
}

function lemmaToStrongs(lemmaRaw: string | undefined): string | null {
  if (!lemmaRaw) return null;
  const match = lemmaRaw.match(/(\d+)/);
  if (!match) return null;
  return `H${match[1]}`;
}

function parseVerseBlock(block: string): MorphWord[] {
  const words: MorphWord[] = [];
  const wordRegex = /<w\b([^>]*)>([\s\S]*?)<\/w>/g;
  let wordMatch: RegExpExecArray | null;
  while ((wordMatch = wordRegex.exec(block)) !== null) {
    const attr = wordMatch[1] || '';
    const text = normalizeWord(wordMatch[2] || '');
    if (!text) continue;

    const lemmaMatch = attr.match(/lemma="([^"]+)"/);
    const morphMatch = attr.match(/morph="([^"]+)"/);
    const strongs = lemmaToStrongs(lemmaMatch?.[1]);
    const morph = morphMatch?.[1] || '';

    if (!strongs) {
      continue;
    }

    words.push({ t: text, s: strongs, m: morph });
  }
  return words;
}

function parseBookFile(filePath: string): { book: string; data: BookData } {
  const xml = fs.readFileSync(filePath, 'utf8');
  const data: BookData = {};

  const verseRegex = /<verse\b[^>]*osisID="([^"]+)"[^>]*>([\s\S]*?)<\/verse>/g;
  let verseMatch: RegExpExecArray | null;
  let bookCode: string | null = null;

  while ((verseMatch = verseRegex.exec(xml)) !== null) {
    const osisId = verseMatch[1];
    const content = verseMatch[2];

    const parts = osisId.split('.');
    if (parts.length < 3) continue;
    const osisBook = parts[0];
    const chapter = parts[1];
    const verse = parts[2];

    const mappedBook = OSIS_TO_BOOK[osisBook];
    if (!mappedBook) {
      continue;
    }

    bookCode = mappedBook;

    const words = parseVerseBlock(content);
    if (words.length === 0) continue;

    if (!data[chapter]) data[chapter] = {};
    data[chapter][verse] = words;
  }

  if (!bookCode) {
    throw new Error(`Could not determine book code for ${filePath}`);
  }

  return { book: bookCode, data };
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function main() {
  ensureDir(OUTPUT_DIR);

  const files = fs.readdirSync(SOURCE_DIR)
    .filter((file) => file.endsWith('.xml'))
    .filter((file) => file !== 'VerseMap.xml')
    .sort();

  const hasOutputs = files.every((file) => {
    const book = file.replace(/\.xml$/, '');
    const mapped = OSIS_TO_BOOK[book];
    if (!mapped) return false;
    const gzPath = path.join(OUTPUT_DIR, `${mapped}.json.gz`);
    const brPath = path.join(OUTPUT_DIR, `${mapped}.json.br`);
    return fs.existsSync(gzPath) && fs.existsSync(brPath);
  });
  const indexPath = path.join(process.cwd(), 'data', 'morphhb-index.json');
  const hasIndex = fs.existsSync(indexPath);

  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const filePath = path.join(SOURCE_DIR, file);
    hash.update(fs.readFileSync(filePath));
  }
  const digest = hash.digest('hex');

  if (hasOutputs && hasIndex && fs.existsSync(HASH_PATH)) {
    const prev = fs.readFileSync(HASH_PATH, 'utf8').trim();
    if (prev === digest) {
      console.log('MorphHB outputs are up to date; skipping regeneration.');
      return;
    }
  }

  const index: Record<string, string> = {};

  for (const file of files) {
    const filePath = path.join(SOURCE_DIR, file);
    const { book, data } = parseBookFile(filePath);
    const outPath = path.join(OUTPUT_DIR, `${book}.json.gz`);
    const outPathBr = path.join(OUTPUT_DIR, `${book}.json.br`);
    const payload = Buffer.from(JSON.stringify(data));
    const gzipped = zlib.gzipSync(payload, { level: 9 });
    const brotli = zlib.brotliCompressSync(payload, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11
      }
    });
    fs.writeFileSync(outPath, gzipped);
    fs.writeFileSync(outPathBr, brotli);
    index[book] = `${book}.json.gz`;
    console.log(`Wrote ${book} -> ${outPath}`);
  }

  fs.writeFileSync(indexPath, JSON.stringify(index));
  fs.writeFileSync(HASH_PATH, `${digest}\n`);
  console.log(`Wrote index -> ${indexPath}`);
}

main();
