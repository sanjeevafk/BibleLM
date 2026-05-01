import { GoogleGenAI } from '@google/genai';
import type { RankedVerse } from './types';

/**
 * Re-ranks the top BM25 candidates using semantic embeddings from Google GenAI.
 * Only practical for small batches (Top 50) due to API latency and token cost.
 */
function getEmbeddingModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  const genAI = new GoogleGenAI({ apiKey } as any);
  return (genAI as any).getGenerativeModel({ model: 'text-embedding-004' });
}

export async function embedQuery(query: string): Promise<number[] | null> {
  const model = getEmbeddingModel();
  if (!model) {
    console.warn('[retrieval] Gemini API key missing, skipping semantic re-ranking.');
    return null;
  }
  try {
    const queryResult = await model.embedContent({
      content: { role: 'user', parts: [{ text: query }] },
      taskType: 'RETRIEVAL_QUERY',
    });
    return queryResult.embedding.values;
  } catch (error) {
    console.warn('[retrieval] Query embedding failed, skipping semantic re-ranking:', error);
    return null;
  }
}

export async function rankSemanticFromQueryEmbedding(
  queryEmbedding: number[],
  candidates: RankedVerse[],
  verseTexts: Map<string, string>
): Promise<RankedVerse[]> {
  if (!queryEmbedding || candidates.length === 0) return candidates;
  const model = getEmbeddingModel();
  if (!model) return candidates;

  try {
    const candidateTexts = candidates.map(c => verseTexts.get(c.verseId) || '');
    const requests = candidateTexts.map(text => ({
      content: { role: 'user', parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    }));
    const docResult: any = await model.batchEmbedContents({
      requests,
    });
    const docEmbeddings = (docResult.embeddings || []).map((e: any) => e.values);
    return candidates
      .map((candidate, i) => {
        const docEmbedding = docEmbeddings[i];
        const similarity = docEmbedding ? dotProduct(queryEmbedding, docEmbedding) : Number.NEGATIVE_INFINITY;
        return {
          ...candidate,
          score: similarity,
          semanticSimilarity: similarity,
        };
      })
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
