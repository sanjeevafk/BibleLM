function isEnabled(value: string | undefined, defaultEnabled = false): boolean {
  if (value === undefined) {
    return defaultEnabled;
  }
  return value === '1';
}

export function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Retrieval rollout flags (defaults documented in project-docs/benchmark-rollout.md)
export const ENABLE_SEMANTIC_RERANKER = isEnabled(process.env.ENABLE_SEMANTIC_RERANKER);
export const ENABLE_DETERMINISTIC_RERANKER = process.env.ENABLE_DETERMINISTIC_RERANKER !== '0';
export const ENABLE_TOPIC_RETRIEVAL_BOOST = isEnabled(process.env.ENABLE_TOPIC_RETRIEVAL_BOOST);
export const ENABLE_PASSAGE_RETRIEVAL = isEnabled(process.env.ENABLE_PASSAGE_RETRIEVAL);
export const ENABLE_TSK_CLUSTER_BOOST = isEnabled(process.env.ENABLE_TSK_CLUSTER_BOOST);
export const ENABLE_TSK_EXPANSION_GATING = process.env.ENABLE_TSK_EXPANSION_GATING !== '0';
export const ENABLE_RETRIEVAL_DEBUG =
  isEnabled(process.env.ENABLE_RETRIEVAL_DEBUG) ||
  isEnabled(process.env.RETRIEVAL_DEBUG) ||
  isEnabled(process.env.DEBUG_LLM);
