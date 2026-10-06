import fs from 'fs';
import path from 'path';
import { createClient } from '@libsql/client';

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL ?? '';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN ?? '';
if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  throw new Error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required (never hardcode them)');
}

const OT_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
  'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
]);

const BOOK_CODE_TO_NAME: Record<string, string> = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms',
  PRO: 'Proverbs', ECC: 'Ecclesiastes', SNG: 'Song of Songs', ISA: 'Isaiah',
  JER: 'Jeremiah', LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOL: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah',
  NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah',
  MAL: 'Malachi', MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John',
  ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
  GAL: 'Galatians', EPH: 'Ephesians', PHP: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy',
  '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews', JAS: 'James',
  '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John',
  '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

async function populateVerses() {
  const rootDir = process.cwd();
  const indexPath = path.join(rootDir, 'data', 'bible-full-index.json');
  console.log(`[1/3] Loading canonical verses from ${indexPath}...`);
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Record<string, { text: string }>;
  const entries = Object.entries(raw);
  console.log(`Loaded ${entries.length} verses.`);

  const client = createClient({
    url: TURSO_DATABASE_URL,
    authToken: TURSO_AUTH_TOKEN,
  });

  console.log('[2/3] Ensuring verses table exists...');
  await client.execute(`
    CREATE TABLE IF NOT EXISTS verses (
      id TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verse INTEGER NOT NULL,
      testament TEXT NOT NULL,
      text TEXT NOT NULL
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_verses_book_ch ON verses(book, chapter);`);

  console.log('[3/3] Inserting 31,086 verses into Turso in batches...');
  const BATCH_SIZE = 500;
  let batch: Array<{ sql: string; args: [string, string, number, number, string, string] }> = [];
  let inserted = 0;
  const start = Date.now();

  for (const [ref, item] of entries) {
    const parts = ref.split(' ');
    const bookCode = parts[0];
    const [chStr, vStr] = parts[1].split(':');
    const ch = parseInt(chStr, 10);
    const v = parseInt(vStr, 10);
    const bookName = BOOK_CODE_TO_NAME[bookCode] || bookCode;
    const testament = OT_BOOKS.has(bookCode) ? 'Old Testament' : 'New Testament';

    batch.push({
      sql: `INSERT OR REPLACE INTO verses (id, book, chapter, verse, testament, text) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [ref, bookName, ch, v, testament, item.text],
    });

    if (batch.length >= BATCH_SIZE) {
      await client.batch(batch, 'write');
      inserted += batch.length;
      batch = [];
      const pct = ((inserted / entries.length) * 100).toFixed(1);
      process.stdout.write(`\rInserted ${inserted}/${entries.length} verses (${pct}%)...`);
    }
  }

  if (batch.length > 0) {
    await client.batch(batch, 'write');
    inserted += batch.length;
  }

  console.log(`\nSuccess! Inserted ${inserted} verses in ${((Date.now() - start) / 1000).toFixed(1)}s.`);
  const count = await client.execute('SELECT COUNT(*) as total FROM verses');
  console.log(`Turso verses count: ${count.rows[0].total}`);
}

populateVerses().catch(err => {
  console.error('Failed to populate verses:', err);
  process.exit(1);
});
