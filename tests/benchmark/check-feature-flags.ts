import * as flags from '../../lib/feature-flags';

const REQUIRED_BOOLEAN_FLAGS = [
  'ENABLE_SEMANTIC_RERANKER',
  'ENABLE_DETERMINISTIC_RERANKER',
  'ENABLE_TOPIC_RETRIEVAL_BOOST',
  'ENABLE_PASSAGE_RETRIEVAL',
  'ENABLE_TSK_CLUSTER_BOOST',
  'ENABLE_TSK_EXPANSION_GATING',
  'ENABLE_RETRIEVAL_DEBUG',
] as const;

type FlagName = typeof REQUIRED_BOOLEAN_FLAGS[number];

function main(): void {
  const failures: string[] = [];
  const output: Record<FlagName, boolean> = {} as Record<FlagName, boolean>;

  for (const name of REQUIRED_BOOLEAN_FLAGS) {
    const value = (flags as Record<string, unknown>)[name];
    if (typeof value !== 'boolean') {
      failures.push(`${name} must be exported as boolean, got ${typeof value}`);
      continue;
    }
    output[name] = value;
  }

  if (failures.length > 0) {
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }

  console.log(JSON.stringify({
    status: 'ok',
    flag_count: REQUIRED_BOOLEAN_FLAGS.length,
    flags: output,
  }, null, 2));
}

main();
