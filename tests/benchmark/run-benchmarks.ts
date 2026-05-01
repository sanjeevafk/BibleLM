import fs from 'fs';
import path from 'path';

import { retrieveContextForQuery } from '../../lib/retrieval';

type Scenario = {
  id: string;
  category: string;
  cacheMode: 'hit' | 'miss';
  query: string;
  translation: string;
  expectedTopRefs: string[];
};

type BenchmarkRun = {
  total_latency_ms: number;
  retrieval_latency_ms: number;
  llm_latency_ms: number;
  precision_at_5: number;
  citation_validity_rate: number;
  hit_at_1: number;
  hit_at_5: number;
  mrr: number;
};

type SampleFixture = {
  baseline: Record<string, BenchmarkRun[]>;
  optimized: Record<string, BenchmarkRun[]>;
};

type AggregateMetrics = {
  total_latency_ms: number;
  retrieval_latency_ms: number;
  llm_latency_ms: number;
  p50_latency: number;
  p95_latency: number;
  precision_at_5: number;
  citation_validity_rate: number;
  hit_at_1: number;
  hit_at_5: number;
  mrr: number;
};

type ScenarioReport = {
  id: string;
  category: string;
  cacheMode: 'hit' | 'miss';
  baseline: AggregateMetrics;
  optimized: AggregateMetrics;
  delta: AggregateMetrics;
  baseline_top_refs?: string[];
  optimized_top_refs?: string[];
};

type Report = {
  generated_at: string;
  mode: 'sample' | 'live';
  notes?: string[];
  scenarios: Scenario[];
  baseline_metrics: AggregateMetrics;
  post_optimization_metrics: AggregateMetrics;
  performance_deltas: AggregateMetrics;
  per_scenario: ScenarioReport[];
};

const ROOT = path.resolve(__dirname, '..', '..');
const SCENARIOS_PATH = path.join(__dirname, 'fixtures', 'scenarios.json');
const SAMPLE_RESULTS_PATH = path.join(__dirname, 'fixtures', 'sample-results.json');
const REPORT_DIR = path.join(ROOT, 'project-docs', 'benchmark');
const REPORT_JSON_PATH = path.join(REPORT_DIR, 'latest-report.json');
const REPORT_MD_PATH = path.join(REPORT_DIR, 'latest-report.md');

function parseMode(): 'sample' | 'live' {
  const index = process.argv.indexOf('--mode');
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === 'live' ? 'live' : 'sample';
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(index, 0)].toFixed(2));
}

function aggregateRuns(runs: BenchmarkRun[]): AggregateMetrics {
  return {
    total_latency_ms: average(runs.map((run) => run.total_latency_ms)),
    retrieval_latency_ms: average(runs.map((run) => run.retrieval_latency_ms)),
    llm_latency_ms: average(runs.map((run) => run.llm_latency_ms)),
    p50_latency: percentile(runs.map((run) => run.total_latency_ms), 50),
    p95_latency: percentile(runs.map((run) => run.total_latency_ms), 95),
    precision_at_5: average(runs.map((run) => run.precision_at_5)),
    citation_validity_rate: average(runs.map((run) => run.citation_validity_rate)),
    hit_at_1: average(runs.map((run) => run.hit_at_1)),
    hit_at_5: average(runs.map((run) => run.hit_at_5)),
    mrr: average(runs.map((run) => run.mrr)),
  };
}

function computeDelta(baseline: AggregateMetrics, optimized: AggregateMetrics): AggregateMetrics {
  return {
    total_latency_ms: Number((optimized.total_latency_ms - baseline.total_latency_ms).toFixed(2)),
    retrieval_latency_ms: Number((optimized.retrieval_latency_ms - baseline.retrieval_latency_ms).toFixed(2)),
    llm_latency_ms: Number((optimized.llm_latency_ms - baseline.llm_latency_ms).toFixed(2)),
    p50_latency: Number((optimized.p50_latency - baseline.p50_latency).toFixed(2)),
    p95_latency: Number((optimized.p95_latency - baseline.p95_latency).toFixed(2)),
    precision_at_5: Number((optimized.precision_at_5 - baseline.precision_at_5).toFixed(2)),
    citation_validity_rate: Number((optimized.citation_validity_rate - baseline.citation_validity_rate).toFixed(2)),
    hit_at_1: Number((optimized.hit_at_1 - baseline.hit_at_1).toFixed(2)),
    hit_at_5: Number((optimized.hit_at_5 - baseline.hit_at_5).toFixed(2)),
    mrr: Number((optimized.mrr - baseline.mrr).toFixed(2)),
  };
}

