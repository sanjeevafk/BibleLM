/**
 * Shared types and constants for the retrieval subsystem.
 * No logic — import from here to avoid circular dependencies.
 */
import { numberFromEnv } from '../feature-flags';

export const OT_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI',
  '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
  'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP',
  'HAG', 'ZEC', 'MAL',
]);

export const NT_BOOKS = new Set([
  'MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH',
  'PHP', 'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS',
  '1PE', '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
]);

export const LOCAL_TRANSLATIONS = new Set(['BSB', 'KJV', 'WEB', 'ASV', 'NHEB']);

export const CONTEXT_CACHE_VERSION = 'v3';

export const RETRIEVAL_CONFIG = {
  bm25: {
    k1: numberFromEnv(process.env.BM25_K1, 1.2),
    b: numberFromEnv(process.env.BM25_B, 0.65),
    phraseBoost: numberFromEnv(process.env.BM25_PHRASE_BOOST, 1.5),
    candidateLimit: Math.max(1, Math.floor(numberFromEnv(process.env.BM25_CANDIDATE_LIMIT, 25))),
  },
  rrf: {
    k: Math.max(1, Math.floor(numberFromEnv(process.env.RRF_K, 60))),
  },
  finalCandidateWindow: {
    default: 5,
    min: 5,
    max: 8,
  },
} as const;


export const TSK_CONFIG = {
  MIN_CORE_VERSE_COUNT: 4,
  MIN_TOPICAL_COVERAGE: 0.6,
  MIN_RETRIEVAL_CONFIDENCE: 0.75,
} as const;

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export type VerseResult = { verseId: string; score?: number };

export type LexicalDoc = {
  verseId: string;
  text: string;
};

export type RankedVerse = {
  verseId: string;
  score: number;
  rankLexical: number;
};

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

export type RetrievalLatencyMetricName =
  | 'fetch_verses_db_ms'
  | 'fetch_verses_api_ms'
  | 'enrich_ms';

export type RetrievalInstrumentation = {
  requestId?: string;
  onMetric?: (metric: RetrievalLatencyMetricName, durationMs: number) => void;
};

// ---------------------------------------------------------------------------
// Debug / diagnostics
// ---------------------------------------------------------------------------

export type RetrievalConfidenceDiagnostics = {
  top1_score: number;
  top5_score_range: number;
  retrieval_entropy: number;
  candidate_count: number;
};

export type RetrievalCandidateDiagnostics = {
  reference: string;
  lexical_rank: number | null;
  final_score: number;
  final_rank: number | null;
};

export type RetrievalStageTrace = Record<string, unknown>;

export type TskExpansionDecision = {
  shouldExpand: boolean;
  reason:
    | 'gating_disabled'
    | 'insufficient_core_verses'
    | 'insufficient_topical_coverage'
    | 'low_retrieval_confidence'
    | 'strong_primary_evidence';
  metrics: {
    core_verse_count: number;
    topical_coverage: number;
    retrieval_confidence: number;
  };
};

export type RetrievalDebugState = {
  candidateTraces: Map<string, RetrievalCandidateDiagnostics>;
  decisionTraceByReference: Map<string, string[]>;
  stageTraces: RetrievalStageTrace[];
  hybridTopKRefs: string[];
  topicGuardStageLogged: boolean;
  curationStageLogged: boolean;
};
