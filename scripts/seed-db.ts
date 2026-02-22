import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import * as xlsx from 'xlsx';
import { Pool } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

type VerseRow = {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  translation: string;
};

type VerseRef = {
  book: string;
  chapter: number;
  verse: number;
};

type CrossRefRow = {
  source: VerseRef;
  target: VerseRef;
  votes: number | null;
};

const POSTGRES_URL = process.env.POSTGRES_URL;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_EMBEDDING_MODEL = process.env.GROQ_EMBEDDING_MODEL;
const EMBEDDING_DIM = Number.parseInt(process.env.EMBEDDING_DIM || '', 10);

const BSB_XLSX_PATH = process.env.BSB_XLSX_PATH || path.join(process.cwd(), 'bereanstandardbible.xlsx');
const TSK_PATH =
  process.env.TSK_PATH || path.join(process.cwd(), 'datasets', 'cross_references.txt');
const STRONGS_GREEK_PATH =
  process.env.STRONGS_GREEK_PATH ||
  path.join(process.cwd(), 'strongs-master/greek/strongs-greek-dictionary.js');
const STRONGS_HEBREW_PATH =
  process.env.STRONGS_HEBREW_PATH ||
  path.join(process.cwd(), 'strongs-master/hebrew/strongs-hebrew-dictionary.js');

const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || '200', 10);
const EMBED_BATCH_SIZE = Number.parseInt(process.env.EMBED_BATCH_SIZE || '64', 10);

const BOOK_MAP: Record<string, string> = {
  genesis: 'GEN',
  gen: 'GEN',
  exodus: 'EXO',
  exod: 'EXO',
  exo: 'EXO',
  leviticus: 'LEV',
  lev: 'LEV',
  numbers: 'NUM',
  num: 'NUM',
  deuteronomy: 'DEU',
  deut: 'DEU',
  deuter: 'DEU',
  joshua: 'JOS',
  josh: 'JOS',
  jos: 'JOS',
  judges: 'JDG',
  judg: 'JDG',
  jdg: 'JDG',
  ruth: 'RUT',
  rut: 'RUT',
  '1samuel': '1SA',
  '1sam': '1SA',
  '1sa': '1SA',
  '2samuel': '2SA',
  '2sam': '2SA',
  '2sa': '2SA',
  '1kings': '1KI',
  '1kgs': '1KI',
  '1ki': '1KI',
  '2kings': '2KI',
  '2kgs': '2KI',
  '2ki': '2KI',
  '1chronicles': '1CH',
  '1chr': '1CH',
  '1ch': '1CH',
  '2chronicles': '2CH',
  '2chr': '2CH',
  '2ch': '2CH',
  ezra: 'EZR',
  ezr: 'EZR',
  nehemiah: 'NEH',
  neh: 'NEH',
  esther: 'EST',
  esth: 'EST',
  est: 'EST',
  job: 'JOB',
  psalms: 'PSA',
  psalm: 'PSA',
  ps: 'PSA',
  psa: 'PSA',
  proverbs: 'PRO',
  prov: 'PRO',
  pro: 'PRO',
  ecclesiastes: 'ECC',
  eccl: 'ECC',
  ecc: 'ECC',
  songofsongs: 'SNG',
  songofsolomon: 'SNG',
  song: 'SNG',
  canticles: 'SNG',
  cant: 'SNG',
  isaiah: 'ISA',
  isa: 'ISA',
  jeremiah: 'JER',
  jer: 'JER',
  lamentations: 'LAM',
  lam: 'LAM',
  ezekiel: 'EZK',
  ezek: 'EZK',
  ezk: 'EZK',
  daniel: 'DAN',
  dan: 'DAN',
  hosea: 'HOS',
  hos: 'HOS',
  joel: 'JOL',
  jol: 'JOL',
  amos: 'AMO',
  amo: 'AMO',
  obadiah: 'OBA',
  obad: 'OBA',
  oba: 'OBA',
  jonah: 'JON',
  jon: 'JON',
  micah: 'MIC',
  mic: 'MIC',
  nahum: 'NAM',
  nah: 'NAM',
  habakkuk: 'HAB',
  hab: 'HAB',
  zephaniah: 'ZEP',
  zeph: 'ZEP',
  zep: 'ZEP',
  haggai: 'HAG',
  hag: 'HAG',
  zechariah: 'ZEC',
  zech: 'ZEC',
  zec: 'ZEC',
  malachi: 'MAL',
  mal: 'MAL',
  matthew: 'MAT',
  matt: 'MAT',
  mat: 'MAT',
  mark: 'MRK',
  mrk: 'MRK',
  luke: 'LUK',
  luk: 'LUK',
  john: 'JHN',
  jhn: 'JHN',
  acts: 'ACT',
  act: 'ACT',
  romans: 'ROM',
  rom: 'ROM',
  '1corinthians': '1CO',
  '1cor': '1CO',
  '1co': '1CO',
  '2corinthians': '2CO',
  '2cor': '2CO',
  '2co': '2CO',
  galatians: 'GAL',
  gal: 'GAL',
  ephesians: 'EPH',
  eph: 'EPH',
  philippians: 'PHP',
  phil: 'PHP',
  php: 'PHP',
  colossians: 'COL',
  col: 'COL',
  '1thessalonians': '1TH',
  '1thess': '1TH',
  '1th': '1TH',
  '2thessalonians': '2TH',
  '2thess': '2TH',
  '2th': '2TH',
  '1timothy': '1TI',
  '1tim': '1TI',
  '1ti': '1TI',
  '2timothy': '2TI',
  '2tim': '2TI',
  '2ti': '2TI',
  titus: 'TIT',
  tit: 'TIT',
  philemon: 'PHM',
  philem: 'PHM',
  phlm: 'PHM',
  phm: 'PHM',
  hebrews: 'HEB',
  heb: 'HEB',
  james: 'JAS',
  jas: 'JAS',
  '1peter': '1PE',
  '1pet': '1PE',
  '1pe': '1PE',
  '2peter': '2PE',
  '2pet': '2PE',
  '2pe': '2PE',
  '1john': '1JN',
  '1jn': '1JN',
  '2john': '2JN',
  '2jn': '2JN',
  '3john': '3JN',
  '3jn': '3JN',
  jude: 'JUD',
  jud: 'JUD',
  revelation: 'REV',
  rev: 'REV'
};

