import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { Pool } from 'pg';
import { fetchVerseHelloAO, fetchVerseFallback, fetchStrongsDefinition, VerseContext } from './bible-fetch';
import { ensureDbReady, getDbPool } from './db';
import bibleIndexData from '../data/bible-index.json';
import strongsDictData from '../data/strongs-dict.json';

const BIBLE_INDEX = bibleIndexData as Record<string, VerseContext>;
const STRONGS_DICT = strongsDictData as Record<string, Record<string, string>>;

const HF_EMBEDDING_MODEL = process.env.HF_EMBEDDING_MODEL || 'intfloat/multilingual-e5-small';
const HF_ENDPOINT = `https://router.huggingface.co/hf-inference/models/${HF_EMBEDDING_MODEL}/pipeline/feature-extraction`;
const VECTOR_LIMIT = 6;
const EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000;
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = { value: T; ts: number };
const embeddingCache = new Map<string, CacheEntry<number[]>>();
const contextCache = new Map<string, CacheEntry<VerseContext[]>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, ts: Date.now() });
}

function cloneVerses(verses: VerseContext[]): VerseContext[] {
  return verses.map((verse) => ({
    ...verse,
    original: verse.original ? verse.original.map((orig) => ({ ...orig })) : []
  }));
}

function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const size = vectors[0].length;
  const sums = new Array<number>(size).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < size; i += 1) {
      sums[i] += vec[i];
    }
  }
  return sums.map((value) => value / vectors.length);
}

function normalizeEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'number') {
    return raw as number[];
  }
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
    return meanPool(raw as number[][]);
  }
  throw new Error('Unexpected embedding response shape');
}

