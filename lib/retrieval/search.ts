/**
 * Lexical search, hybrid search, TSK cross-reference expansion, and
 * all retrieval debug/diagnostics infrastructure.
 */

import { BM25Engine } from './bm25';
import { getCrossReferences } from '../datasets/tsk';
import { ENABLE_RETRIEVAL_DEBUG, ENABLE_TSK_EXPANSION_GATING } from '../feature-flags';
import type { VerseContext } from '../bible-fetch';
import {
  RETRIEVAL_CONFIG,
  type VerseResult,
  type LexicalDoc,
  type RankedVerse,
  type RetrievalDebugState,
  type RetrievalCandidateDiagnostics,
  type RetrievalStageTrace,
  type RetrievalConfidenceDiagnostics,
  type TskExpansionDecision,
  TSK_CONFIG,
} from './types';
import { expandTheologicalQuery } from './synonyms';
import { reRankSemantic } from './semantic';
import { tokenizeFallbackQuery } from './verse-utils';

let bm25Engine: BM25Engine | null = null;
let bm25EnginePromise: Promise<BM25Engine> | null = null;

export async function getBM25Engine(): Promise<BM25Engine> {
  if (bm25Engine) return bm25Engine;
  if (!bm25EnginePromise) {
    bm25EnginePromise = (async () => {
      const bibleIndexData = (await import('../../data/bible-full-index.json')).default;
      const BIBLE_INDEX = bibleIndexData as Record<string, VerseContext>;
      
      let engine: BM25Engine;
      try {
        // Try to load pre-computed state to avoid full indexing on cold start
        const state = (await import('../../data/bm25-state.json')).default;
        engine = BM25Engine.createFromState(state, BIBLE_INDEX, {
          k1: RETRIEVAL_CONFIG.bm25.k1,
          b: RETRIEVAL_CONFIG.bm25.b,
          phraseBoost: RETRIEVAL_CONFIG.bm25.phraseBoost,
        });
        console.log('[retrieval] BM25 engine hydrated from pre-computed state.');
      } catch (e) {
        console.warn('[retrieval] No BM25 state found, indexing in-memory...');
        engine = await BM25Engine.createFromIndex(BIBLE_INDEX, {
          k1: RETRIEVAL_CONFIG.bm25.k1,
          b: RETRIEVAL_CONFIG.bm25.b,
          phraseBoost: RETRIEVAL_CONFIG.bm25.phraseBoost,
        });
      }
      
      bm25Engine = engine;
      return engine;
    })();
  }
  return bm25EnginePromise;
}




// ---------------------------------------------------------------------------
// Retrieval debug state
// ---------------------------------------------------------------------------

export function createRetrievalDebugState(): RetrievalDebugState {
  return {
    candidateTraces: new Map(),
    decisionTraceByReference: new Map(),
    stageTraces: [],
    hybridTopKRefs: [],
    topicGuardStageLogged: false,
    curationStageLogged: false,
  };
}

export function addRetrievalStageTrace(
  debugState: RetrievalDebugState | undefined,
  trace: RetrievalStageTrace
): void {
  if (!debugState) return;
  debugState.stageTraces.push(trace);
}

export function addDecisionTrace(
  debugState: RetrievalDebugState | undefined,
  reference: string,
  trace: string
): void {
  if (!debugState) return;
  const traces = debugState.decisionTraceByReference.get(reference) || [];
  traces.push(trace);
  debugState.decisionTraceByReference.set(reference, traces);
}

export function getCandidateDecisionTrace(debugState: RetrievalDebugState, reference: string): string[] {
  const traces = [...(debugState.decisionTraceByReference.get(reference) || [])];
  if (!traces.some((t) => t.startsWith('topic_guard:'))) {
    traces.push(debugState.topicGuardStageLogged ? 'topic_guard:unchanged' : 'topic_guard:not_invoked');
  }
  if (!traces.some((t) => t.startsWith('curation:'))) {
    traces.push(debugState.curationStageLogged ? 'curation:unchanged' : 'curation:not_invoked');
  }
  return traces;
}

export function getFinalSelectionTrace(debugState: RetrievalDebugState, reference: string): string[] {
  const traces = getCandidateDecisionTrace(debugState, reference);
  const candidate = debugState.candidateTraces.get(reference);
  if (candidate?.final_rank) {
    traces.unshift(`hybrid_final_rank:${candidate.final_rank}`);
  } else if (debugState.hybridTopKRefs.length > 0) {
    traces.unshift('selected_outside_hybrid_ranked_candidates');
  } else {
    traces.unshift('selected_without_hybrid_candidates');
  }
  return traces;
}

