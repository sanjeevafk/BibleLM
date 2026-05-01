/**
 * Main retrieval orchestrator.
 * Coordinates: cache → query classification → direct refs → hybrid search
 * → API fallback → topic guards → enrichment → cache write.
 */

import { getCachedRetrievalContext, setCachedRetrievalContext } from '../cache';
import { classifyAndExpand } from '../query-utils';
import { getCrossReferences } from '../datasets/tsk';
import { ENABLE_RETRIEVAL_DEBUG } from '../feature-flags';
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
  logRetrievalDiagnostics,
} from './search';
import {
  fetchVersesByIds,
  fetchContextWindowsBatch,
  attachIndexedOriginals,
  applyTranslationOverride,
  retrieveContextViaApis,
  extractDirectReferences,
} from './verse-fetch';
import { enrichOriginalLanguages } from './enrichment';
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

  const orderedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const verseId of [...directRefIds, ...hybridResults.map((r) => r.verseId)]) {
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
