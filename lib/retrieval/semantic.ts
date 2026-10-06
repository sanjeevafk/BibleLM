import fs from 'fs';
import path from 'path';
import type { RankedVerse } from './types';
import { getCachedEmbedding, setCachedEmbedding } from '../cache';
import { classifyAndExpand } from '../query-utils';
import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || 'models/gemini-embedding-2';
const EMBEDDING_DIM = 1024;

let binaryVectorsPromise: Promise<Map<string, Float32Array> | null> | null = null;

/**
 * Lazy loads the precomputed 1024-dimensional binary embeddings if present.
 */
async function getPrecomputedVectors(): Promise<Map<string, Float32Array> | null> {
  if (binaryVectorsPromise) return binaryVectorsPromise;

  binaryVectorsPromise = (async () => {
    try {
      const rootDir = process.cwd();
      const bgeBinPath = path.join(rootDir, 'data', 'embeddings', 'bge-large-en-v1.5-1024.bin');
      const bgeOrderPath = path.join(rootDir, 'data', 'embeddings', 'bge-large-en-v1.5-1024-order.json');
      const geminiBinPath = path.join(rootDir, 'data', 'embeddings', 'gemini-embedding-2-1024.bin');
      const geminiOrderPath = path.join(rootDir, 'data', 'embeddings', 'gemini-embedding-2-1024-order.json');

      const binPath = (typeof fs.existsSync === 'function' && fs.existsSync(bgeBinPath) && fs.existsSync(bgeOrderPath))
        ? bgeBinPath
        : geminiBinPath;
      const orderPath = (typeof fs.existsSync === 'function' && fs.existsSync(bgeBinPath) && fs.existsSync(bgeOrderPath))
        ? bgeOrderPath
        : geminiOrderPath;

      if (typeof fs.existsSync === 'function' && fs.existsSync(binPath) && fs.existsSync(orderPath)) {
        const orderRaw = fs.readFileSync(orderPath, 'utf8');
        const order = JSON.parse(orderRaw) as string[];
        const binBuffer = fs.readFileSync(binPath);
        const floatArray = new Float32Array(
          binBuffer.buffer,
          binBuffer.byteOffset,
          binBuffer.byteLength / 4
        );

        const map = new Map<string, Float32Array>();
        order.forEach((ref, idx) => {
          const start = idx * EMBEDDING_DIM;
          const slice = floatArray.subarray(start, start + EMBEDDING_DIM);
          map.set(ref.toUpperCase(), slice);
        });

        console.log(`[semantic] Loaded ${map.size} precomputed 1024-dim verse embeddings into memory.`);
        return map;
      }
    } catch (err) {
      console.warn('[semantic] Precomputed vector loading skipped/failed:', err);
    }
    return null;
  })();

  return binaryVectorsPromise;
}

/**
 * Fetches batch embeddings from Gemini API with outputDimensionality = 1024.
 */
