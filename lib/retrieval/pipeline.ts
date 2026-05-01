/**
 * Main retrieval orchestrator.
 * Coordinates: cache → query classification → direct refs → hybrid search
 * → API fallback → topic guards → enrichment → cache write.
 */

import { getCachedRetrievalContext, setCachedRetrievalContext } from '../cache';
import { classifyAndExpand } from '../query-utils';
import { getCrossReferences } from '../datasets/tsk';
import {
  ENABLE_DETERMINISTIC_RERANKER,
  ENABLE_PASSAGE_RETRIEVAL,
  ENABLE_RETRIEVAL_DEBUG,
  ENABLE_TSK_CLUSTER_BOOST,
  ENABLE_TOPIC_RETRIEVAL_BOOST,
} from '../feature-flags';
import { ensureDbReady, getDbPool } from '../db';
import type { VerseContext } from '../bible-fetch';
import { CONTEXT_CACHE_VERSION } from './types';
import type { RetrievalInstrumentation } from './types';
import { cloneVerses, normalizeVerses, dedupeByVerseId } from './verse-utils';
import { applyTopicGuards, applyCuratedTopicalLists } from './topic-guards';
import {
  hybridSearch,
  clampTopK,
  createRetrievalDebugState,
  addRetrievalStageTrace,
  addDecisionTrace,
  logRetrievalDiagnostics,
} from './search';
import {
  fetchPassageWindowCandidates,
  mergeOverlappingPassages,
  fetchVersesByIds,
  fetchContextWindowsBatch,
  attachIndexedOriginals,
  applyTranslationOverride,
  retrieveContextViaApis,
  extractDirectReferences,
} from './verse-fetch';
import { enrichOriginalLanguages } from './enrichment';
import { embedQuery } from './semantic';
import { TSK_CONFIG } from './types';

type VerseMetadataRecord = {
  verseId?: string;
  confidence?: number;
};
type TopicDatasetItem = {
  id: string;
  label: string;
  synonyms: string[];
};
type VerseTopicAssignment = { id: string; confidence: number };
type VerseTopicRecord = { verseId: string; topics: VerseTopicAssignment[] };

let verseMetadataByIdPromise: Promise<Map<string, number>> | null = null;
let topicDatasetPromise: Promise<TopicDatasetItem[] | null> | null = null;
let verseTopicDatasetPromise: Promise<Map<string, Map<string, number>> | null> | null = null;
let topicEmbeddingCachePromise: Promise<Map<string, number[]> | null> | null = null;

const TOPIC_EMBED_THRESHOLD = 0.35;
const MAX_CLUSTER_CANDIDATES = 8;
const MAX_CLUSTER_MEMBERS_CONSIDERED = 12;
const MAX_CLUSTER_BOOST_APPLIED = 5;
const CLUSTER_LIKE_TOKEN_LIMIT = 4;

async function getVerseMetadataConfidenceMap(): Promise<Map<string, number>> {
  if (!verseMetadataByIdPromise) {
    verseMetadataByIdPromise = (async () => {
      try {
        const raw = (await import('../../data/verse-metadata.json')).default as VerseMetadataRecord[] | Record<string, VerseMetadataRecord>;
        const map = new Map<string, number>();
        const records = Array.isArray(raw) ? raw : Object.values(raw);
        for (const value of records) {
          const verseId = value?.verseId?.trim().toUpperCase();
          if (!verseId) continue;
          const confidence = typeof value.confidence === 'number' ? value.confidence : 0.5;
          map.set(verseId, Math.max(0, Math.min(1, confidence)));
        }
        return map;
      } catch (error) {
        verseMetadataByIdPromise = null;
        console.warn('Failed to load verse metadata confidence map; continuing without metadata signal', error);
        return new Map<string, number>();
      }
    })();
  }
  return verseMetadataByIdPromise;
}

