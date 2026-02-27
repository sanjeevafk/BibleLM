import fs from 'fs/promises';
import path from 'path';

type VerseIndexEntry = {
  reference: string;
  text: string;
};

type VerseGenre = 'law' | 'historical' | 'poetic' | 'prophetic' | 'gospel' | 'epistle' | 'apocalyptic';
type VerseMetadata = {
  verseId: string;
  testament: 'OT' | 'NT';
  genre: VerseGenre;
  themeTags: string[];
};

const LAW_BOOKS = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU'];
const HISTORICAL_BOOKS = ['JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'ACT'];
const POETIC_BOOKS = ['JOB', 'PSA', 'PRO', 'ECC', 'SNG'];
const PROPHETIC_BOOKS = [
  'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
  'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'
];
const GOSPEL_BOOKS = ['MAT', 'MRK', 'LUK', 'JHN'];
const EPISTLE_BOOKS = [
  'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP', 'COL', '1TH', '2TH', '1TI', '2TI',
  'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD'
];
const APOCALYPTIC_BOOKS = ['REV'];

const BOOK_GENRE_MAP: Record<string, VerseGenre> = {};
const addToMap = (books: string[], genre: VerseGenre) => {
  for (const book of books) {
    BOOK_GENRE_MAP[book] = genre;
  }
};

addToMap(LAW_BOOKS, 'law');
addToMap(HISTORICAL_BOOKS, 'historical');
addToMap(POETIC_BOOKS, 'poetic');
addToMap(PROPHETIC_BOOKS, 'prophetic');
addToMap(GOSPEL_BOOKS, 'gospel');
addToMap(EPISTLE_BOOKS, 'epistle');
addToMap(APOCALYPTIC_BOOKS, 'apocalyptic');

const OT_BOOKS = new Set([...LAW_BOOKS, ...HISTORICAL_BOOKS.filter((b) => b !== 'ACT'), ...POETIC_BOOKS, ...PROPHETIC_BOOKS]);
const NT_BOOKS = new Set([...GOSPEL_BOOKS, 'ACT', ...EPISTLE_BOOKS, ...APOCALYPTIC_BOOKS]);

const THEME_RULES: Array<{ tag: string; keywords: string[] }> = [
  {
    tag: 'messianic',
    keywords: ['messiah', 'anointed', 'branch', 'servant', 'son of david']
  },
  {
    tag: 'covenant',
    keywords: ['covenant', 'promise', 'law', 'new covenant']
  },
  {
    tag: 'resurrection',
    keywords: ['resurrection', 'rise', 'third day']
  },
  {
    tag: 'eschatology',
    keywords: ['end times', 'beast', 'judgment', 'tribulation']
  }
];

function containsKeyword(text: string, keyword: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  if (lowerKeyword.includes(' ')) {
    return lowerText.includes(lowerKeyword);
  }
  const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(lowerText);
}

function getBookCode(reference: string): string | null {
  const [book] = reference.trim().split(/\s+/);
  if (!book) return null;
  return book.toUpperCase();
}

async function buildMetadata() {
  const indexPath = path.join(process.cwd(), 'data', 'bible-index.json');
  const raw = await fs.readFile(indexPath, 'utf8');
  const entries = JSON.parse(raw) as Record<string, VerseIndexEntry>;
  const metadata: VerseMetadata[] = [];

  const keys = Object.keys(entries).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    const entry = entries[key];
    if (!entry?.reference || !entry?.text) continue;
    const book = getBookCode(entry.reference);
    if (!book) continue;

    const testament = OT_BOOKS.has(book) ? 'OT' : NT_BOOKS.has(book) ? 'NT' : null;
    const genre = BOOK_GENRE_MAP[book];
    if (!testament || !genre) continue;

    const text = entry.text.toLowerCase();
    const tags = new Set<string>();
    for (const rule of THEME_RULES) {
      if (rule.keywords.some((keyword) => containsKeyword(text, keyword))) {
        tags.add(rule.tag);
      }
    }

    metadata.push({
      verseId: entry.reference,
      testament,
      genre,
      themeTags: Array.from(tags)
    });
  }

  const outputPath = path.join(process.cwd(), 'data', 'verse-metadata.json');
  await fs.writeFile(outputPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${metadata.length} verse metadata entries to ${outputPath}`);
}

buildMetadata().catch((error) => {
  console.error('Failed to build verse metadata', error);
  process.exit(1);
});
