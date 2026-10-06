/**
 * Conditional neural re-ranking for retrieval.
 *
 * Uses Cloudflare Workers AI (`@cf/baai/bge-reranker-base`) to reorder the
 * top fused candidates when lexical/RRF signals are ambiguous. Cheap,
 * high-confidence, and citation-style queries skip the model call entirely
 * via shouldRerank. Every failure mode (missing binding, empty texts,
 * malformed response, thrown error) falls back to the input RRF ordering.
 */

import type { RankedVerse } from './types';

/** Workers AI text-ranking model used for neural re-ranking. */
export const RERANK_MODEL = '@cf/baai/bge-reranker-base';

/**
 * Maximum candidates sent to the model per call. Bounds edge latency and
 * keeps the call well under the ~80ms added-latency budget.
 */
export const RERANK_MAX_CANDIDATES = 12;

/** Minimal structural shape of the Cloudflare `env.AI` binding. */
export type WorkersAiBinding = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

// Gating thresholds: skips keep deterministic behavior cheap and stable,
// triggers fire only when the fused ranking looks genuinely uncertain.
const SKIP_MAX_WORDS = 4;
const STRONG_TOP1_SCORE = 0.8;
const STRONG_TOP1_MARGIN = 0.08;
const WEAK_VECTOR_SIMILARITY = 0.75;
const AMBIGUOUS_TOP5_MARGIN = 0.04;

// Mirrors the citation detector in verse-fetch.ts: numbered prefix plus the
// 3-letter stems of all 66 books (full names match via the trailing [a-z]*).
const CITATION_REGEX =
  /\b(?:([1-3])\s*)?(Gen|Exo|Lev|Num|Deu|Jos|Jdg|Rut|Sa|Ki|Ch|Ezr|Neh|Est|Job|Ps|Pro|Ecc|Song|Isa|Jer|Lam|Eze|Ezk|Dan|Hos|Joe|Amo|Oba|Jon|Mic|Nah|Hab|Zep|Hag|Zec|Mal|Mat|Mrk|Luk|Joh|Jhn|Jn|Act|Rom|Cor|Gal|Eph|Phil|Phm|Col|The|Tim|Tit|Heb|Jas|Pet|Jude|Rev)[a-z]*\s+\d+(?::\d+)?\b/i;

function wordCount(query: string): number {
  return query.trim().split(/\s+/).filter(Boolean).length;
}