async function getTopicDataset(): Promise<TopicDatasetItem[] | null> {
  if (!topicDatasetPromise) {
    topicDatasetPromise = (async () => {
      try {
        const raw = (await import('../../data/topics.json')).default as { items?: TopicDatasetItem[] };
        const items = Array.isArray(raw?.items) ? raw.items : [];
        return items.map((item) => ({
          id: String(item.id || '').trim().toLowerCase(),
          label: String(item.label || '').trim(),
          synonyms: Array.isArray(item.synonyms) ? item.synonyms.map((s) => String(s).trim()) : [],
        })).filter((item) => item.id.length > 0);
      } catch (error) {
        topicDatasetPromise = null;
        console.warn('[retrieval] topics.json missing/invalid; topic boost disabled.', error);
        return null;
      }
    })();
  }
  return topicDatasetPromise;
}

async function getVerseTopicDataset(): Promise<Map<string, Map<string, number>> | null> {
  if (!verseTopicDatasetPromise) {
    verseTopicDatasetPromise = (async () => {
      try {
        const raw = (await import('../../data/verse-topics.json')).default as { items?: VerseTopicRecord[] };
        const items = Array.isArray(raw?.items) ? raw.items : [];
        const map = new Map<string, Map<string, number>>();
        for (const item of items) {
          const verseId = String(item.verseId || '').trim().toUpperCase();
          if (!verseId) continue;
          const assignments = new Map<string, number>();
          for (const topic of item.topics ?? []) {
            const id = String(topic.id || '').trim().toLowerCase();
            const confidence = Math.max(0, Math.min(1, Number(topic.confidence ?? 0)));
            if (!id || confidence <= 0) continue;
            assignments.set(id, Math.max(assignments.get(id) ?? 0, confidence));
          }
          if (assignments.size > 0) map.set(verseId, assignments);
        }
        return map;
      } catch (error) {
        verseTopicDatasetPromise = null;
        console.warn('[retrieval] verse-topics.json missing/invalid; topic boost disabled.', error);
        return null;
      }
    })();
  }
  return verseTopicDatasetPromise;
}

function tokenOverlapScore(queryTokens: Set<string>, candidateTokens: Set<string>): number {
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;
  let hits = 0;
  for (const token of candidateTokens) {
    if (queryTokens.has(token)) hits += 1;
  }
  return hits / candidateTokens.size;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

type TskClusterRow = {
  members: string[];
  vote_total: number;
};

async function getClusterBoostScores(normalizedQuery: string): Promise<Map<string, number>> {
  if (!ENABLE_TSK_CLUSTER_BOOST) return new Map<string, number>();

  const tokens = Array.from(new Set(tokenize(normalizedQuery))).slice(0, CLUSTER_LIKE_TOKEN_LIMIT);
  if (tokens.length === 0) return new Map<string, number>();

  try {
    await ensureDbReady();
    const pool = getDbPool();
    if (!pool) return new Map<string, number>();

    const likeClauses = tokens.map((_, idx) => `label LIKE ?`).join(' OR ');
    const sql = `
      SELECT members, vote_total
      FROM tsk_clusters
      WHERE ${likeClauses}
      ORDER BY vote_total DESC
      LIMIT ?
    `;
    const params = [...tokens.map((token) => `%${token}%`), MAX_CLUSTER_CANDIDATES];
    const result = await pool.query<{ members: string | null; vote_total: number | null }>(sql, params);
    const rows = result.rows;

    const verseScores = new Map<string, number>();
    for (const row of rows) {
      if (verseScores.size >= MAX_CLUSTER_BOOST_APPLIED) break;
      const rawMembers = typeof row.members === 'string' ? row.members : '';
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawMembers);
      } catch {
        parsed = [];
      }
      const cluster: TskClusterRow = {
        members: Array.isArray(parsed) ? parsed.map((item) => String(item).trim().toUpperCase()).filter(Boolean) : [],
        vote_total: typeof row.vote_total === 'number' ? row.vote_total : 0,
      };
      if (cluster.members.length === 0 || cluster.vote_total <= 0) continue;
      const clusterSignal = Math.max(0, Math.min(1, cluster.vote_total / 250));
      for (const verseId of cluster.members.slice(0, MAX_CLUSTER_MEMBERS_CONSIDERED)) {
        if (verseScores.size >= MAX_CLUSTER_BOOST_APPLIED && !verseScores.has(verseId)) break;
        const existing = verseScores.get(verseId) ?? 0;
        if (clusterSignal > existing) verseScores.set(verseId, clusterSignal);
      }
    }
    return verseScores;
  } catch (error) {
    console.warn('[retrieval] cluster boost unavailable; continuing without cluster signal.', error);
    return new Map<string, number>();
  }
}

