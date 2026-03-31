import { GoogleGenAI } from '@google/genai';
import type { RankedVerse } from './types';

/**
 * Re-ranks the top BM25 candidates using semantic embeddings from Google GenAI.
 * Only practical for small batches (Top 50) due to API latency and token cost.
 */
export async function reRankSemantic(
  query: string,
  candidates: RankedVerse[],
  verseTexts: Map<string, string>
): Promise<RankedVerse[]> {
  if (candidates.length === 0) return [];

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[retrieval] Gemini API key missing, skipping semantic re-ranking.');
    return candidates;
  }

  try {
    // Attempt standard object initialization first to satisfy modern SDK versions
    const genAI = new GoogleGenAI({ apiKey } as any); 
    const model = (genAI as any).getGenerativeModel({ model: 'text-embedding-004' });

    // 1. Generate query embedding
    const queryResult = await model.embedContent({
      content: { role: 'user', parts: [{ text: query }] },
      taskType: 'RETRIEVAL_QUERY'
    });
    const queryEmbedding = queryResult.embedding.values;

    // 2. Generate embeddings for candidates
    const candidateTexts = candidates.map(c => verseTexts.get(c.verseId) || '');
    
    // Batch embedding
    const requests = candidateTexts.map(text => ({ 
      content: { role: 'user', parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT'
    }));

    const docResult: any = await model.batchEmbedContents({
      requests
    });
    
    const docEmbeddings = (docResult.embeddings || []).map((e: any) => e.values);

    // 3. Compute similarity and blend
    const bm25Scores = candidates.map((c) => c.score);
    const bm25Min = Math.min(...bm25Scores);
    const bm25Max = Math.max(...bm25Scores);
    const bm25Range = bm25Max - bm25Min || 1; // Derive bounds from current batch

    const scored = candidates.map((candidate, i) => {
      const docEmbedding = docEmbeddings[i];
      
      // Calculate normalized BM25 score regardless (shared scale window [0,1])
      const normalizedBM25 = Math.max(0, Math.min(1, (candidate.score - bm25Min) / bm25Range));

      if (!docEmbedding) {
        return {
          ...candidate,
          score: normalizedBM25, // Fallback to normalized BM25 only
        };
      }

      const similarity = dotProduct(queryEmbedding, docEmbedding);

      // Normalize Similarity to [0, 1]
      // dotProduct on normalized embeddings yields cosine similarity in [-1, 1]
      const normalizedSimilarity = (similarity + 1) / 2;

      // Blend Lexical and Semantic scores
      // higher alpha weights semantic similarity more heavily
      const alpha = 0.65;
      const blendedScore = alpha * normalizedSimilarity + (1 - alpha) * normalizedBM25;

      return {
        ...candidate,
        score: blendedScore,
        semanticSimilarity: similarity,
      };
    });

    // 4. Sort by blended score
    return scored.sort((a, b) => b.score - a.score);

  } catch (error) {
    console.warn('[retrieval] Semantic re-ranking failed, falling back to BM25:', error);
    return candidates;
  }
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
