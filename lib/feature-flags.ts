function isEnabled(value: string | undefined, defaultEnabled = false): boolean {
  if (value === undefined) {
    return defaultEnabled;
  }
  return value === '1';
}

export const ENABLE_SEMANTIC_RERANKER = false;
export const ENABLE_TSK_EXPANSION_GATING = process.env.ENABLE_TSK_EXPANSION_GATING !== '0';
export const ENABLE_RETRIEVAL_DEBUG =
  isEnabled(process.env.ENABLE_RETRIEVAL_DEBUG) ||
  isEnabled(process.env.RETRIEVAL_DEBUG) ||
  isEnabled(process.env.DEBUG_LLM);