async function detectMatchedTopics(normalizedQuery: string): Promise<Set<string>> {
  const topics = await getTopicDataset();
  if (!topics || topics.length === 0) return new Set();

  const queryTokens = new Set(tokenize(normalizedQuery));
  const lexicalMatches: Array<{ id: string; score: number }> = [];
  for (const topic of topics) {
    const candidateTokens = new Set(tokenize(`${topic.label} ${topic.synonyms.join(' ')}`));
    const score = tokenOverlapScore(queryTokens, candidateTokens);
    if (score > 0) lexicalMatches.push({ id: topic.id, score });
  }

  lexicalMatches.sort((a, b) => b.score - a.score);
  const strongLexical = lexicalMatches.filter((m) => m.score >= 0.4).slice(0, 3);
  if (strongLexical.length > 0) return new Set(strongLexical.map((m) => m.id));

  const weakLexical = lexicalMatches.slice(0, 3);
  if (weakLexical.length > 0 && weakLexical[0].score >= 0.2) {
    return new Set(weakLexical.map((m) => m.id));
  }

  // Lexical is weak — fall back to embedding similarity.
  const queryEmbedding = await embedQuery(normalizedQuery);
  if (!queryEmbedding) return new Set();

  if (!topicEmbeddingCachePromise) {
    topicEmbeddingCachePromise = (async () => {
      const cache = new Map<string, number[]>();
      for (const topic of topics) {
        const embedding = await embedQuery(`${topic.label}. ${topic.synonyms.slice(0, 4).join(', ')}`);
        if (embedding && embedding.length > 0) cache.set(topic.id, embedding);
      }
      return cache;
    })();
  }

  const topicEmbeddings = await topicEmbeddingCachePromise;
  if (!topicEmbeddings || topicEmbeddings.size === 0) return new Set();

  const scored: Array<{ id: string; score: number }> = [];
  for (const topic of topics) {
    const embedding = topicEmbeddings.get(topic.id);
    if (!embedding || embedding.length !== queryEmbedding.length) continue;
    let dot = 0;
    for (let i = 0; i < embedding.length; i += 1) dot += queryEmbedding[i] * embedding[i];
    scored.push({ id: topic.id, score: dot });
  }

  return new Set(
    scored
      .filter((entry) => entry.score >= TOPIC_EMBED_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.id)
  );
}

