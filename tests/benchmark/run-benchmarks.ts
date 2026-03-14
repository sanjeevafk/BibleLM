import fs from 'fs';
import path from 'path';

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
};

type Report = {
  generated_at: string;
  mode: 'sample' | 'live';
  notes?: string[];
  scenarios: Scenario[];
  baseline_metrics: AggregateMetrics;
  post_optimization_metrics: AggregateMetrics;
  performance_deltas: AggregateMetrics;
  per_scenario: Array<{
    id: string;
    category: string;
    cacheMode: 'hit' | 'miss';
    baseline: AggregateMetrics;
    optimized: AggregateMetrics;
    delta: AggregateMetrics;
  }>;
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
  };
}

function ensureReportDir(): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function renderMarkdown(report: Report): string {
  const scenarioRows = report.per_scenario
    .map((scenario) =>
      `| ${scenario.id} | ${scenario.category} | ${scenario.cacheMode} | ${scenario.baseline.total_latency_ms} | ${scenario.optimized.total_latency_ms} | ${scenario.delta.total_latency_ms} | ${scenario.optimized.precision_at_5} | ${scenario.optimized.citation_validity_rate} |`
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
    '',
    '## Scenario Breakdown',
    '',
    '| Scenario | Category | Cache | Baseline Total | Optimized Total | Delta | Precision@5 | Citation Validity |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    scenarioRows,
    '',
  ].join('\n');
}

function loadJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function buildSampleReport(): Report {
  const scenarios = loadJsonFile<Scenario[]>(SCENARIOS_PATH);
  const fixture = loadJsonFile<SampleFixture>(SAMPLE_RESULTS_PATH);
  const baselineRuns = Object.values(fixture.baseline).flat();
  const optimizedRuns = Object.values(fixture.optimized).flat();

  const perScenario = scenarios.map((scenario) => {
    const baseline = aggregateRuns(fixture.baseline[scenario.id] || []);
    const optimized = aggregateRuns(fixture.optimized[scenario.id] || []);
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

async function buildLiveReport(): Promise<Report> {
  const sampleReport = buildSampleReport();
  return {
    ...sampleReport,
    mode: 'live',
    notes: [
      'Live benchmark fallback was used because no production-like benchmark environment is configured in this repo-local run.',
      'Run with environment-backed retrieval and LLM credentials to replace this fallback with real live measurements.',
    ],
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
