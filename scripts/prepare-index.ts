import fs from 'fs';
import path from 'path';

/**
 * Aggregates all BSB translation files into a single full Bible index.
 * Format: { "BOOK CH:V": { text, translation, reference, original: [] } }
 *
 * Contextual prepending: each verse's BM25 text is prefixed with a header like
 *   "[John · Chapter 3 · Salvation, Love of God]"
 * so thematic queries that don't match raw verse words still rank correctly.
 * The raw verse text is preserved in the `text` field; only `bm25Text` carries
 * the enriched string. The BM25 engine indexes `bm25Text` when present.
 */

const TRANSLATIONS_DIR = path.join(process.cwd(), 'data', 'translations');
const OUTPUT_FILE = path.join(process.cwd(), 'data', 'bible-full-index.json');
const DATA_DIR = path.join(process.cwd(), 'data');

interface VerseContext {
  text: string;
  bm25Text: string;
  translation: string;
  reference: string;
  original: any[];
}

interface Pericope {
  title: string;
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
}

interface TopicEntry {
  id: string;
  label: string;
}

interface VerseTopicEntry {
  verseId: string;
  topics: { id: string; confidence: number }[];
}

const BOOK_NAMES: Record<string, string> = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers',
  DEU: 'Deuteronomy', JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth',
  '1SA': '1 Samuel', '2SA': '2 Samuel', '1KI': '1 Kings', '2KI': '2 Kings',
  '1CH': '1 Chronicles', '2CH': '2 Chronicles', EZR: 'Ezra', NEH: 'Nehemiah',
  EST: 'Esther', JOB: 'Job', PSA: 'Psalms', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SNG: 'Song of Solomon', ISA: 'Isaiah', JER: 'Jeremiah',
  LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea',
  JOL: 'Joel', AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah',
  MIC: 'Micah', NAM: 'Nahum', HAB: 'Habakkuk', ZEP: 'Zephaniah',
  HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi',
  MAT: 'Matthew', MRK: 'Mark', LUK: 'Luke', JHN: 'John',
  ACT: 'Acts', ROM: 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
  GAL: 'Galatians', EPH: 'Ephesians', PHP: 'Philippians', COL: 'Colossians',
  '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy',
  '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews',
  JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John',
  '2JN': '2 John', '3JN': '3 John', JUD: 'Jude', REV: 'Revelation',
};

function loadJson<T>(filename: string): T | null {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
  // Handle both bare arrays and { items: [...] } shapes
  return (Array.isArray(raw) ? raw : raw?.items ?? raw) as T;
}

function buildContextHeader(
  bookCode: string,
  chapterNum: string,
  verseId: string,
  versePericopeMap: Map<string, string>,
  verseTopicMap: Map<string, string[]>,
): string {
  const bookName = BOOK_NAMES[bookCode] ?? bookCode;
  const parts: string[] = [bookName, `Chapter ${chapterNum}`];

  // Prefer pericope title (richer, section-level); fall back to topic labels
  const pericope = versePericopeMap.get(verseId);
  if (pericope) {
    parts.push(pericope);
  } else {
    const topics = verseTopicMap.get(verseId);
    if (topics && topics.length > 0) parts.push(topics.join(', '));
  }

  return `[${parts.join(' · ')}]`;
}

async function prepareIndex() {
  console.log('Starting full Bible index preparation...');

  // Build pericope lookup: verseId -> pericope title
  const pericopeMap = new Map<string, string>();
  const pericopes = loadJson<Pericope[]>('pericopes.json');
  if (pericopes) {
    for (const p of pericopes) {
      for (let v = p.startVerse; v <= p.endVerse; v++) {
        pericopeMap.set(`${p.book} ${p.chapter}:${v}`, p.title);
      }
    }
    console.log(`Loaded ${pericopeMap.size} pericope verse mappings.`);
  }

  // Build topic label lookup: id -> label
  const topicLabels = new Map<string, string>();
  const topics = loadJson<TopicEntry[]>('topics.json');
  if (topics) {
    for (const t of topics) topicLabels.set(t.id, t.label);
  }

  // Build verse-topic lookup: verseId -> top-2 topic labels by confidence
  const verseTopicMap = new Map<string, string[]>();
  const verseTopics = loadJson<VerseTopicEntry[]>('verse-topics.json');
  if (verseTopics) {
    for (const entry of verseTopics) {
      const sorted = [...entry.topics].sort((a, b) => b.confidence - a.confidence).slice(0, 2);
      const labels = sorted.map(t => topicLabels.get(t.id) ?? t.id);
      verseTopicMap.set(entry.verseId, labels);
    }
    console.log(`Loaded topic labels for ${verseTopicMap.size} verses.`);
  }

  const files = fs.readdirSync(TRANSLATIONS_DIR);
  const bsbFiles = files.filter(f => f.startsWith('bsb-') && f.endsWith('.json'));

  const fullIndex: Record<string, VerseContext> = {};
  let totalVerses = 0;
  let enrichedCount = 0;

  for (const file of bsbFiles) {
    const bookCode = file.replace('bsb-', '').replace('.json', '');
    const filePath = path.join(TRANSLATIONS_DIR, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Content structure: { "1": { "1": "Text...", "2": "Text..." }, "2": { ... } }
    for (const chapterNum of Object.keys(content)) {
      const verses = content[chapterNum];
      for (const verseNum of Object.keys(verses)) {
        const text = verses[verseNum] as string;
        const reference = `${bookCode} ${chapterNum}:${verseNum}`;

        const header = buildContextHeader(bookCode, chapterNum, reference, pericopeMap, verseTopicMap);
        const bm25Text = `${header} ${text}`;
        if (header.includes('·') && header.split('·').length >= 3) enrichedCount++;

        fullIndex[reference] = {
          text,
          bm25Text,
          translation: 'BSB',
          reference,
          original: [],
        };
        totalVerses++;
      }
    }
  }

  console.log(`Contextual headers applied to ${enrichedCount} / ${totalVerses} verses.`);
  console.log(`Writing ${totalVerses} verses to ${OUTPUT_FILE}...`);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(fullIndex));
  console.log('Index preparation complete.');
}

prepareIndex().catch(err => {
  console.error('Failed to prepare index:', err);
  process.exit(1);
});