async function applyDeterministicReranker(
  candidates: Array<{ verseId: string; score?: number }>,
  directRefIds: string[],
  topK: number,
  debugState: ReturnType<typeof createRetrievalDebugState> | undefined,
  matchedTopics?: Set<string>,
  clusterScores?: Map<string, number>
): Promise<string[]> {
  if (candidates.length === 0) return [];

  const metadataConfidence = await getVerseMetadataConfidenceMap();
  const directRefs = new Set(directRefIds.map((id) => id.trim().toUpperCase()));
  const primaryRefs = candidates.slice(0, topK).map((c) => c.verseId.trim().toUpperCase());
  const primaryRefSet = new Set(primaryRefs);
  const crossReferenceSet = new Set<string>();
  const verseTopicDataset = matchedTopics && matchedTopics.size > 0 ? await getVerseTopicDataset() : null;

  const crossReferences = await Promise.all(primaryRefs.map((reference) => getCrossReferences(reference)));
  for (const refs of crossReferences) {
    for (const ref of refs) {
      const normalized = ref.reference.trim().toUpperCase();
      if (!normalized || primaryRefSet.has(normalized)) continue;
      crossReferenceSet.add(normalized);
    }
  }

  const fallbackBaseScore = (idx: number) => (candidates.length - idx) / candidates.length;

  const reranked = candidates
    .map((candidate, index) => {
      const verseId = candidate.verseId.trim().toUpperCase();
      const fusedScore = typeof candidate.score === 'number' ? candidate.score : fallbackBaseScore(index);
      const directReferenceSignal = directRefs.has(verseId) ? 1 : 0;
      const metadataSignal = metadataConfidence.get(verseId) ?? 0.5;
      const crossReferenceSignal = crossReferenceSet.has(verseId) ? 1 : 0;
      const clusterSignal = clusterScores?.get(verseId) ?? 0;
      let topicSignal = 0;
      if (matchedTopics && matchedTopics.size > 0 && verseTopicDataset) {
        const assigned = verseTopicDataset.get(verseId);
        if (assigned) {
          for (const topicId of matchedTopics) {
            topicSignal = Math.max(topicSignal, assigned.get(topicId) ?? 0);
          }
        }
      }
      const finalScore =
        fusedScore +
        (0.15 * directReferenceSignal) +
        (0.10 * metadataSignal) +
        (0.10 * topicSignal) +
        (0.06 * clusterSignal) +
        (0.05 * crossReferenceSignal);

      if (debugState) {
        addDecisionTrace(
          debugState,
          verseId,
          `deterministic_reranker:fused=${fusedScore.toFixed(4)},direct=${directReferenceSignal.toFixed(1)},metadata=${metadataSignal.toFixed(4)},topic=${topicSignal.toFixed(4)},cluster=${clusterSignal.toFixed(4)},cross_ref=${crossReferenceSignal.toFixed(1)},final=${finalScore.toFixed(4)}`
        );
      }

      return { verseId, finalScore };
    })
    .sort((a, b) => b.finalScore - a.finalScore);

  return reranked.map((entry) => entry.verseId);
}
// ---------------------------------------------------------------------------
// TSK cross-reference expansion logic
// ---------------------------------------------------------------------------

async function getTskCrossReferences(
  primaryVerses: VerseContext[],
  translation: string
): Promise<VerseContext[]> {
  if (primaryVerses.length === 0) return [];

  const primaryRefs = new Set(
    primaryVerses.map((verse) => verse.reference.trim().toUpperCase()).filter(Boolean)
  );
  const targetVotes = new Map<string, number>();

  const crossReferenceSets = await Promise.all(
    primaryVerses.map((verse) => getCrossReferences(verse.reference))
  );

  for (const refs of crossReferenceSets) {
    for (const ref of refs) {
      const votes = ref.votes ?? 0;
      const normalizedRef = ref.reference.trim().toUpperCase();
      if (votes <= 10 || primaryRefs.has(normalizedRef)) continue;
      const current = targetVotes.get(normalizedRef) ?? Number.NEGATIVE_INFINITY;
      if (votes > current) targetVotes.set(normalizedRef, votes);
    }
  }

  const targetRefs = Array.from(targetVotes.entries())
    .sort((l, r) => r[1] - l[1])
    .slice(0, 3)
    .map(([reference]) => reference);

  if (targetRefs.length === 0) return [];

  const crossRefVerses = await fetchVersesByIds(targetRefs, translation);
  return crossRefVerses.map((v: VerseContext) => ({ ...v, isCrossReference: true }));
}

function recordRetrievalMetric(
  instrumentation: RetrievalInstrumentation | undefined,
  metric: 'fetch_verses_db_ms' | 'fetch_verses_api_ms' | 'enrich_ms',
  startedAt: number
): void {
  instrumentation?.onMetric?.(metric, performance.now() - startedAt);
}

function isLowRetrievalConfidence(hybridResults: Array<{ score?: number }>, topK: number): boolean {
  if (hybridResults.length === 0) return true;
  const top = hybridResults.slice(0, Math.min(topK, 5));
  if (top.length === 0) return true;
  const avg = top.reduce((sum, row) => sum + (typeof row.score === 'number' ? row.score : 0), 0) / top.length;
  return avg < TSK_CONFIG.MIN_RETRIEVAL_CONFIDENCE;
}

