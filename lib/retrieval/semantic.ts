import type { RankedVerse } from './types';
import { getCachedEmbedding, setCachedEmbedding } from '../cache';
import { classifyAndExpand } from '../query-utils';

const GROQ_EMBEDDING_MODEL = process.env.GROQ_EMBEDDING_MODEL || 'nomic-embed-text-v1.5';

async function fetchGroqEmbeddings(texts: string[]): Promise<number[][] | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_EMBEDDING_MODEL,
        input: texts
      })
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data.data.map((item: any) => item.embedding);
  } catch (error) {
    console.warn('[retrieval] Groq embedding failed:', error);
    return null;
  }
}

const EMBEDDING_MODEL = GROQ_EMBEDDING_MODEL;

export async function embedQuery(query: string): Promise<number[] | null> {
  const normalized = classifyAndExpand(query).normalizedQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  const cacheKey = {
    normalizedQuery: normalized,
    embeddingModel: EMBEDDING_MODEL,
  };

  const cachedEmbedding = await getCachedEmbedding(cacheKey);
  if (cachedEmbedding && cachedEmbedding.length > 0) {
    return cachedEmbedding;
  }

  const embeddings = await fetchGroqEmbeddings([normalized]);
  if (!embeddings || embeddings.length === 0) {
    return null;
  }
  const embedding = embeddings[0];
  await setCachedEmbedding(cacheKey, embedding);
  return embedding;
}

export async function rankSemanticFromQueryEmbedding(
  queryEmbedding: number[],
  candidates: RankedVerse[],
  verseTexts: Map<string, string>
): Promise<RankedVerse[]> {
  if (!queryEmbedding || candidates.length === 0) return candidates;

  try {
    const presentCandidates: Array<{ candidate: RankedVerse; text: string }> = [];
    const missingTextCandidates: RankedVerse[] = [];
    for (const candidate of candidates) {
      const text = verseTexts.get(candidate.verseId);
      if (typeof text !== 'string' || text.trim().length === 0) {
        missingTextCandidates.push(candidate);
        continue;
      }
      presentCandidates.push({ candidate, text });
    }

    if (presentCandidates.length === 0) {
      return candidates
        .map((candidate) => ({
          ...candidate,
          score: Number.NEGATIVE_INFINITY,
          semanticSimilarity: Number.NEGATIVE_INFINITY,
        }))
        .sort((a, b) => b.score - a.score);
    }

    const textsToEmbed = presentCandidates.map(({ text }) => text);
    const docEmbeddings = await fetchGroqEmbeddings(textsToEmbed);
    if (!docEmbeddings) return candidates;
    const rankedPresent = presentCandidates.map(({ candidate }, i) => {
        const docEmbedding = docEmbeddings[i];
        const similarity = docEmbedding ? dotProduct(queryEmbedding, docEmbedding) : Number.NEGATIVE_INFINITY;
        return {
          ...candidate,
          score: similarity,
          semanticSimilarity: similarity,
        };
      });

    const rankedMissing = missingTextCandidates.map((candidate) => ({
      ...candidate,
      score: Number.NEGATIVE_INFINITY,
      semanticSimilarity: Number.NEGATIVE_INFINITY,
    }));

    return [...rankedPresent, ...rankedMissing]
      .sort((a, b) => b.score - a.score);
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

/**
 * Simple dot product for normalized embeddings (effectively cosine similarity).
 */
function dotProduct(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