async function embedQuery(query: string): Promise<number[]> {
  const cacheKey = `${HF_EMBEDDING_MODEL}::${query.trim().toLowerCase()}`;
  const cached = getCached(embeddingCache, cacheKey, EMBEDDING_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    throw new Error('HF_TOKEN is not set');
  }

  const response = await fetch(HF_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hfToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: [`query: ${query}`],
      options: { wait_for_model: true }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF embeddings failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as unknown;
  if (Array.isArray(data) && data.length > 0) {
    const embedding = normalizeEmbedding(data[0]);
    if (embedding.length !== 384) {
      throw new Error(`Embedding dimension mismatch; expected 384, got ${embedding.length}`);
    }
    setCached(embeddingCache, cacheKey, embedding);
    return embedding;
  }

  throw new Error('HF embeddings response was not an array');
}

function toVectorString(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function fetchVersesByRefs(
  pool: Pool,
  refs: Array<{ book: string; chapter: number; verse: number }>,
  translation: string
): Promise<VerseContext[]> {
  if (refs.length === 0) return [];

  const values: Array<string | number> = [translation];
  const tuples: string[] = [];
  refs.forEach((ref, index) => {
    const base = index * 3;
    tuples.push(`($${base + 2}::text, $${base + 3}::int, $${base + 4}::int)`);
    values.push(ref.book, ref.chapter, ref.verse);
  });

  const result = await pool.query<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
    translation: string;
  }>(
    `WITH refs(book, chapter, verse) AS (VALUES ${tuples.join(', ')})
     SELECT v.book, v.chapter, v.verse, v.text, v.translation
     FROM verses v
     JOIN refs r ON v.book = r.book AND v.chapter = r.chapter AND v.verse = r.verse
     WHERE v.translation = $1;`,
    values,
  );

  return result.rows.map((row) => ({
    reference: `${row.book} ${row.chapter}:${row.verse}`,
    translation: row.translation,
    text: row.text,
    original: []
  }));
}

async function vectorSearchVerses(
  pool: Pool,
  embedding: number[],
  translation: string,
  limit: number
): Promise<VerseContext[]> {
  const result = await pool.query<{
    book: string;
    chapter: number;
    verse: number;
    text: string;
    translation: string;
  }>(
    `SELECT book, chapter, verse, text, translation
     FROM verses
     WHERE translation = $1 AND embedding IS NOT NULL
     ORDER BY embedding <-> $2::vector
     LIMIT $3;`,
    [translation, toVectorString(embedding), limit],
  );

  return result.rows.map((row) => ({
    reference: `${row.book} ${row.chapter}:${row.verse}`,
    translation: row.translation,
    text: row.text,
    original: []
  }));
}

export async function retrieveContextForQuery(
  query: string,
  translation: string,
  apiKey?: string
): Promise<VerseContext[]> {
  const cacheKey = `${translation}::${query.trim().toLowerCase()}`;
  const cached = getCached(contextCache, cacheKey, CONTEXT_CACHE_TTL_MS);
  if (cached) {
    return cloneVerses(cached);
  }

  let verses: VerseContext[] = [];
  let usedDb = false;
  let dbError: unknown;

  try {
    verses = await retrieveContextFromDb(query, translation);
    usedDb = true;
  } catch (error) {
    dbError = error;
  }

  if (!usedDb) {
    if (dbError) {
      console.warn('DB retrieval failed, falling back to API retrieval', dbError);
    } else if (!usedDb) {
      console.warn('DB retrieval unavailable, falling back to API retrieval');
    }
    return retrieveContextViaApis(query, translation, apiKey);
  }

  const enriched = await enrichOriginalLanguages(verses);
  setCached(contextCache, cacheKey, enriched);
  return cloneVerses(enriched);
}

async function retrieveContextFromDb(
  query: string,
  translation: string
): Promise<VerseContext[]> {
  await ensureDbReady();
  const pool = getDbPool();
  const verses: VerseContext[] = [];
  const normalizedQuery = query.toLowerCase();
  const directRefs = extractDirectReferences(query);

  const tenCommandmentRefs = [
    { reference: 'EXO 20:3', keywords: ['other gods', 'idolatry', 'idol', 'false gods', 'worship other'] },
    { reference: 'EXO 20:4', keywords: ['graven image', 'carved image', 'image worship', 'idols'] },
    { reference: 'EXO 20:7', keywords: ['take the lord\'s name', 'blaspheme', 'blasphemy', 'curse god', 'vain name'] },
    { reference: 'EXO 20:8', keywords: ['sabbath', 'rest day'] },
    { reference: 'EXO 20:12', keywords: ['honor father', 'honour father', 'honor mother', 'honour mother', 'disobey parents'] },
    { reference: 'EXO 20:13', keywords: ['murder', 'kill', 'killing', 'homicide'] },
    { reference: 'EXO 20:14', keywords: ['adultery', 'unfaithful spouse', 'cheat on spouse'] },
    { reference: 'EXO 20:15', keywords: ['theft', 'steal', 'stealing', 'rob', 'robbery'] },
    { reference: 'EXO 20:16', keywords: ['false witness', 'perjury', 'lie in court', 'slander'] },
    { reference: 'EXO 20:17', keywords: ['covet', 'coveting', 'envy your neighbor', 'envy thy neighbor'] }
  ];

  const freedomRefs = ['GAL 3:28', 'GAL 4:7', 'ROM 6:6', '1CO 7:22', 'PHM 1:16'];

  const prioritizedRefs = tenCommandmentRefs
    .filter((item) => item.keywords.some((k) => normalizedQuery.includes(k)))
    .map((item) => item.reference);

  const freedomKeywords = ['slav', 'slave', 'servant', 'bondservant', 'bond servant', 'bond', 'doulos', 'freedom', 'free'];
  if (freedomKeywords.some((k) => normalizedQuery.includes(k))) {
    prioritizedRefs.push(...freedomRefs);
  }

  const prioritizedParsed = prioritizedRefs.map((ref) => {
    const [book, cv] = ref.split(' ');
    const [chapter, verse] = cv.split(':').map((part) => Number.parseInt(part, 10));
    return { book, chapter, verse };
  });

  const directRows = await fetchVersesByRefs(pool, directRefs, translation);
  const priorityRows = await fetchVersesByRefs(pool, prioritizedParsed, translation);

  const addUnique = (row: VerseContext) => {
    if (!verses.some((v) => v.reference === row.reference)) {
      verses.push(row);
    }
  };

  priorityRows.forEach(addUnique);
  directRows.forEach(addUnique);

  if (verses.length >= VECTOR_LIMIT) {
    attachIndexedOriginals(verses);
    return verses;
  }

  if (verses.length > 0 && normalizedQuery.length <= 12) {
    attachIndexedOriginals(verses);
    return verses;
  }

  let embedding: number[] | null = null;
  try {
    embedding = await embedQuery(query);
  } catch (error) {
    console.warn('Query embedding failed; skipping vector search', error);
  }

  if (!embedding && verses.length === 0) {
    throw new Error('Vector retrieval unavailable and no direct references found.');
  }

  if (embedding) {
    const limit = Math.max(VECTOR_LIMIT - verses.length, 0);
    if (limit > 0) {
      const vectorRows = await vectorSearchVerses(pool, embedding, translation, limit);
      vectorRows.forEach(addUnique);
    }
  }

  attachIndexedOriginals(verses);

  return verses;
}

function attachIndexedOriginals(verses: VerseContext[]): void {
  for (const verse of verses) {
    const indexed = BIBLE_INDEX[verse.reference];
    if (indexed?.original && indexed.original.length > 0) {
      verse.original = indexed.original.map((orig) => ({ ...orig }));
    }
  }
}

async function retrieveContextViaApis(
  query: string,
  translation: string,
  apiKey?: string
): Promise<VerseContext[]> {
  const verses: VerseContext[] = [];
  const normalizedQuery = query.toLowerCase();

  const tenCommandments: VerseContext[] = [
    { reference: 'EXO 20:3', text: 'Thou shalt have no other gods before me.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:4', text: 'Thou shalt not make unto thee a graven image, nor any likeness of anything that is in heaven above, or that is in the earth beneath, or that is in the water under the earth.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:7', text: 'Thou shalt not take the name of Jehovah thy God in vain; for Jehovah will not hold him guiltless that taketh his name in vain.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:8', text: 'Remember the sabbath day, to keep it holy.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:12', text: 'Honor thy father and thy mother, that thy days may be long in the land which Jehovah thy God giveth thee.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:13', text: 'Thou shalt not kill.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:14', text: 'Thou shalt not commit adultery.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:15', text: 'Thou shalt not steal.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:16', text: 'Thou shalt not bear false witness against thy neighbor.', translation: 'ASV', original: [] },
    { reference: 'EXO 20:17', text: 'Thou shalt not covet thy neighbor\'s house, thou shalt not covet thy neighbor\'s wife, nor his man-servant, nor his maid-servant, nor his ox, nor his ass, nor anything that is thy neighbor\'s.', translation: 'ASV', original: [] }
  ];

  const freedomFromSlaveryVerses: VerseContext[] = [
    {
      reference: 'GAL 3:28',
      text: 'There can be neither Jew nor Greek, there can be neither bond nor free, there can be no male and female; for ye all are one in Christ Jesus.',
      translation: 'WEB',
      original: []
    },
    {
      reference: 'GAL 4:7',
      text: 'So that thou art no longer a bondservant, but a son; and if a son, then an heir through God.',
      translation: 'WEB',
      original: []
    },
    {
      reference: 'ROM 6:6',
      text: 'knowing this, that our old man was crucified with him, that the body of sin might be done away, that so we should no longer be in bondage to sin;',
      translation: 'WEB',
      original: []
    },
    {
      reference: '1CO 7:22',
      text: 'For he that was called in the Lord being a bondservant, is the Lord\'s freedman: likewise he that was called being free, is Christ\'s bondservant.',
      translation: 'WEB',
      original: []
    },
    {
      reference: 'PHM 1:16',
      text: 'no longer as a bondservant, but more than a bondservant, a beloved brother, especially to me, but how much rather to thee, both in the flesh and in the Lord.',
      translation: 'WEB',
      original: []
    }
  ];

  const prioritized: VerseContext[] = [];
  const addPriority = (index: number, keywords: string[]) => {
    if (keywords.some((k) => normalizedQuery.includes(k))) {
      const verse = tenCommandments[index];
      if (!verses.some((v) => v.reference === verse.reference) && !prioritized.some((v) => v.reference === verse.reference)) {
        prioritized.push(verse);
      }
    }
  };

  addPriority(0, ['other gods', 'idolatry', 'idol', 'false gods', 'worship other']);
  addPriority(1, ['graven image', 'carved image', 'image worship', 'idols']);
  addPriority(2, ['take the lord\'s name', 'blaspheme', 'blasphemy', 'curse god', 'vain name']);
  addPriority(3, ['sabbath', 'rest day']);
  addPriority(4, ['honor father', 'honour father', 'honor mother', 'honour mother', 'disobey parents']);
  addPriority(5, ['murder', 'kill', 'killing', 'homicide']);
  addPriority(6, ['adultery', 'unfaithful spouse', 'cheat on spouse']);
  addPriority(7, ['theft', 'steal', 'stealing', 'rob', 'robbery']);
  addPriority(8, ['false witness', 'perjury', 'lie in court', 'slander']);
  addPriority(9, ['covet', 'coveting', 'envy your neighbor', 'envy thy neighbor']);

  for (const verse of prioritized.reverse()) {
    verses.unshift(verse);
  }

  const freedomKeywords = ['slav', 'slave', 'servant', 'bondservant', 'bond servant', 'bond', 'doulos', 'freedom', 'free'];
  if (freedomKeywords.some((k) => normalizedQuery.includes(k))) {
    for (const verse of freedomFromSlaveryVerses.slice().reverse()) {
      if (!verses.some((v) => v.reference === verse.reference)) {
        verses.unshift(verse);
      }
    }
  }

  // 1. Direct Reference Parsing (e.g., "John 3:16")
  const directRefs = extractDirectReferences(query);
  
  if (directRefs.length > 0) {
    // Attempt rapid direct fetch for parsed references
    for (const ref of directRefs) {
      const refKey = `${ref.book} ${ref.chapter}:${ref.verse}`;
      if (verses.some((v) => v.reference.startsWith(refKey))) {
        continue;
      }
      const dbMatch = BIBLE_INDEX[`${ref.book} ${ref.chapter}:${ref.verse}`];
      if (dbMatch) {
         verses.push(dbMatch);
         continue;
      }
      
      const vText = await fetchVerseHelloAO(translation, ref.book, ref.chapter, ref.verse, ref.endVerse) 
                    || await fetchVerseFallback(`${ref.book} ${ref.chapter}:${ref.verse}-${ref.endVerse || ref.verse}`, translation);
      
      if (vText) {
        verses.push({
          reference: `${ref.book} ${ref.chapter}:${ref.verse}${ref.endVerse ? '-' + ref.endVerse : ''}`,
          translation: translation,
          text: vText,
          original: [] // Filled in enrichment phase
        });
      }
    }
  }

  // 2. Semantic Hint via Groq (only if direct parsing yields few results)
  if (verses.length < 2) {
    const groqApiKey = apiKey || process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      console.warn('Semantic retrieval skipped: GROQ_API_KEY is missing.');
      return enrichOriginalLanguages(verses);
    }
    const groq = createGroq({
      apiKey: groqApiKey,
    });
    const modelCandidates = ['llama-3.1-8b-instant', 'llama-3.1-70b-versatile', 'llama3-8b-8192', 'llama3-70b-8192'];
    let lastModelError: unknown;
    let text = '';
    for (const modelName of modelCandidates) {
      try {
        const result = await generateText({
          model: groq(modelName),
          prompt:
            'Return up to 3 Bible references as lines in the format BOOK CH:VS (e.g., GEN 1:1). ' +
            'Use 3-letter book codes. If none apply, return NONE.\nQuery: ' +
            JSON.stringify(query),
          temperature: 0.1,
        });
        text = result.text;
        break;
      } catch (error) {
        lastModelError = error;
        console.warn(`Semantic retrieval model failed: ${modelName}`, error);
      }
    }

    if (!text) {
      console.warn('Semantic retrieval failed', lastModelError);
      return enrichOriginalLanguages(verses);
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line.toUpperCase() !== 'NONE');

    for (const line of lines) {
      const match = line.match(/^([A-Z0-9]{3})\s+(\d+):(\d+)$/i);
      if (!match) continue;
      const book = match[1].toUpperCase();
      const chapter = Number.parseInt(match[2], 10);
      const verse = Number.parseInt(match[3], 10);
      const refStr = `${book} ${chapter}:${verse}`;
      
      // Skip if we already got it
      if (verses.some(v => v.reference.startsWith(refStr))) continue;

      // Try bundled index first
      if (BIBLE_INDEX[refStr]) {
        verses.push({...BIBLE_INDEX[refStr], translation: 'WEB'}); // Index text is WEB
        continue;
      }

      // Fallback to fetch
      const vText = await fetchVerseHelloAO(translation, book, chapter, verse)
                    || await fetchVerseFallback(refStr, translation);
                    
      if (vText) {
        verses.push({
          reference: refStr,
          translation,
          text: vText,
          original: []
        });
      }
    }
  }

  // 3. Enrichment Phase (add Strong's dictionary data)
  return enrichOriginalLanguages(verses);
}

