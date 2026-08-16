import fs from 'fs';
import path from 'path';

export interface PericopeItem {
  id: string;
  title: string;
  book: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
  reference: string;
  aliases: string[];
  category: 'parable' | 'discourse' | 'narrative' | 'prophecy' | 'hymn' | 'law' | 'epistle';
}

let cachedPericopes: PericopeItem[] | null = null;

function loadPericopes(): PericopeItem[] {
  if (cachedPericopes) return cachedPericopes;
  try {
    const filePath = path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'pericopes.json');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      cachedPericopes = JSON.parse(raw);
      return cachedPericopes!;
    }
  } catch (err) {
    console.warn('[pericopes] Failed to load data/pericopes.json:', err);
  }
  return [];
}

/**
 * Normalizes query string for matching against pericope titles and aliases.
 */
function normalizeQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Searches in-memory pericope catalog for matching biblical narratives, parables, and discourses.
 */
export function matchPericopes(query: string): PericopeItem[] {
  const pericopes = loadPericopes();
  if (pericopes.length === 0) return [];

  const normQuery = normalizeQuery(query);
  if (!normQuery) return [];

  const matches: Array<{ item: PericopeItem; score: number }> = [];

  for (const item of pericopes) {
    let highestScore = 0;

    // Check aliases and title
    const candidates = [item.title, ...item.aliases];
    for (const cand of candidates) {
      const normCand = normalizeQuery(cand);
      if (!normCand) continue;

      if (normQuery.includes(normCand)) {
        // Query contains entire pericope phrase (e.g. "parable of the good samaritan")
        highestScore = Math.max(highestScore, normCand.length * 2);
      } else if (normCand.includes(normQuery) && normQuery.length > 5) {
        // Query is substring of candidate
        highestScore = Math.max(highestScore, normQuery.length);
      } else {
        // Word overlap
        const candWords = normCand.split(' ').filter(w => w.length > 2);
        const queryWords = new Set(normQuery.split(' '));
        const matched = candWords.filter(w => queryWords.has(w));
        if (matched.length >= 2 && matched.length === candWords.length) {
          highestScore = Math.max(highestScore, matched.length * 3);
        }
      }
    }

    if (highestScore > 0) {
      matches.push({ item, score: highestScore });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .map(m => m.item);
}

/**
 * Expands a pericope range into individual verse IDs (e.g. "LUK 10:25", "LUK 10:26", ...).
 */
export function expandPericopeVerseIds(pericope: PericopeItem, maxVerses = 15): string[] {
  const verseIds: string[] = [];
  const start = pericope.startVerse;
  const end = Math.min(pericope.endVerse, start + maxVerses - 1);

  for (let v = start; v <= end; v++) {
    verseIds.push(`${pericope.book} ${pericope.chapter}:${v}`);
  }
  return verseIds;
}
