import fs from 'fs';
import path from 'path';

type AggregateMetrics = {
  total_latency_ms: number;
  retrieval_latency_ms: number;
  llm_latency_ms: number;
  p50_latency: number;
  p95_latency: number;
  precision_at_5: number;
  citation_validity_rate: number;
  hit_at_1?: number;
  hit_at_5?: number;
  mrr?: number;
};

type Report = {
  baseline_metrics: AggregateMetrics;
  post_optimization_metrics: AggregateMetrics;
  performance_deltas: AggregateMetrics;
};

const DEFAULT_REPORT_PATH = path.resolve(process.cwd(), 'project-docs', 'benchmark', 'latest-report.json');

function parseThreshold(envVarName: string, defaultValue: number): number {
  const rawValue = process.env[envVarName];

  if (rawValue === undefined) {
    return defaultValue;
  }

  const parsedValue = Number.parseFloat(rawValue);
  if (Number.isFinite(parsedValue)) {
    return parsedValue;
  }

  console.warn(
    `Invalid numeric value for ${envVarName}: "${rawValue}". Falling back to default ${defaultValue}.`
  );
  return defaultValue;
}

const MAX_P95_DELTA_MS = parseThreshold('BENCHMARK_MAX_P95_DELTA_MS', 150);
const MAX_TOTAL_DELTA_MS = parseThreshold('BENCHMARK_MAX_TOTAL_DELTA_MS', 150);
const MIN_PRECISION_DELTA = parseThreshold('BENCHMARK_MIN_PRECISION_DELTA', -0.05);
const MIN_CITATION_VALIDITY_RATE = parseThreshold('BENCHMARK_MIN_CITATION_VALIDITY_RATE', 0.99);
const MIN_HIT_AT_5_DELTA = parseThreshold('BENCHMARK_MIN_HIT_AT_5_DELTA', -0.05);
const MIN_MRR_DELTA = parseThreshold('BENCHMARK_MIN_MRR_DELTA', -0.05);

function loadReport(reportPath: string): Report {
  return JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Report;
}

function main(): void {
  const reportPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_REPORT_PATH;
  const report = loadReport(reportPath);
  const failures: string[] = [];

  if (report.performance_deltas.p95_latency > MAX_P95_DELTA_MS) {
    failures.push(`latency regression: p95 delta ${report.performance_deltas.p95_latency}ms exceeds ${MAX_P95_DELTA_MS}ms`);
  }
  if (report.performance_deltas.total_latency_ms > MAX_TOTAL_DELTA_MS) {
    failures.push(`latency regression: total latency delta ${report.performance_deltas.total_latency_ms}ms exceeds ${MAX_TOTAL_DELTA_MS}ms`);
  }
  if (report.performance_deltas.precision_at_5 < MIN_PRECISION_DELTA) {
    failures.push(`retrieval regression: precision@5 delta ${report.performance_deltas.precision_at_5} is below ${MIN_PRECISION_DELTA}`);
  }
  if (report.post_optimization_metrics.citation_validity_rate < MIN_CITATION_VALIDITY_RATE) {
    failures.push(
      `citation grounding failure: citation validity ${report.post_optimization_metrics.citation_validity_rate} is below ${MIN_CITATION_VALIDITY_RATE}`
    );
  }

  const hitAt5Delta = report.performance_deltas.hit_at_5 ?? 0;
  if (hitAt5Delta < MIN_HIT_AT_5_DELTA) {
    failures.push(`retrieval regression: hit@5 delta ${hitAt5Delta} is below ${MIN_HIT_AT_5_DELTA}`);
  }

  const mrrDelta = report.performance_deltas.mrr ?? 0;
  if (mrrDelta < MIN_MRR_DELTA) {
    failures.push(`retrieval regression: MRR delta ${mrrDelta} is below ${MIN_MRR_DELTA}`);
  }

  if (failures.length > 0) {
    failures.forEach((failure) => console.error(failure));
    process.exit(1);
  }

  console.log(JSON.stringify({
    report: reportPath,
    status: 'ok',
    thresholds: {
      MAX_P95_DELTA_MS,
      MAX_TOTAL_DELTA_MS,
      MIN_PRECISION_DELTA,
      MIN_CITATION_VALIDITY_RATE,
      MIN_HIT_AT_5_DELTA,
      MIN_MRR_DELTA,
    },
  }, null, 2));
}

main();