export async function retrieveContextForQuery(
  query: string,
  translation: string,
  apiKey?: string,
  instrumentation?: RetrievalInstrumentation
): Promise<VerseContext[]> {
  const debugState = ENABLE_RETRIEVAL_DEBUG ? createRetrievalDebugState() : undefined;

  // Cache hit
  const cached = await getCachedRetrievalContext({ query, translation, version: CONTEXT_CACHE_VERSION });
  if (cached) {
    return cloneVerses(normalizeVerses(dedupeByVerseId(cached)));
  }

  const topK = clampTopK();
  const { domain, intent, expandedQuery, normalizedQuery, negationHints } = classifyAndExpand(query);
  const matchedTopics =
    ENABLE_TOPIC_RETRIEVAL_BOOST
      ? await detectMatchedTopics(normalizedQuery)
      : new Set<string>();
  const directRefs = extractDirectReferences(normalizedQuery);
  const hasRangedDirectRefs = directRefs.some(
    (ref) => typeof ref.endVerse === 'number' && ref.endVerse > ref.verse
  );
  const directRefIds = directRefs
    .filter((ref) => !(typeof ref.endVerse === 'number' && ref.endVerse > ref.verse))
    .map((ref) => `${ref.book} ${ref.chapter}:${ref.verse}`);

  // Fast path: direct reference or verse explanation
  if (
    !hasRangedDirectRefs &&
    (intent === 'DIRECT_REFERENCE' || intent === 'VERSE_EXPLANATION') &&
    directRefIds.length > 0
  ) {
    const exactVerses = await fetchVersesByIds(directRefIds.slice(0, topK), translation);
    let focusedVerses = exactVerses;

    if (intent === 'VERSE_EXPLANATION' && exactVerses.length > 0) {
      try {
        const tskVerses = await getTskCrossReferences(exactVerses, translation);
        focusedVerses = [...exactVerses, ...tskVerses];
      } catch (error) {
        console.warn('Explanation cross-reference retrieval failed; continuing with target verses only', error);
      }
    }

    attachIndexedOriginals(focusedVerses);
    const enrichStartedAt = performance.now();
    const enriched = await enrichOriginalLanguages(focusedVerses);
    recordRetrievalMetric(instrumentation, 'enrich_ms', enrichStartedAt);
    const translated = await applyTranslationOverride(enriched, translation);
    const deduped = dedupeByVerseId(translated);
    const normalized = normalizeVerses(deduped).slice(0, topK);
    await setCachedRetrievalContext({ query, translation, version: CONTEXT_CACHE_VERSION }, normalized).catch(
      (err) => console.warn('Failed to cache retrieval context', err)
    );
    return cloneVerses(normalized);
  }

  // Hybrid search path
  const hybridResults = await hybridSearch(
    expandedQuery,
    { topK, translation, negationHints, topicalExpansionMode: intent === 'TOPICAL_QUERY' },
    debugState
  );
  const clusterScores = await getClusterBoostScores(normalizedQuery);

  const candidateOrder = ENABLE_DETERMINISTIC_RERANKER
    ? await applyDeterministicReranker(
      hybridResults,
      directRefIds,
      topK,
      debugState,
      matchedTopics,
      clusterScores
    )
    : hybridResults.map((result) => result.verseId.trim().toUpperCase());

  const orderedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const verseId of [...directRefIds, ...candidateOrder]) {
    const key = verseId.trim().toUpperCase();
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    orderedIds.push(key);
  }
  const limitedIds = orderedIds.slice(0, topK);

  const fetchVersesStartedAt = performance.now();
  
  // Phase 4: Context Window Expansion
  // N+1 FIX: Previously, fetchContextWindow was called per-ID inside a .map(),
  // creating N separate DB/API fetches. fetchContextWindowsBatch collects all
  // window refs for the expansion IDs in a single deduplicated pass, then
  // issues exactly one fetchVersesByIds call for all of them.
  const expansionLimit = 3;
  const expansionIds = limitedIds.slice(0, expansionLimit);
  const remainingIds = limitedIds.slice(expansionLimit);

  const [batchExpanded, remainingVerses] = await Promise.all([
    fetchContextWindowsBatch(expansionIds, translation, 1),
    remainingIds.length > 0 ? fetchVersesByIds(remainingIds, translation) : Promise.resolve([]),
  ]);

  const expandedVerses: VerseContext[] = [...batchExpanded, ...remainingVerses];
  let verses = expandedVerses;

  const passageRetrievalEnabled = intent === 'VERSE_EXPLANATION' || isLowRetrievalConfidence(hybridResults, topK);
  if (ENABLE_PASSAGE_RETRIEVAL && passageRetrievalEnabled) {
    const passageCandidates = await fetchPassageWindowCandidates(normalizedQuery, 10);
    const mergedPassages = mergeOverlappingPassages(passageCandidates, 0.6);
    const passageVerseIds = Array.from(
      new Set(mergedPassages.slice(0, 10).flatMap((candidate) => candidate.verseIds))
    );
    if (passageVerseIds.length > 0) {
      const passageVerses = await fetchVersesByIds(passageVerseIds, translation);
      const byRef = new Map(verses.map((v) => [v.reference.trim().toUpperCase(), v]));
      for (const verse of passageVerses) {
        byRef.set(verse.reference.trim().toUpperCase(), verse);
      }
      const directRefSet = new Set(directRefIds.map((id) => id.trim().toUpperCase()));
      const ordered = Array.from(byRef.values()).sort((a, b) => {
        const aRef = a.reference.trim().toUpperCase();
        const bRef = b.reference.trim().toUpperCase();
        const aDirect = directRefSet.has(aRef) ? 1 : 0;
        const bDirect = directRefSet.has(bRef) ? 1 : 0;
        if (aDirect !== bDirect) return bDirect - aDirect;
        return aRef.localeCompare(bRef);
      });
      verses = ordered;
    }
  }

  recordRetrievalMetric(instrumentation, 'fetch_verses_db_ms', fetchVersesStartedAt);


  const shouldUseApiFallback =
    verses.length === 0 ||
    (limitedIds.length > 0 && verses.length < Math.min(limitedIds.length, topK));

  addRetrievalStageTrace(debugState, {
    stage: 'api_fallback',
    action: shouldUseApiFallback ? 'used' : 'skipped',
    reason: shouldUseApiFallback
      ? (verses.length === 0 ? 'no_verses_after_hybrid_fetch' : 'partial_hybrid_fetch')
      : 'hybrid_fetch_sufficient',
  });

  if (shouldUseApiFallback) {
    const apiFetchStartedAt = performance.now();
    try {
      const apiVerses = await retrieveContextViaApis(normalizedQuery, translation, debugState);
      verses = [...verses, ...apiVerses];
    } catch (error) {
      console.warn('API retrieval failed; continuing with available verses', error);
    } finally {
      recordRetrievalMetric(instrumentation, 'fetch_verses_api_ms', apiFetchStartedAt);
    }
  }

  const source = shouldUseApiFallback ? 'api_fallback' : 'db';
  const postProcessed = applyCuratedTopicalLists(
    normalizedQuery,
    applyTopicGuards(normalizedQuery, verses, debugState, source),
    debugState,
    source
  );

  attachIndexedOriginals(postProcessed);
  const enrichStartedAt = performance.now();
  const enriched = await enrichOriginalLanguages(postProcessed);
  recordRetrievalMetric(instrumentation, 'enrich_ms', enrichStartedAt);
  const translated = await applyTranslationOverride(enriched, translation);
  const deduped = dedupeByVerseId(translated);
  const normalized = normalizeVerses(deduped).slice(0, topK);

  if (debugState) {
    logRetrievalDiagnostics(debugState, { translation, domain, topK, finalVerses: normalized });
  }

  await setCachedRetrievalContext({ query, translation, version: CONTEXT_CACHE_VERSION }, normalized);
  return cloneVerses(normalized);
}