function normalizeBook(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const mapped = BOOK_MAP[cleaned];
  if (!mapped) {
    throw new Error(`Unknown book token: ${raw}`);
  }
  return mapped;
}

function parseReference(ref: string): VerseRef {
  const match = ref.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid reference: ${ref}`);
  }
  return {
    book: normalizeBook(match[1]),
    chapter: Number.parseInt(match[2], 10),
    verse: Number.parseInt(match[3], 10)
  };
}

function parseRange(ref: string): VerseRef[] {
  if (!ref.includes('-')) {
    return [parseReference(ref)];
  }
  const [startRaw, endRaw] = ref.split('-');
  const start = parseReference(startRaw);
  const end = parseReference(endRaw);
  if (start.book !== end.book || start.chapter !== end.chapter) {
    return [start, end];
  }
  const out: VerseRef[] = [];
  for (let v = start.verse; v <= end.verse; v += 1) {
    out.push({ book: start.book, chapter: start.chapter, verse: v });
  }
  return out;
}

function normalizeHeader(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function extractVerseRow(row: Record<string, unknown>, translation: string): VerseRow | null {
  const entries = Object.entries(row);
  const headerMap = new Map<string, unknown>();
  for (const [key, value] of entries) {
    headerMap.set(normalizeHeader(key), value);
  }

  const bookVal = headerMap.get('book') ?? headerMap.get('bookname');
  const chapterVal = headerMap.get('chapter') ?? headerMap.get('chap');
  const verseVal = headerMap.get('verse') ?? headerMap.get('versenum') ?? headerMap.get('v');
  const textVal =
    headerMap.get('text') ??
    headerMap.get('versetext') ??
    headerMap.get('bereanstandardbible') ??
    headerMap.get('bsb') ??
    headerMap.get('content');
  let refVal = headerMap.get('reference') ?? headerMap.get('ref');
  if (!refVal && typeof verseVal === 'string' && verseVal.includes(':')) {
    refVal = verseVal;
  }

  if (bookVal && chapterVal && verseVal && textVal) {
    return {
      book: normalizeBook(String(bookVal)),
      chapter: Number.parseInt(String(chapterVal), 10),
      verse: Number.parseInt(String(verseVal), 10),
      text: String(textVal).trim(),
      translation
    };
  }

  if (refVal && textVal) {
    const refMatch = String(refVal).match(/^(.+?)\s+(\d+):(\d+)$/);
    if (!refMatch) {
      return null;
    }
    return {
      book: normalizeBook(refMatch[1]),
      chapter: Number.parseInt(refMatch[2], 10),
      verse: Number.parseInt(refMatch[3], 10),
      text: String(textVal).trim(),
      translation
    };
  }

  return null;
}

async function loadBsbVerses(): Promise<VerseRow[]> {
  if (!fs.existsSync(BSB_XLSX_PATH)) {
    throw new Error(`BSB file not found at ${BSB_XLSX_PATH}`);
  }
  const workbook = xlsx.readFile(BSB_XLSX_PATH, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error('No sheets found in BSB workbook');
  }

  const rows = xlsx.utils.sheet_to_json<unknown[]>(sheet, {
    defval: '',
    header: 1
  });

  const verses: VerseRow[] = [];
  let skippedEmpty = 0;
  let skippedRegex = 0;

  for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
    const rawRow = rows[rowIndex];
    const row = Array.isArray(rawRow) ? rawRow : [];
    const verseRef = String(row[1] ?? '')
      .trim()
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const text = String(row[2] ?? '').trim();

    if (!verseRef || !text) {
      skippedEmpty += 1;
      continue;
    }

    const match = verseRef.match(/^(.+?)\s*(\d+):(\d+)$/);
    if (!match) {
      skippedRegex += 1;
      continue;
    }

    verses.push({
      book: normalizeBook(match[1]),
      chapter: Number.parseInt(match[2], 10),
      verse: Number.parseInt(match[3], 10),
      text,
      translation: 'BSB'
    });
  }

  console.info(
    `BSB parse debug: skipped ${skippedEmpty} empty rows, ${skippedRegex} regex failures.`
  );

  if (verses.length !== 31102) {
    console.warn(`Warning: Expected 31102 verses, but parsed ${verses.length}.`);
  }

  return verses;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.groq.com/openai/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_EMBEDDING_MODEL,
      input: texts
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq embeddings failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  const embeddings = data.data.map((item) => item.embedding);
  if (embeddings.length === 0) {
    throw new Error('Groq embeddings returned empty data');
  }
  if (Number.isFinite(EMBEDDING_DIM) && embeddings[0].length !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding dimension mismatch. Expected ${EMBEDDING_DIM}, got ${embeddings[0].length}.`,
    );
  }
  return embeddings;
}