// Enrich verses with Strongs info from the bundled dict or API
async function enrichOriginalLanguages(verses: VerseContext[]): Promise<VerseContext[]> {
  for (const verse of verses) {
    if (verse.original && verse.original.length > 0) {
      // It came from the static index so it has { word, strongs }. Need to add gloss.
      for (const orig of verse.original) {
        const dictEntry = STRONGS_DICT[orig.strongs];
        if (dictEntry) {
          orig.gloss = dictEntry.short_definition || dictEntry.definition;
          (orig as {transliteration?: string}).transliteration = dictEntry.transliteration;
        } else {
          // rare occurence, try API fetch
          const fetched = await fetchStrongsDefinition(orig.strongs);
          if (fetched) {
            orig.gloss = String(fetched.short_definition || fetched.definition || '');
            (orig as {transliteration?: string}).transliteration = String(fetched.transliteration || '');
          }
        }
      }
    } else {
      // We don't have the bolls tagged index for this verse. 
      // Because we didn't bundle it and it's fetched raw from HelloAO.
      // In this case, we would either hit bolls.life /get-chapter to get the tagged text
      // OR fallback gracefully. For MVP speed, we'll try to extract key english words and fuzzy match our dict.
      // However, that is extremely inaccurate. 
      // Correct approach: hit bolls.life for the tagged verse if missing!
      try {
        const isOT = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'].includes(verse.reference.split(' ')[0]);
        const trans = isOT ? 'WLC' : 'TR';
        const [book, cv] = verse.reference.split(' ');
        const [chapter, vNumStr] = cv.split(':');
        
        const bollsRef = bkbToBollsPath(book, parseInt(chapter, 10));
        const res = await fetch(`https://bolls.life/get-chapter/${trans}/${bollsRef}/`);
        
        if (res.ok) {
           const chapterData = await res.json();
           const matchV = chapterData.find((v: { verse: number, text: string }) => v.verse === parseInt(vNumStr, 10));
           if (matchV) {
             const tags = parseOriginalTags(matchV.text);
             for (const tag of tags) {
               const dictEntry = STRONGS_DICT[tag.strongs] || await fetchStrongsDefinition(tag.strongs);
               if (dictEntry) {
                 tag.gloss = String(dictEntry.short_definition || dictEntry.definition || '');
                 (tag as {transliteration?: string}).transliteration = String(dictEntry.transliteration || '');
               }
             }
             verse.original = tags;
           }
        }
      } catch (err) {
        console.warn('Failed to fetch tagged fallback for', verse.reference, err);
      }
    }
  }
  return verses;
}