function sortedByScore(candidates: RankedVerse[]): RankedVerse[] {
  return [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Decides whether neural re-ranking is worthwhile for this query.
 *
 * Skips (false): exact scripture references, short/keyword queries, and
 * rankings where top-1 already dominates. Triggers (true): thematic or
 * conceptual intent, weak top-1 vector similarity, or an ambiguous top-5
 * spread. Defaults to false — re-ranking is an uncertainty backstop, not
 * the default path.
 */
export function shouldRerank(
  query: string,
  candidates: RankedVerse[],
  intent?: string
): boolean {
  if (!query || candidates.length < 2) return false;

  // Exact scripture references resolve deterministically; never rerank.
  if (CITATION_REGEX.test(query)) return false;

  // Single keywords and short phrases have no ambiguity worth model cost.
  if (wordCount(query) <= SKIP_MAX_WORDS) return false;

  const ranked = sortedByScore(candidates);
  const top1 = ranked[0].score ?? 0;
  const top2 = ranked[1].score ?? 0;

  // Strong, well-separated top-1: trust the fused ranking.
  if (top1 >= STRONG_TOP1_SCORE && top1 - top2 >= STRONG_TOP1_MARGIN) return false;

  // Thematic / conceptual queries benefit most from semantic re-ordering.
  if (intent === 'TOPICAL_QUERY') return true;

  // Weak vector agreement on the leader suggests lexical false friends.
  const topSimilarity = ranked[0].semanticSimilarity;
  if (typeof topSimilarity === 'number' && topSimilarity < WEAK_VECTOR_SIMILARITY) return true;

  // Flat top-5 spread means the fused order is essentially a coin flip.
  const fifth = ranked[Math.min(4, ranked.length - 1)].score ?? top1;
  if (top1 - fifth < AMBIGUOUS_TOP5_MARGIN) return true;

  return false;
}

function normalizeVerseId(verseId: string): string {
  return verseId.trim().toUpperCase();
}

function softmax(logits: number[]): number[] {
  if (logits.length === 0) return [];
  const max = Math.max(...logits);
  const exps = logits.map((logit) => Math.exp(logit - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return logits.map(() => 1 / logits.length);
  return exps.map((value) => value / total);
}

type RerankScoreEntry = { index: number; score: number };

/** Extracts per-candidate (index, score) pairs; null when unusable. */
function parseRerankResponse(raw: unknown, expectedCount: number): number[] | null {
  const payload = raw as { response?: unknown } | null;
  const entries = (Array.isArray(raw) ? raw : payload?.response) as unknown;
  if (!Array.isArray(entries) || entries.length !== expectedCount) return null;

  const scores: number[] = new Array(expectedCount).fill(Number.NaN);
  for (const entry of entries) {
    const typed = entry as Partial<RerankScoreEntry>;
    const index = typeof typed?.index === 'number' ? typed.index : Number.NaN;
    const score = typeof typed?.score === 'number' ? typed.score : Number.NaN;
    if (!Number.isInteger(index) || index < 0 || index >= expectedCount || !Number.isFinite(score)) {
      return null;
    }
    if (Number.isFinite(scores[index])) return null; // duplicate index
    scores[index] = score;
  }
  return scores;
}

/**
 * Re-orders candidates with the Workers AI reranker model.
 *
 * Only the top RERANK_MAX_CANDIDATES are eligible, and of those only
 * candidates WITH verse text are sent — the model rejects empty strings
 * (4006/5006), so textless candidates keep their relative order behind
 * the reranked head instead of failing the whole call. Returns whether
 * the model actually re-scored (`applied`), so callers can log honestly:
 * anything else (no binding, no sendable texts, malformed response,
 * thrown error) keeps the input RRF ordering with `applied: false`.
 */
export async function rerankCandidates(
  query: string,
  candidates: RankedVerse[],
  verseTexts: Map<string, string>,
  aiBinding?: WorkersAiBinding | null
): Promise<{ ranked: RankedVerse[]; applied: boolean }> {
  if (candidates.length === 0) return { ranked: [], applied: false };
  if (!aiBinding || typeof aiBinding.run !== 'function') {
    return { ranked: [...candidates], applied: false };
  }

  const head = candidates.slice(0, RERANK_MAX_CANDIDATES);
  const tail = candidates.slice(RERANK_MAX_CANDIDATES);
  const sendable = head
    .map((candidate, position) => ({
      candidate,
      position,
      text: verseTexts.get(normalizeVerseId(candidate.verseId)) || '',
    }))
    .filter((entry) => entry.text.trim().length > 0);
  const unsent = head.filter((_, position) =>
    !sendable.some((entry) => entry.position === position)
  );
  if (sendable.length === 0) return { ranked: [...candidates], applied: false };

  try {
    // Documented input shape: contexts as [{ text }]; indices in the
    // response refer to positions in this array.
    const raw = await aiBinding.run(RERANK_MODEL, {
      query,
      contexts: sendable.map((entry) => ({ text: entry.text })),
    });
    const logits = parseRerankResponse(raw, sendable.length);
    if (!logits) return { ranked: [...candidates], applied: false };

    const probabilities = softmax(logits);
    const reranked = sendable
      .map((entry, order) => ({
        candidate: {
          ...entry.candidate,
          score: probabilities[order],
          relevanceScore: probabilities[order],
        },
        order,
      }))
      .sort((a, b) => b.candidate.score - a.candidate.score || a.order - b.order)
      .map(({ candidate }) => candidate);
    return { ranked: [...reranked, ...unsent, ...tail], applied: true };
  } catch (error) {
    console.warn('[reranker] Workers AI rerank failed; keeping fused order', error);
    return { ranked: [...candidates], applied: false };
  }
}