// ---------------------------------------------------------------------------
// Confidence diagnostics
// ---------------------------------------------------------------------------

function roundRetrievalDiagnostic(value: number): number {
  return Number(value.toFixed(6));
}

function computeRetrievalEntropy(scored: RankedVerse[]): number {
  if (scored.length <= 1) return 0;
  const totalScore = scored.reduce((sum, hit) => sum + hit.score, 0);
  if (totalScore <= 0) return 0;

  let entropy = 0;
  for (const hit of scored) {
    const probability = hit.score / totalScore;
    if (probability <= 0) continue;
    entropy -= probability * Math.log2(probability);
  }
  const maxEntropy = Math.log2(scored.length);
  return maxEntropy <= 0 ? 0 : entropy / maxEntropy;
}

function buildRetrievalConfidenceDiagnostics(scored: RankedVerse[]): RetrievalConfidenceDiagnostics {
  const topScores = scored.slice(0, 5).map((hit) => hit.score);
  const top1Score = topScores[0] ?? 0;
  const top5Floor = topScores[topScores.length - 1] ?? top1Score;
  return {
    top1_score: roundRetrievalDiagnostic(top1Score),
    top5_score_range: roundRetrievalDiagnostic(top1Score - top5Floor),
    retrieval_entropy: roundRetrievalDiagnostic(computeRetrievalEntropy(scored)),
    candidate_count: scored.length,
  };
}

function logRetrievalConfidenceDiagnostics(
  scored: RankedVerse[],
  options?: { domain?: string; translation?: string }
): void {
  console.info(JSON.stringify({
    event: 'retrieval_confidence',
    translation: options?.translation || 'BSB',
    domain: options?.domain || 'general',
    metrics: buildRetrievalConfidenceDiagnostics(scored),
  }));
}

export function logRetrievalDiagnostics(
  debugState: RetrievalDebugState,
  options: { translation: string; domain: string; topK: number; finalVerses: VerseContext[] }
): void {
  if (!debugState.topicGuardStageLogged) {
    addRetrievalStageTrace(debugState, { stage: 'topic_guard', action: 'not_invoked', source: 'hybrid' });
  }
  if (!debugState.curationStageLogged) {
    addRetrievalStageTrace(debugState, { stage: 'curation', action: 'not_invoked', source: 'hybrid' });
  }

  const candidates = Array.from(debugState.candidateTraces.values())
    .sort((l, r) => (l.final_rank ?? Number.MAX_SAFE_INTEGER) - (r.final_rank ?? Number.MAX_SAFE_INTEGER))
    .map((candidate) => ({
      ...candidate,
      decision_trace: getCandidateDecisionTrace(debugState, candidate.reference),
    }));

  const finalSelection = options.finalVerses.map((verse, index) => ({
    reference: verse.reference,
    output_rank: index + 1,
    decision_trace: getFinalSelectionTrace(debugState, verse.reference),
  }));

  console.info(JSON.stringify({
    event: 'retrieval_diagnostics',
    translation: options.translation,
    domain: options.domain,
    topK: options.topK,
    candidates,
    stage_traces: debugState.stageTraces,
    final_selection: finalSelection,
  }));
}

// ---------------------------------------------------------------------------
// clampTopK
// ---------------------------------------------------------------------------

export function clampTopK(topK?: number): number {
  const desired = Number.isFinite(topK) ? Math.floor(topK as number) : RETRIEVAL_CONFIG.finalCandidateWindow.default;
  return Math.min(
    Math.max(desired, RETRIEVAL_CONFIG.finalCandidateWindow.min),
    RETRIEVAL_CONFIG.finalCandidateWindow.max
  );
}

// ---------------------------------------------------------------------------
// Hybrid search (lexical only for now — semantic search is a future upgrade)
// ---------------------------------------------------------------------------

