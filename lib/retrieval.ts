/**
 * Public API barrel for the retrieval subsystem.
 *
 * External callers import only from here — never from the sub-modules directly.
 * This keeps the internal module graph an implementation detail.
 */

export { retrieveContextForQuery } from './retrieval/pipeline';
export { shouldRerank, rerankCandidates, RERANK_MODEL, RERANK_MAX_CANDIDATES } from './retrieval/reranker';
export type { WorkersAiBinding } from './retrieval/reranker';
export type { RetrievalInstrumentation } from './retrieval/types';