function toVectorString(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function insertVerseBatch(pool: Pool, rows: VerseRow[], embeddings?: number[][]) {
  const values: Array<string | number | null> = [];
  const placeholders: string[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const base = i * 6;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`,
    );
    const embeddingValue = embeddings ? toVectorString(embeddings[i]) : null;
    values.push(
      row.book,
      row.chapter,
      row.verse,
      row.text,
      row.translation,
      embeddingValue,
    );
  }

  await pool.query(
    `INSERT INTO verses (book, chapter, verse, text, translation, embedding)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (book, chapter, verse, translation) DO UPDATE SET
       text = EXCLUDED.text,
       embedding = COALESCE(EXCLUDED.embedding, verses.embedding)`,
    values,
  );
}

async function seedVerses(pool: Pool) {
  const verses = await loadBsbVerses();
  console.log(`Loaded ${verses.length} BSB verses`);

  const canEmbed = Boolean(GROQ_API_KEY && GROQ_EMBEDDING_MODEL);
  if (!canEmbed) {
    console.log('Skipping embeddings during seeding (GROQ_EMBEDDING_MODEL not set).');
  }

  for (let i = 0; i < verses.length; i += EMBED_BATCH_SIZE) {
    const batch = verses.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = canEmbed ? await embedTexts(batch.map((row) => row.text)) : undefined;
    await insertVerseBatch(pool, batch, embeddings);
    console.log(`Inserted verses ${i + 1}-${i + batch.length}`);
  }
}

async function insertCrossReferenceBatch(pool: Pool, rows: CrossRefRow[]) {
  const values: Array<string | number | null> = [];
  const placeholders: string[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const base = i * 7;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
    );
    values.push(
      row.source.book,
      row.source.chapter,
      row.source.verse,
      row.target.book,
      row.target.chapter,
      row.target.verse,
      row.votes,
    );
  }

  await pool.query(
    `INSERT INTO cross_references (
      source_book,
      source_chapter,
      source_verse,
      target_book,
      target_chapter,
      target_verse,
      votes
    ) VALUES ${placeholders.join(', ')}
     ON CONFLICT DO NOTHING`,
    values,
  );
}

async function seedCrossReferences(pool: Pool) {
  if (!fs.existsSync(TSK_PATH)) {
    throw new Error(`TSK file not found at ${TSK_PATH}`);
  }

  const stream = fs.createReadStream(TSK_PATH, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const allRows: CrossRefRow[] = [];
  let isHeader = true;
  let skipped = 0;

  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (!line.trim()) continue;

    const parts = line.split('\t');
    if (parts.length < 2) continue;

    let fromRefs: VerseRef[] = [];
    let toRefs: VerseRef[] = [];

    try {
      fromRefs = parseRange(parts[0]);
      toRefs = parseRange(parts[1]);
    } catch {
      skipped++;
      continue;
    }

    const votes = parts.length >= 3 ? Number.parseInt(parts[2], 10) : null;

    for (const source of fromRefs) {
      for (const target of toRefs) {
        allRows.push({
          source,
          target,
          votes: Number.isNaN(votes) ? null : votes
        });
      }
    }
  }

  rl.close();
  stream.close();

  console.log(`Parsed ${allRows.length} cross references`);

  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    await insertCrossReferenceBatch(pool, batch);
    console.log(`Inserted ${i + batch.length}`);
  }

  if (skipped > 0) {
    console.log(`Skipped ${skipped} invalid lines`);
  }
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Failed to locate JSON object in Strong\'s file');
  }
  return text.slice(start, end + 1);
}

function loadStrongsDictionary(filePath: string): Record<string, Record<string, string>> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Strong's file not found at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const jsonText = extractJsonObject(raw);
  return JSON.parse(jsonText) as Record<string, Record<string, string>>;
}

async function insertStrongsBatch(
  pool: Pool,
  rows: Array<{
    strongsId: string;
    language: string;
    lemma: string;
    transliteration: string;
    pronunciation: string;
    definition: string;
    gloss: string;
  }>,
) {
  const values: Array<string> = [];
  const placeholders: string[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const base = i * 7;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`,
    );
    values.push(
      row.strongsId,
      row.language,
      row.lemma,
      row.transliteration,
      row.pronunciation,
      row.definition,
      row.gloss,
    );
  }

  await pool.query(
    `INSERT INTO strongs_dictionary (
      strongs_id,
      language,
      lemma,
      transliteration,
      pronunciation,
      definition,
      gloss
    ) VALUES ${placeholders.join(', ')}
     ON CONFLICT (strongs_id) DO UPDATE SET
       lemma = EXCLUDED.lemma,
       transliteration = EXCLUDED.transliteration,
       pronunciation = EXCLUDED.pronunciation,
       definition = EXCLUDED.definition,
       gloss = EXCLUDED.gloss`,
    values,
  );
}

