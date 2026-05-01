import fs from 'fs';
import path from 'path';
import { buildDatasetMetadata } from './dataset-utils';

type VerseRecord = {
  verseId: string;
  text: string;
};

type PassageWindow = {
  passageId: string;
  anchorVerse: string;
  verseIds: string[];
  text: string;
  windowTopics: string[];
};

type ParsedVerse = {
  book: string;
  chapter: number;
  verse: number;
};

const ROOT = process.cwd();
const BIBLE_INDEX_PATH = path.join(ROOT, 'data', 'bible-full-index.json');
const VERSE_TOPICS_PATH = path.join(ROOT, 'data', 'verse-topics.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'passage-windows.json');

function parseVerseId(verseId: string): ParsedVerse | null {
  const match = verseId.trim().toUpperCase().match(/^([A-Z0-9]{3})\s+(\d+):(\d+)$/);
  if (!match) return null;
  return {
    book: match[1],
    chapter: Number.parseInt(match[2], 10),
    verse: Number.parseInt(match[3], 10),
  };
}

function verseSort(a: ParsedVerse, b: ParsedVerse): number {
  if (a.book !== b.book) return a.book.localeCompare(b.book);
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  return a.verse - b.verse;
}

function buildPassageId(verseIds: string[]): string {
  const start = parseVerseId(verseIds[0]);
  const end = parseVerseId(verseIds[verseIds.length - 1]);
  if (!start || !end) return verseIds[0];
  return `${start.book}.${start.chapter}.${start.verse}-${end.chapter}.${end.verse}`;
}

function overlapRatio(a: string[], b: string[]): number {
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  for (const id of aSet) {
    if (bSet.has(id)) intersection += 1;
  }
  return intersection / Math.max(aSet.size, bSet.size, 1);
}

function mergeWindows(windows: PassageWindow[]): PassageWindow[] {
  const merged: PassageWindow[] = [];

  for (const window of windows) {
    let mergedIntoExisting = false;
    for (let i = 0; i < merged.length; i += 1) {
      const existing = merged[i];
      const ratio = overlapRatio(existing.verseIds, window.verseIds);
      if (ratio <= 0.6) continue;

      const existingHasAnchor = existing.verseIds.includes(window.anchorVerse);
      const newHasAnchor = window.verseIds.includes(existing.anchorVerse);
      if (!existingHasAnchor && !newHasAnchor) continue;

      const keepNew = window.verseIds.length > existing.verseIds.length;
      const winner = keepNew ? window : existing;
      merged[i] = {
        ...winner,
        windowTopics: Array.from(new Set([...existing.windowTopics, ...window.windowTopics])).sort((a, b) =>
          a.localeCompare(b)
        ),
      };
      mergedIntoExisting = true;
      break;
    }

    if (!mergedIntoExisting) merged.push(window);
  }

  return merged.sort((a, b) => a.anchorVerse.localeCompare(b.anchorVerse));
}

function main(): void {
  const bibleIndex = JSON.parse(fs.readFileSync(BIBLE_INDEX_PATH, 'utf8')) as Record<string, { text: string }>;
  const verseTopicsData = JSON.parse(fs.readFileSync(VERSE_TOPICS_PATH, 'utf8')) as {
    items: Array<{ verseId: string; topics: Array<{ id: string }> }>;
  };
  const topicByVerse = new Map(
    verseTopicsData.items.map((item) => [item.verseId.toUpperCase(), item.topics.map((topic) => topic.id)])
  );

  const versesByChapter = new Map<string, VerseRecord[]>();
  for (const [verseId, payload] of Object.entries(bibleIndex)) {
    const parsed = parseVerseId(verseId);
    if (!parsed) continue;
    const chapterKey = `${parsed.book}:${parsed.chapter}`;
    if (!versesByChapter.has(chapterKey)) versesByChapter.set(chapterKey, []);
    versesByChapter.get(chapterKey)!.push({ verseId: verseId.toUpperCase(), text: payload.text || '' });
  }

  for (const [chapterKey, rows] of versesByChapter.entries()) {
    versesByChapter.set(
      chapterKey,
      rows.sort((left, right) => {
        const l = parseVerseId(left.verseId)!;
        const r = parseVerseId(right.verseId)!;
        return verseSort(l, r);
      })
    );
  }

  const windows: PassageWindow[] = [];
  for (const rows of versesByChapter.values()) {
    for (let i = 0; i < rows.length; i += 1) {
      const start = Math.max(0, i - 2);
      const end = Math.min(rows.length - 1, i + 2);
      const segment = rows.slice(start, end + 1);
      const verseIds = segment.map((entry) => entry.verseId);
      const anchorVerse = rows[i].verseId;
      windows.push({
        passageId: buildPassageId(verseIds),
        anchorVerse,
        verseIds,
        text: segment.map((entry) => entry.text).join(' ').replace(/\s+/g, ' ').trim(),
        windowTopics: Array.from(new Set(topicByVerse.get(anchorVerse) ?? [])).slice(0, 3),
      });
    }
  }

  const merged = mergeWindows(windows);
  const payload = {
    ...buildDatasetMetadata('scripts/build-passage-windows.ts'),
    items: merged,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ output: OUTPUT_PATH, count: merged.length }, null, 2));
}

main();