function extractDirectReferences(query: string) {
  const results: Array<{book: string, chapter: number, verse: number, endVerse?: number}> = [];
  
  // Very simplistic parser for Genesis 1:1 or Gen 1:1-3
  // Covers top few books. In a real app we'd use a massive RegExp or a library.
  const regex = /\b(Gen|Exo|Lev|Num|Deu|Jos|Jdg|Rut|Sa|Ki|Ch|Ezr|Neh|Est|Job|Ps|Pro|Ecc|Song|Isa|Jer|Lam|Ezk|Dan|Hos|Joel|Amos|Obad|Jonah|Mic|Nahum|Hab|Zeph|Hag|Zech|Mal|Matt|Mark|Luke|John|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Titus|Philemon|Heb|James|Pet|John|Jude|Rev)[a-z]*\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\b/gi;
  
  let match;
  while ((match = regex.exec(query)) !== null) {
      const bookRaw = match[1].substring(0, 3).toUpperCase();
      // Translate to 3-letter codes used by HelloAO
      const bookMap: Record<string, string> = {
        'GEN':'GEN', 'EXO':'EXO', 'LEV':'LEV', 'NUM':'NUM', 'DEU':'DEU',
        'JOS':'JOS', 'JDG':'JDG', 'RUT':'RUT', 'SA':'1SA', 'KI':'1KI', 'CH':'1CH',
        'Psa':'PSA', 'PSA':'PSA', 'PRO':'PRO', 'ISA':'ISA', 'MAT':'MAT', 'MAR':'MRK',
        'LUK':'LUK', 'JOH':'JHN', 'ROM':'ROM', 'COR':'1CO', 'GAL':'GAL', 'EPH':'EPH',
        'PHI':'PHP', 'COL':'COL', 'THE':'1TH', 'TIM':'1TI', 'HEB':'HEB', 'JAM':'JAS',
        'PET':'1PE', 'REV':'REV'
      };
      const bookCode = bookMap[bookRaw] || bookRaw;
      
      results.push({
        book: bookCode,
        chapter: parseInt(match[2], 10),
        verse: parseInt(match[3], 10),
        endVerse: match[4] ? parseInt(match[4], 10) : undefined
      });
  }
  
  return results;
}