async function seedStrongs(pool: Pool) {
  const hebrew = loadStrongsDictionary(STRONGS_HEBREW_PATH);
  const greek = loadStrongsDictionary(STRONGS_GREEK_PATH);

  const rows: Array<{
    strongsId: string;
    language: string;
    lemma: string;
    transliteration: string;
    pronunciation: string;
    definition: string;
    gloss: string;
  }> = [];

  for (const [strongsId, entry] of Object.entries(hebrew)) {
    rows.push({
      strongsId,
      language: 'hebrew',
      lemma: entry.lemma || '',
      transliteration: entry.xlit || '',
      pronunciation: entry.pron || '',
      definition: entry.strongs_def || '',
      gloss: entry.kjv_def || ''
    });
  }

  for (const [strongsId, entry] of Object.entries(greek)) {
    rows.push({
      strongsId,
      language: 'greek',
      lemma: entry.lemma || '',
      transliteration: entry.translit || '',
      pronunciation: '',
      definition: entry.strongs_def || '',
      gloss: entry.kjv_def || ''
    });
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await insertStrongsBatch(pool, batch);
    console.log(`Inserted ${Math.min(i + BATCH_SIZE, rows.length)} strongs entries`);
  }
}

async function ensureSchema(pool: Pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
  await pool.query(
    `ALTER TABLE verses ADD COLUMN IF NOT EXISTS translation TEXT NOT NULL DEFAULT 'BSB';`,
  );
  await pool.query(
    `ALTER TABLE verses ADD COLUMN IF NOT EXISTS embedding vector(384);`,
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS verses_unique
     ON verses (book, chapter, verse, translation);`,
  );
  await pool.query(`ALTER TABLE cross_references ADD COLUMN IF NOT EXISTS votes INT;`);
  await pool.query(
    `WITH ranked AS (
       SELECT
         ctid,
         ROW_NUMBER() OVER (
           PARTITION BY source_book,
                        source_chapter,
                        source_verse,
                        target_book,
                        target_chapter,
                        target_verse
           ORDER BY ctid
         ) AS rn
       FROM cross_references
     )
     DELETE FROM cross_references
     WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1);`,
  );
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS cross_references_unique
     ON cross_references (
       source_book,
       source_chapter,
       source_verse,
       target_book,
       target_chapter,
       target_verse
     );`,
  );
}

async function main() {
  if (!POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not set');
  }
  if (GROQ_API_KEY && GROQ_EMBEDDING_MODEL && !Number.isFinite(EMBEDDING_DIM)) {
    throw new Error('EMBEDDING_DIM is not set');
  }

  const pool = new Pool({ connectionString: POSTGRES_URL });

  try {
    await ensureSchema(pool);
    await seedStrongs(pool);
    await seedCrossReferences(pool);
    await seedVerses(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
