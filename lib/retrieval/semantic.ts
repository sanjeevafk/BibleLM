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
    const queryResult = await model.embedContent(query);
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
    const scored = candidates.map((candidate, i) => {
      const docEmbedding = docEmbeddings[i];
      if (!docEmbedding) return candidate;

      const similarity = dotProduct(queryEmbedding, docEmbedding);
      
      // Blend Lexical and Semantic scores
      const alpha = 0.65;
      const blendedScore = (alpha * similarity) + ((1 - alpha) * candidate.score);

      return {
        ...candidate,
        score: blendedScore,
        semanticSimilarity: similarity
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