async function fetchGeminiEmbeddings(texts: string[]): Promise<number[][] | null> {
  if (!GEMINI_API_KEY || texts.length === 0) return null;

  try {
    const requests = texts.map((text) => ({
      model: GEMINI_EMBEDDING_MODEL,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIM,
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('[retrieval] Gemini embedding error:', response.status, errText);
      return null;
    }

    const data = (await response.json()) as { embeddings?: Array<{ values?: number[] }> };
    if (!Array.isArray(data.embeddings)) return null;

    return data.embeddings.map((item) => item.values || []);
  } catch (error) {
    console.warn('[retrieval] Gemini embedding network failed:', error);
    return null;
  }
}

/**
 * Embeds a search query into a 1024-dimensional vector using gemini-embedding-2.
 */
export async function embedQuery(query: string): Promise<number[] | null> {
  const normalized = classifyAndExpand(query).normalizedQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  const cacheKey = {
    normalizedQuery: normalized,
    embeddingModel: `${GEMINI_EMBEDDING_MODEL}:${EMBEDDING_DIM}`,
  };

  const cachedEmbedding = await getCachedEmbedding(cacheKey);
  if (cachedEmbedding && cachedEmbedding.length === EMBEDDING_DIM) {
    return cachedEmbedding;
  }

  const embeddings = await fetchGeminiEmbeddings([normalized]);
  if (!embeddings || embeddings.length === 0 || embeddings[0].length !== EMBEDDING_DIM) {
    return null;
  }

  const embedding = embeddings[0];
  await setCachedEmbedding(cacheKey, embedding);
  return embedding;
}

/**
 * Reranks candidate verses using 1024-dimensional cosine similarity.
 * Prefers instant precomputed vectors if available; falls back to dynamic fetch or LLM.
 */
export async function rankSemanticFromQueryEmbedding(
  queryEmbedding: number[],
  candidates: RankedVerse[],
  verseTexts: Map<string, string>
): Promise<RankedVerse[]> {
  if (!queryEmbedding || candidates.length === 0) return candidates;

  try {
    const precomputed = await getPrecomputedVectors();
    const scoredCandidates: RankedVerse[] = [];
    const missingCandidates: Array<{ candidate: RankedVerse; text: string }> = [];

    for (const candidate of candidates) {
      const normId = candidate.verseId.trim().toUpperCase();
      const precomputedVector = precomputed?.get(normId);

      if (precomputedVector && precomputedVector.length === EMBEDDING_DIM) {
        const similarity = dotProduct(queryEmbedding, precomputedVector);
        scoredCandidates.push({
          ...candidate,
          score: similarity,
          semanticSimilarity: similarity,
        });
      } else {
        const text = verseTexts.get(candidate.verseId) || '';
        missingCandidates.push({ candidate, text });
      }
    }

    // Dynamic embed fallback for any candidates not present in precomputed table
    if (missingCandidates.length > 0) {
      const textsToEmbed = missingCandidates
        .map((m) => m.text)
        .filter((t) => t.trim().length > 0);

      const dynamicVectors = textsToEmbed.length > 0 ? await fetchGeminiEmbeddings(textsToEmbed) : null;

      missingCandidates.forEach((item, idx) => {
        const vec = dynamicVectors?.[idx];
        const similarity = vec && vec.length === EMBEDDING_DIM
          ? dotProduct(queryEmbedding, vec)
          : Number.NEGATIVE_INFINITY;

        scoredCandidates.push({
          ...item.candidate,
          score: similarity,
          semanticSimilarity: similarity,
        });
      });
    }

    return scoredCandidates.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.warn('[retrieval] Semantic ranking failed, skipping semantic re-ranking:', error);
    return candidates;
  }
}

export async function reRankSemantic(
  query: string,
  candidates: RankedVerse[],
  verseTexts: Map<string, string>
): Promise<RankedVerse[]> {
  const queryEmbedding = await embedQuery(query);
  if (!queryEmbedding) return candidates;
  return rankSemanticFromQueryEmbedding(queryEmbedding, candidates, verseTexts);
}

export async function rankWithLLMReranker(
  query: string,
  candidates: RankedVerse[],
  verseTexts: Map<string, string>
): Promise<RankedVerse[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || candidates.length <= 1) return candidates;

  try {
    const present = candidates
      .map((c) => ({ candidate: c, text: verseTexts.get(c.verseId) || '' }))
      .filter((c) => c.text.trim().length > 0)
      .slice(0, 15);

    if (present.length === 0) return candidates;

    const groq = createGroq({ apiKey });
    const prompt = `Rank candidate Bible verses from MOST relevant to LEAST relevant for the user query.
Output ONLY a JSON array of verse IDs in ranked order, e.g. ["EXO 20:3", "EXO 20:2"].

Query: "${query}"

Candidates:
${present.map((p, i) => `${i + 1}. [${p.candidate.verseId}] "${p.text}"`).join('\n')}

Ranked IDs JSON:`;

    const result = await generateText({
      model: groq(process.env.GROQ_PRIMARY_MODEL || 'openai/gpt-oss-20b'),
      prompt,
      temperature: 0.0,
    });

    const match = result.text.match(/\[[\s\S]*?\]/);
    if (!match) return candidates;

    const rankedIds: string[] = JSON.parse(match[0]);
    const rankMap = new Map<string, number>();
    rankedIds.forEach((id, idx) => rankMap.set(id.trim().toUpperCase(), idx + 1));

    return [...candidates].sort((a, b) => {
      const rankA = rankMap.get(a.verseId.toUpperCase()) ?? 999;
      const rankB = rankMap.get(b.verseId.toUpperCase()) ?? 999;
      return rankA - rankB;
    });
  } catch (error) {
    console.warn('[retrieval] LLM reranker failed, falling back to lexical ranking:', error);
    return candidates;
  }
}

/**
 * Dot product for normalized 1024-dimensional embeddings (cosine similarity).
 */
function dotProduct(a: number[] | Float32Array, b: number[] | Float32Array): number {
  if (!a || !b || a.length !== b.length) return 0;
  let sum = 0;
  const len = a.length;
  for (let i = 0; i < len; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}