// Utility copied over from script
function bkbToBollsPath(bookCode: string, chapter: number): string {
  const map: Record<string, number> = {
    'GEN': 1, 'EXO': 2, 'LEV': 3, 'NUM': 4, 'DEU': 5,
    'JOS': 6, 'JDG': 7, 'RUT': 8, '1SA': 9, '2SA': 10,
    '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14, 'EZR': 15,
    'NEH': 16, 'EST': 17, 'JOB': 18, 'PSA': 19, 'PRO': 20,
    'ECC': 21, 'SNG': 22, 'ISA': 23, 'JER': 24, 'LAM': 25,
    'EZK': 26, 'DAN': 27, 'HOS': 28, 'JOL': 29, 'AMO': 30,
    'OBA': 31, 'JON': 32, 'MIC': 33, 'NAM': 34, 'HAB': 35,
    'ZEP': 36, 'HAG': 37, 'ZEC': 38, 'MAL': 39,
    'MAT': 40, 'MRK': 41, 'LUK': 42, 'JHN': 43, 'ACT': 44,
    'ROM': 45, '1CO': 46, '2CO': 47, 'GAL': 48, 'EPH': 49,
    'PHP': 50, 'COL': 51, '1TH': 52, '2TH': 53, '1TI': 54,
    '2TI': 55, 'TIT': 56, 'PHM': 57, 'HEB': 58, 'JAS': 59,
    '1PE': 60, '2PE': 61, '1JN': 62, '2JN': 63, '3JN': 64,
    'JUD': 65, 'REV': 66
  };
  return `${map[bookCode]}/${chapter}`;
}

function parseOriginalTags(text: string) {
  const words: Array<{word: string, strongs: string, gloss?: string}> = [];
  const cleanLine = text.replace(/<span.*?>/g, '').replace(/<\/\span>/g, '');
  const parts = cleanLine.split('<S>');
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) continue; 
    
    const endStrongsIdx = part.indexOf('</S>');
    if (endStrongsIdx !== -1) {
      const strongs = part.substring(0, endStrongsIdx);
      const wordPart = parts[i-1].replace(/<\/\S>/g, '').trim();
      const lastSpace = wordPart.lastIndexOf(' ');
      const word = lastSpace === -1 ? wordPart : wordPart.substring(lastSpace + 1);
      
      const cleanWord = word.replace(/[,.;:!?]/g, '');
      if (cleanWord && strongs) {
        words.push({ word: cleanWord, strongs });
      }
    }
  }
  return words;
}
