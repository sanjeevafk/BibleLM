import fs from 'fs';
import path from 'path';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL_NAME = process.env.GEMINI_EMBEDDING_MODEL || 'models/gemini-embedding-2';
const EMBEDDING_DIM = 1024;
const BATCH_SIZE = 100; // Gemini API max batch size is 100
const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 10000;
const TARGET_WINDOW_MS = 61000; // Gemini Free tier quota window is 60s per 100 requests

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

const OT_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
  'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
]);

export interface VerseIndexItem {
  reference: string;
  text: string;
  translation: string;
  bm25Text?: string;
  original?: unknown[];
}

export interface MetadataAwareVerse {
  reference: string;
  bookCode: string;
  book: string;
  testament: 'Old Testament' | 'New Testament';
  chapter: number;
  verse: number;
  text: string;
  embeddingInput: string;
}

export interface VerseEmbeddingRecord extends MetadataAwareVerse {
  embedding: number[];
}

export function parseVerseReference(reference: string, rawText: string): MetadataAwareVerse {
  const match = reference.trim().match(/^([1-3]?[A-Z]+)\s+(\d+):(\d+)$/);
  if (!match) {
    throw new Error(`Unable to parse verse reference: "${reference}"`);
  }
  const [, bookCode, chStr, vStr] = match;
  const chapter = Number.parseInt(chStr, 10);
  const verse = Number.parseInt(vStr, 10);
  const book = BOOK_CODE_TO_NAME[bookCode] || bookCode;
  const testament = OT_BOOKS.has(bookCode) ? 'Old Testament' : 'New Testament';
  const cleanText = rawText.trim();

  const embeddingInput =
    `Testament: ${testament}\n` +
    `Book: ${book}\n` +
    `Chapter: ${chapter}\n` +
    `Verse: ${verse}\n` +
    `Text: ${cleanText}`;

  return {
    reference,
    bookCode,
    book,
    testament,
    chapter,
    verse,
    text: cleanText,
    embeddingInput,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestBatchEmbeddings(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      const requests = texts.map((text) => ({
        model: MODEL_NAME,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIM,
      }));

      const url = `https://generativelanguage.googleapis.com/v1beta/${MODEL_NAME}:batchEmbedContents?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });

      if (res.status === 429) {
        attempt += 1;
        let waitMs = 61000;
        try {
          const errJson = (await res.json()) as { error?: { details?: Array<Record<string, unknown>> } };
          const retryDetails = errJson?.error?.details?.find(
            (d) => typeof d['@type'] === 'string' && d['@type'].includes('RetryInfo') || d.retryDelay
          );
          if (retryDetails && typeof retryDetails.retryDelay === 'string') {
            const match = retryDetails.retryDelay.match(/^([0-9.]+)s?$/);
            if (match) {
              waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 1500;
            }
          }
        } catch {
          // fallback to 61s window
        }
        console.warn(
          `[rate-limit 429] Backing off for ${(waitMs / 1000).toFixed(1)}s (attempt ${attempt}/${MAX_RETRIES})...`
        );
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text();
        attempt += 1;
        if (res.status >= 500 && attempt <= MAX_RETRIES) {
          const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
          console.warn(`[server error ${res.status}] Retrying in ${(delay / 1000).toFixed(1)}s...`);
          await sleep(delay);
          continue;
        }
        throw new Error(`Gemini API error ${res.status}: ${errBody}`);
      }

      const json = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
      if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
        throw new Error(
          `Unexpected embeddings count: expected ${texts.length}, got ${json.embeddings?.length}`
        );
      }

      return json.embeddings.map((e, idx) => {
        if (!e.values || e.values.length !== EMBEDDING_DIM) {
          throw new Error(
            `Embedding dimension mismatch at index ${idx}: expected ${EMBEDDING_DIM}, got ${e.values?.length}`
          );
        }
        return e.values;
      });
    } catch (err: unknown) {
      if (attempt >= MAX_RETRIES) {
        throw err;
      }
      attempt += 1;
      const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`[network error] ${(err as Error)?.message}. Retrying in ${(delay / 1000).toFixed(1)}s...`);
      await sleep(delay);
    }
  }

  throw new Error(`Failed to embed batch after ${MAX_RETRIES} retries`);
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return 'unknown';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export async function generateAllEmbeddings(): Promise<void> {
  const rootDir = process.cwd();
  const inputPath = path.join(rootDir, 'data', 'bible-full-index.json');
  const outDir = path.join(rootDir, 'data', 'embeddings');
  const outJsonl = path.join(outDir, 'gemini-embedding-2-1024.jsonl');
  const outMeta = path.join(outDir, 'gemini-embedding-2-1024-meta.json');
  const outBin = path.join(outDir, 'gemini-embedding-2-1024.bin');
  const outOrder = path.join(outDir, 'gemini-embedding-2-1024-order.json');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log(`[1/4] Loading canonical Bible corpus from ${inputPath}...`);
  const rawIndex = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as Record<string, VerseIndexItem>;
  const allVerses: MetadataAwareVerse[] = Object.entries(rawIndex).map(([ref, item]) =>
    parseVerseReference(ref, item.text)
  );

  console.log(`Loaded ${allVerses.length} canonical verses.`);

  // Load existing embeddings for resumability
  const existingRefs = new Set<string>();
  if (fs.existsSync(outJsonl)) {
    console.log(`[2/4] Reading existing progress from ${outJsonl}...`);
    const lines = fs.readFileSync(outJsonl, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as { reference?: string; embedding?: number[] };
        if (parsed.reference && parsed.embedding && parsed.embedding.length === EMBEDDING_DIM) {
          existingRefs.add(parsed.reference);
        }
      } catch {
        // Skip malformed trailing line if any
      }
    }
    console.log(`Resumable check: ${existingRefs.size} / ${allVerses.length} verses already embedded.`);
  } else {
    console.log(`[2/4] No existing embeddings found. Starting fresh generation...`);
  }

  const pending = allVerses.filter((v) => !existingRefs.has(v.reference));
  console.log(`Remaining verses to embed: ${pending.length}`);

  if (pending.length > 0) {
    console.log(`[3/4] Embedding with ${MODEL_NAME} (${EMBEDDING_DIM} dims, batch size ${BATCH_SIZE})...`);
    const startTime = Date.now();
    let completedInRun = 0;

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      const batchTexts = batch.map((v) => v.embeddingInput);

      const batchStart = Date.now();
      const vectors = await requestBatchEmbeddings(batchTexts, GEMINI_API_KEY);
      const batchDuration = Date.now() - batchStart;

      // Append results atomically to JSONL
      const records: VerseEmbeddingRecord[] = batch.map((verse, idx) => ({
        ...verse,
        embedding: vectors[idx],
      }));

      const chunk = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
      fs.appendFileSync(outJsonl, chunk, 'utf8');

      completedInRun += batch.length;
      const totalCompleted = existingRefs.size + completedInRun;
      const pct = ((totalCompleted / allVerses.length) * 100).toFixed(2);
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speed = completedInRun / elapsedSec;
      const remainingVersesCount = pending.length - completedInRun;
      const etaSec = remainingVersesCount / (speed || 1);

      console.log(
        `[${pct}%] ${totalCompleted}/${allVerses.length} | Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(pending.length / BATCH_SIZE)} took ${batchDuration}ms | ${speed.toFixed(1)} v/s | ETA ${formatDuration(etaSec)}`
      );

      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      if (batchNum % 5 === 0 || i + BATCH_SIZE >= pending.length) {
        syncBinaryIndex(outJsonl, outBin, outOrder, outMeta, allVerses.length);
      }

      if (i + BATCH_SIZE < pending.length) {
        const timeToWait = Math.max(1000, TARGET_WINDOW_MS - batchDuration);
        console.log(`[pacing] Waiting ${(timeToWait / 1000).toFixed(1)}s to pace quota under 100 RPM...`);
        await sleep(timeToWait);
      }
    }
  }

  console.log(`[4/4] Validating resulting dataset and generating final binary indices...`);
  syncBinaryIndex(outJsonl, outBin, outOrder, outMeta, allVerses.length);

  const metaRaw = fs.readFileSync(outMeta, 'utf8');
  const meta = JSON.parse(metaRaw) as { totalVerses: number; complete: boolean };
  if (!meta.complete || meta.totalVerses !== allVerses.length) {
    throw new Error(`Dataset incomplete! Expected ${allVerses.length} verses, validated ${meta.totalVerses}`);
  }

  console.log(`\n======================================================`);
  console.log(`SUCCESS: All ${meta.totalVerses} Bible verses embedded!`);
  console.log(`- Model:      ${MODEL_NAME}`);
  console.log(`- Dimensions: ${EMBEDDING_DIM}`);
  console.log(`- JSONL File: ${outJsonl} (${(fs.statSync(outJsonl).size / (1024 * 1024)).toFixed(1)} MB)`);
  console.log(`- Binary Map: ${outBin} (${(fs.statSync(outBin).size / (1024 * 1024)).toFixed(1)} MB)`);
  console.log(`- Metadata:   ${outMeta}`);
  console.log(`======================================================\n`);
}

function syncBinaryIndex(
  outJsonl: string,
  outBin: string,
  outOrder: string,
  outMeta: string,
  totalExpected: number
): void {
  try {
    if (!fs.existsSync(outJsonl)) return;
    const lines = fs.readFileSync(outJsonl, 'utf8').split('\n').filter(Boolean);
    const validatedMap = new Map<string, number[]>();
    const verseOrder: string[] = [];

    for (let idx = 0; idx < lines.length; idx += 1) {
      const record = JSON.parse(lines[idx]) as VerseEmbeddingRecord;
      if (!record.reference || !record.embedding) {
        throw new Error(`Invalid record at line ${idx + 1}: missing reference or embedding`);
      }
      if (record.embedding.length !== EMBEDDING_DIM) {
        throw new Error(
          `Dimension mismatch at line ${idx + 1} (${record.reference}): expected ${EMBEDDING_DIM}, got ${record.embedding.length}`
        );
      }
      if (!validatedMap.has(record.reference)) {
        validatedMap.set(record.reference, record.embedding);
        verseOrder.push(record.reference);
      }
    }

    if (validatedMap.size === 0) return;

    const binBuffer = new Float32Array(validatedMap.size * EMBEDDING_DIM);
    verseOrder.forEach((ref, verseIdx) => {
      const vec = validatedMap.get(ref)!;
      binBuffer.set(vec, verseIdx * EMBEDDING_DIM);
    });

    fs.writeFileSync(outBin, Buffer.from(binBuffer.buffer));
    fs.writeFileSync(outOrder, JSON.stringify(verseOrder), 'utf8');

    const metaData = {
      model: MODEL_NAME,
      dimension: EMBEDDING_DIM,
      totalVerses: validatedMap.size,
      totalExpected,
      binaryBytes: binBuffer.byteLength,
      updatedAt: new Date().toISOString(),
      complete: validatedMap.size === totalExpected,
    };
    fs.writeFileSync(outMeta, JSON.stringify(metaData, null, 2), 'utf8');
    console.log(`[sync] Binary index updated: ${validatedMap.size}/${totalExpected} verses synced.`);
  } catch (err) {
    console.warn('[sync] Failed to sync binary index:', err);
  }
}

if (require.main === module) {
  generateAllEmbeddings().catch((err) => {
    console.error('Fatal error during embedding generation:', err);
    process.exit(1);
  });
}