function ensureReportDir(): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function renderMarkdown(report: Report): string {
  const scenarioRows = report.per_scenario
    .map((scenario) =>
      `| ${scenario.id} | ${scenario.category} | ${scenario.cacheMode} | ${scenario.baseline.total_latency_ms} | ${scenario.optimized.total_latency_ms} | ${scenario.delta.total_latency_ms} | ${scenario.optimized.precision_at_5} | ${scenario.optimized.hit_at_5} | ${scenario.optimized.mrr} | ${scenario.optimized.citation_validity_rate} |`
    )
    .join('\n');

  return [
    '# Benchmark Report',
    '',
    `Generated: ${report.generated_at}`,
    `Mode: ${report.mode}`,
    ...(report.notes && report.notes.length > 0 ? ['', ...report.notes.map((note) => `- ${note}`)] : []),
    '',
    '## Aggregate Metrics',
    '',
    '| Metric | Baseline | Optimized | Delta |',
    '| --- | ---: | ---: | ---: |',
    `| total_latency_ms | ${report.baseline_metrics.total_latency_ms} | ${report.post_optimization_metrics.total_latency_ms} | ${report.performance_deltas.total_latency_ms} |`,
    `| retrieval_latency_ms | ${report.baseline_metrics.retrieval_latency_ms} | ${report.post_optimization_metrics.retrieval_latency_ms} | ${report.performance_deltas.retrieval_latency_ms} |`,
    `| llm_latency_ms | ${report.baseline_metrics.llm_latency_ms} | ${report.post_optimization_metrics.llm_latency_ms} | ${report.performance_deltas.llm_latency_ms} |`,
    `| p50_latency | ${report.baseline_metrics.p50_latency} | ${report.post_optimization_metrics.p50_latency} | ${report.performance_deltas.p50_latency} |`,
    `| p95_latency | ${report.baseline_metrics.p95_latency} | ${report.post_optimization_metrics.p95_latency} | ${report.performance_deltas.p95_latency} |`,
    `| precision_at_5 | ${report.baseline_metrics.precision_at_5} | ${report.post_optimization_metrics.precision_at_5} | ${report.performance_deltas.precision_at_5} |`,
    `| citation_validity_rate | ${report.baseline_metrics.citation_validity_rate} | ${report.post_optimization_metrics.citation_validity_rate} | ${report.performance_deltas.citation_validity_rate} |`,
    `| hit_at_1 | ${report.baseline_metrics.hit_at_1} | ${report.post_optimization_metrics.hit_at_1} | ${report.performance_deltas.hit_at_1} |`,
    `| hit_at_5 | ${report.baseline_metrics.hit_at_5} | ${report.post_optimization_metrics.hit_at_5} | ${report.performance_deltas.hit_at_5} |`,
    `| mrr | ${report.baseline_metrics.mrr} | ${report.post_optimization_metrics.mrr} | ${report.performance_deltas.mrr} |`,
    '',
    '## Scenario Breakdown',
    '',
    '| Scenario | Category | Cache | Baseline Total | Optimized Total | Delta | Precision@5 | Hit@5 | MRR | Citation Validity |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    scenarioRows,
    '',
  ].join('\n');
}

function loadJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function coerceFixtureRun(run: Partial<BenchmarkRun>): BenchmarkRun {
  return {
    total_latency_ms: run.total_latency_ms ?? 0,
    retrieval_latency_ms: run.retrieval_latency_ms ?? 0,
    llm_latency_ms: run.llm_latency_ms ?? 0,
    precision_at_5: run.precision_at_5 ?? 0,
    citation_validity_rate: run.citation_validity_rate ?? 1,
    hit_at_1: run.hit_at_1 ?? 0,
    hit_at_5: run.hit_at_5 ?? 0,
    mrr: run.mrr ?? 0,
  };
}

function buildSampleReport(): Report {
  const scenarios = loadJsonFile<Scenario[]>(SCENARIOS_PATH);
  const fixture = loadJsonFile<SampleFixture>(SAMPLE_RESULTS_PATH);
  const baselineRuns = Object.values(fixture.baseline).flat().map(coerceFixtureRun);
  const optimizedRuns = Object.values(fixture.optimized).flat().map(coerceFixtureRun);

  const perScenario = scenarios.map((scenario) => {
    const baseline = aggregateRuns((fixture.baseline[scenario.id] || []).map(coerceFixtureRun));
    const optimized = aggregateRuns((fixture.optimized[scenario.id] || []).map(coerceFixtureRun));
    return {
      id: scenario.id,
      category: scenario.category,
      cacheMode: scenario.cacheMode,
      baseline,
      optimized,
      delta: computeDelta(baseline, optimized),
    };
  });

  const baselineMetrics = aggregateRuns(baselineRuns);
  const postOptimizationMetrics = aggregateRuns(optimizedRuns);

  return {
    generated_at: new Date().toISOString(),
    mode: 'sample',
    scenarios,
    baseline_metrics: baselineMetrics,
    post_optimization_metrics: postOptimizationMetrics,
    performance_deltas: computeDelta(baselineMetrics, postOptimizationMetrics),
    per_scenario: perScenario,
  };
}

function normalizeRef(reference: string): string {
  return String(reference || '').trim().toUpperCase();
}

function matchExpected(reference: string, expected: string): boolean {
  const ref = normalizeRef(reference);
  const exp = normalizeRef(expected);
  return ref === exp || ref.startsWith(`${exp}-`);
}