export async function hybridSearch(
  query: string,
  options?: { topK?: number; translation?: string },
  debugState?: RetrievalDebugState
): Promise<VerseResult[]> {
  const topK = clampTopK(options?.topK);
  const translation = options?.translation || 'BSB';
  const engine = await getBM25Engine();

  // Phase 2: Theological Query Expansion
  const expandedQuery = expandTheologicalQuery(query);
  const bm25Hits = engine.search(expandedQuery, RETRIEVAL_CONFIG.bm25.candidateLimit);



  if (bm25Hits.length === 0) {
    if (debugState) {
      addRetrievalStageTrace(debugState, { stage: 'bm25_search', action: 'no_match', query });
      debugState.hybridTopKRefs = [];
    }
    return [];
  }

  // Min-Max Normalization for BM25 scores
  const maxScore = bm25Hits[0].score;
  const minScore = bm25Hits[bm25Hits.length - 1].score;
  const scoreDiff = maxScore - minScore;

  const scored: RankedVerse[] = bm25Hits.map((hit, index) => ({
    verseId: hit.doc.id,
    score: scoreDiff > 0 ? (hit.score - minScore) / scoreDiff : 1,
    rankLexical: index + 1,
  }));

  // Phase 3: Conditional Semantic Re-ranking
  // Gating: Only trigger if BM25 top match is low confidence OR gap is small
  const top1Score = scored[0]?.score || 0;
  const scoreGap = top1Score - (scored[1]?.score || 0);
  const semanticGatingThreshold = 0.85; // BM25 max normalized score
  const gapThreshold = 0.15; // Confidence gap
  
  let finalRanked = scored;
  let semanticTriggered = false;

  if (top1Score < semanticGatingThreshold || scoreGap < gapThreshold) {
    semanticTriggered = true;
    const verseTexts = new Map(bm25Hits.map(h => [h.doc.id, h.doc.text]));
    const reRanked = await reRankSemantic(query, scored, verseTexts);
    finalRanked = reRanked;
  }



  if (scored.length === 0) {
    if (debugState) {
      addRetrievalStageTrace(debugState, { stage: 'lexical_search', action: 'no_match', query });
      debugState.hybridTopKRefs = [];
    }
    return [];
  }

  if (debugState) {
    addRetrievalStageTrace(debugState, {
      stage: 'bm25_search', action: 'applied', query,
      candidate_count: scored.length, limit: RETRIEVAL_CONFIG.bm25.candidateLimit,
      semantic_triggered: semanticTriggered,
    });

    finalRanked.forEach((hit, index) => {

      debugState.candidateTraces.set(hit.verseId, {
        reference: hit.verseId,
        lexical_rank: hit.rankLexical,
        final_score: roundRetrievalDiagnostic(hit.score),
        final_rank: index < topK ? index + 1 : null,
      });
    });
  }

  if (ENABLE_RETRIEVAL_DEBUG) {
    logRetrievalConfidenceDiagnostics(scored, { translation });
  }

  const finalHits = finalRanked.slice(0, topK);

  if (debugState) {
    debugState.hybridTopKRefs = finalHits.map((hit) => hit.verseId);
  }

  return finalHits.map((hit) => ({ verseId: hit.verseId }));
}


function computeTskTopicalCoverage(query: string, verses: VerseContext[]): number {
  const tokens = tokenizeFallbackQuery(query);
  if (tokens.length === 0) return 1;
  const coveredTokens = tokens.filter((token) =>
    verses.some((verse) => verse.text.toLowerCase().includes(token))
  );
  return coveredTokens.length / tokens.length;
}

export function buildTskExpansionDecision(query: string, coreVerses: VerseContext[]): TskExpansionDecision {
  const coreVerseCount = coreVerses.length;
  const topicalCoverage = Number(computeTskTopicalCoverage(query, coreVerses).toFixed(6));
  const countConfidence = TSK_CONFIG.MIN_CORE_VERSE_COUNT > 0
    ? Math.min(coreVerseCount / TSK_CONFIG.MIN_CORE_VERSE_COUNT, 1)
    : 1;
  const retrievalConfidence = Number(((countConfidence + topicalCoverage) / 2).toFixed(6));
  const metrics = { core_verse_count: coreVerseCount, topical_coverage: topicalCoverage, retrieval_confidence: retrievalConfidence };

  if (!ENABLE_TSK_EXPANSION_GATING) return { shouldExpand: true, reason: 'gating_disabled', metrics };
  if (coreVerseCount < TSK_CONFIG.MIN_CORE_VERSE_COUNT) return { shouldExpand: true, reason: 'insufficient_core_verses', metrics };
  if (topicalCoverage < TSK_CONFIG.MIN_TOPICAL_COVERAGE) return { shouldExpand: true, reason: 'insufficient_topical_coverage', metrics };
  if (retrievalConfidence < TSK_CONFIG.MIN_RETRIEVAL_CONFIDENCE) return { shouldExpand: true, reason: 'low_retrieval_confidence', metrics };
  return { shouldExpand: false, reason: 'strong_primary_evidence', metrics };
}
