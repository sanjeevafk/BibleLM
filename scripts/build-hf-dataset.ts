import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.resolve(__dirname, '../data');
const bibleIndexFile = path.resolve(DATA_DIR, 'bible-full-index.json');
const outJsonlFile = path.resolve(DATA_DIR, 'train.jsonl');

const BOOK_NAMES: Record<string, string> = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', EST: 'Esther', JOB: 'Job', PSA: 'Psalms',
  PRO: 'Proverbs', ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah',
  JER: 'Jeremiah', LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOL: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah',
  NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah',
  MAL: 'Malachi', MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John',
  ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
  GAL: 'Galatians', EPH: 'Ephesians', PHP: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy',
  '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews',
  JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John',
  '2JN': '2 John', '3JN': '3 John', JUD: 'Jude', REV: 'Revelation'
};

console.log('Reading bible-full-index.json...');
const raw = JSON.parse(fs.readFileSync(bibleIndexFile, 'utf8'));

const lines: string[] = [];
for (const [key, item] of Object.entries<any>(raw)) {
  const match = key.match(/^([1-3]?[A-Z]+)\s+(\d+):(\d+)$/);
  const bookCode = match ? match[1] : '';
  const chapter = match ? Number.parseInt(match[2], 10) : 0;
  const verse = match ? Number.parseInt(match[3], 10) : 0;
  const bookName = BOOK_NAMES[bookCode] || bookCode;

  const record = {
    reference: item.reference || key,
    book_code: bookCode,
    book: bookName,
    chapter,
    verse,
    text: item.text || '',
    translation: item.translation || 'BSB'
  };

  lines.push(JSON.stringify(record));
}

fs.writeFileSync(outJsonlFile, lines.join('\n') + '\n', 'utf8');
console.log(`Wrote ${lines.length} records to ${outJsonlFile} (${(fs.statSync(outJsonlFile).size / 1024 / 1024).toFixed(2)} MB)`);