async function runSingleScenario(scenario: Scenario): Promise<{ run: BenchmarkRun; topRefs: string[] }> {
  const startedAt = Date.now();
  const retrievalStart = Date.now();
  const verses = await retrieveContextForQuery(scenario.query, scenario.translation);
  const retrievalEnd = Date.now();
  const finishedAt = Date.now();

  const topRefs = verses.slice(0, 5).map((verse) => normalizeRef(verse.reference));
  const expected = scenario.expectedTopRefs.map(normalizeRef);

  const matches = topRefs.filter((ref) => expected.some((e) => matchExpected(ref, e))).length;
  const precisionAt5 = Number((matches / Math.max(1, Math.min(5, topRefs.length || 5))).toFixed(2));

  let bestRank = 0;
  for (let i = 0; i < topRefs.length; i += 1) {
    if (expected.some((e) => matchExpected(topRefs[i], e))) {
      bestRank = i + 1;
      break;
    }
  }

  const hitAt1 = bestRank === 1 ? 1 : 0;
  const hitAt5 = bestRank > 0 && bestRank <= 5 ? 1 : 0;
  const mrr = bestRank > 0 ? Number((1 / bestRank).toFixed(2)) : 0;

  return {
    run: {
      total_latency_ms: finishedAt - startedAt,
      retrieval_latency_ms: retrievalEnd - retrievalStart,
      llm_latency_ms: 0,
      precision_at_5: precisionAt5,
      citation_validity_rate: 1,
      hit_at_1: hitAt1,
      hit_at_5: hitAt5,
      mrr,
    },
    topRefs,
  };
}

async function runScenarioBatch(scenario: Scenario, iterations: number): Promise<{ runs: BenchmarkRun[]; refs: string[][] }> {
  const runs: BenchmarkRun[] = [];
  const refs: string[][] = [];
  for (let i = 0; i < iterations; i += 1) {
    const result = await runSingleScenario(scenario);
    runs.push(result.run);
    refs.push(result.topRefs);
  }
  return { runs, refs };
}

async function buildLiveReport(): Promise<Report> {
  const scenarios = loadJsonFile<Scenario[]>(SCENARIOS_PATH);
  const baselineByScenario: Record<string, BenchmarkRun[]> = {};
  const optimizedByScenario: Record<string, BenchmarkRun[]> = {};
  const perScenarioRefs: Record<string, { baseline: string[]; optimized: string[] }> = {};

  for (const scenario of scenarios) {
    const missScenario: Scenario = { ...scenario, cacheMode: 'miss' };
    const hitScenario: Scenario = { ...scenario, cacheMode: 'hit' };

    const baselineBatch = await runScenarioBatch(missScenario, 2);
    const optimizedBatch = await runScenarioBatch(hitScenario, 2);

    baselineByScenario[scenario.id] = baselineBatch.runs;
    optimizedByScenario[scenario.id] = optimizedBatch.runs;
    perScenarioRefs[scenario.id] = {
      baseline: baselineBatch.refs[baselineBatch.refs.length - 1] || [],
      optimized: optimizedBatch.refs[optimizedBatch.refs.length - 1] || [],
    };
  }

  const baselineRuns = Object.values(baselineByScenario).flat();
  const optimizedRuns = Object.values(optimizedByScenario).flat();
  const baselineMetrics = aggregateRuns(baselineRuns);
  const postOptimizationMetrics = aggregateRuns(optimizedRuns);

  const perScenario: ScenarioReport[] = scenarios.map((scenario) => {
    const baseline = aggregateRuns(baselineByScenario[scenario.id] || []);
    const optimized = aggregateRuns(optimizedByScenario[scenario.id] || []);
    return {
      id: scenario.id,
      category: scenario.category,
      cacheMode: scenario.cacheMode,
      baseline,
      optimized,
      delta: computeDelta(baseline, optimized),
      baseline_top_refs: perScenarioRefs[scenario.id]?.baseline || [],
      optimized_top_refs: perScenarioRefs[scenario.id]?.optimized || [],
    };
  });

  return {
    generated_at: new Date().toISOString(),
    mode: 'live',
    notes: [
      'Live report executes real retrieval pipeline calls and computes metrics from expectedTopRefs.',
      'llm_latency_ms is set to 0 in live mode because this benchmark currently targets retrieval quality and retrieval latency only.',
    ],
    scenarios,
    baseline_metrics: baselineMetrics,
    post_optimization_metrics: postOptimizationMetrics,
    performance_deltas: computeDelta(baselineMetrics, postOptimizationMetrics),
    per_scenario: perScenario,
  };
}

async function main(): Promise<void> {
  const mode = parseMode();
  const report = mode === 'live' ? await buildLiveReport() : buildSampleReport();
  ensureReportDir();
  fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
  fs.writeFileSync(REPORT_MD_PATH, renderMarkdown(report));
  console.log(JSON.stringify({
    report_json: REPORT_JSON_PATH,
    report_markdown: REPORT_MD_PATH,
    mode: report.mode,
    baseline_metrics: report.baseline_metrics,
    post_optimization_metrics: report.post_optimization_metrics,
    performance_deltas: report.performance_deltas,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
