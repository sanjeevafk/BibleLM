import fs from 'fs';
import path from 'path';
import { buildDatasetMetadata } from './dataset-utils';

type Cluster = {
  clusterId: string;
  clusterLabel: string;
  memberVerseIds: string[];
  voteTotal: number;
};

type ParsedRef = { book: string; chapter: number; verse: number };

const ROOT = process.cwd();
const TSK_INPUT = process.env.TSK_PATH || path.join(ROOT, 'datasets', 'cross_references.txt');
const VERSE_TOPICS_PATH = path.join(ROOT, 'data', 'verse-topics.json');
const OUTPUT_CLUSTERS = path.join(ROOT, 'data', 'tsk-clusters.json');
const OUTPUT_CLUSTER_INDEX = path.join(ROOT, 'data', 'cluster-verse-index.json');

function parseRef(ref: string): ParsedRef | null {
  const match = ref.trim().toUpperCase().match(/^([1-3]?[A-Z]+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    book: match[1],
    chapter: Number.parseInt(match[2], 10),
    verse: Number.parseInt(match[3], 10),
  };
}

function toVerseId(ref: ParsedRef): string {
  return `${ref.book} ${ref.chapter}:${ref.verse}`;
}

function normalizeEdgeNode(raw: string): string[] {
  const [startRaw, endRaw] = raw.split('-').map((p) => p.trim());
  const start = parseRef(startRaw);
  if (!start) return [];
  if (!endRaw) return [toVerseId(start)];
  const end = parseRef(endRaw);
  if (!end) return [toVerseId(start)];
  if (start.book !== end.book || start.chapter !== end.chapter || end.verse < start.verse) {
    return [toVerseId(start), toVerseId(end)];
  }
  const out: string[] = [];
  for (let verse = start.verse; verse <= end.verse; verse += 1) {
    out.push(`${start.book} ${start.chapter}:${verse}`);
  }
  return out;
}

function unionFind(nodes: string[]): {
  find: (x: string) => string;
  union: (a: string, b: string) => void;
} {
  const parent = new Map(nodes.map((n) => [n, n]));
  const rank = new Map(nodes.map((n) => [n, 0]));

  function find(x: string): string {
    let node = parent.get(x) ?? x;
    while (node !== (parent.get(node) ?? node)) {
      node = parent.get(node) ?? node;
    }
    let cur = x;
    while (cur !== node) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, node);
      cur = next;
    }
    return node;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const rankA = rank.get(rootA) ?? 0;
    const rankB = rank.get(rootB) ?? 0;
    if (rankA < rankB) {
      parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootB, rootA);
      rank.set(rootA, rankA + 1);
    }
  }

  return { find, union };
}

function mostFrequentTopic(memberVerseIds: string[]): string {
  const verseTopics = JSON.parse(fs.readFileSync(VERSE_TOPICS_PATH, 'utf8')) as {
    items: Array<{ verseId: string; topics: Array<{ id: string; confidence: number }> }>;
  };
  const map = new Map(verseTopics.items.map((item) => [item.verseId.toUpperCase(), item.topics]));
  const counts = new Map<string, number>();
  for (const verseId of memberVerseIds) {
    for (const topic of map.get(verseId.toUpperCase()) ?? []) {
      counts.set(topic.id, (counts.get(topic.id) ?? 0) + 1);
    }
  }
  const entries = Array.from(counts.entries()).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  return entries[0]?.[0] ?? 'general';
}

function main(): void {
  if (!fs.existsSync(TSK_INPUT)) {
    throw new Error(`TSK source file not found: ${TSK_INPUT}`);
  }

  const lines = fs.readFileSync(TSK_INPUT, 'utf8').split(/\r?\n/);
  const edges: Array<{ a: string; b: string; votes: number }> = [];
  const nodes = new Set<string>();

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const [sourceRaw, targetRaw, votesRaw] = line.split('\t');
    if (!sourceRaw || !targetRaw) continue;
    const votes = Number.parseInt(votesRaw || '0', 10);
    if (!Number.isFinite(votes) || votes <= 10) continue;

    const sourceRefs = normalizeEdgeNode(sourceRaw);
    const targetRefs = normalizeEdgeNode(targetRaw);
    for (const a of sourceRefs) {
      for (const b of targetRefs) {
        if (!a || !b || a === b) continue;
        edges.push({ a, b, votes });
        nodes.add(a);
        nodes.add(b);
      }
    }
  }

  const nodeList = Array.from(nodes).sort((a, b) => a.localeCompare(b));
  const uf = unionFind(nodeList);
  for (const edge of edges) {
    uf.union(edge.a, edge.b);
  }

  const clustersByRoot = new Map<string, Set<string>>();
  for (const node of nodeList) {
    const root = uf.find(node);
    if (!clustersByRoot.has(root)) clustersByRoot.set(root, new Set());
    clustersByRoot.get(root)!.add(node);
  }

  const edgeVoteByCluster = new Map<string, number>();
  for (const edge of edges) {
    const root = uf.find(edge.a);
    edgeVoteByCluster.set(root, (edgeVoteByCluster.get(root) ?? 0) + edge.votes);
  }

  const clusters: Cluster[] = [];
  let idx = 1;
  for (const [root, members] of Array.from(clustersByRoot.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const memberVerseIds = Array.from(members).sort((a, b) => a.localeCompare(b));
    if (memberVerseIds.length === 0) continue;
    const clusterLabel = mostFrequentTopic(memberVerseIds);
    clusters.push({
      clusterId: `cluster-${clusterLabel}-${String(idx).padStart(2, '0')}`,
      clusterLabel,
      memberVerseIds,
      voteTotal: edgeVoteByCluster.get(root) ?? 0,
    });
    idx += 1;
  }

  const cleaned = clusters
    .map((cluster) => ({
      ...cluster,
      memberVerseIds: Array.from(new Set(cluster.memberVerseIds)).sort((a, b) => a.localeCompare(b)),
    }))
    .filter((cluster) => cluster.memberVerseIds.length > 0)
    .sort((a, b) => a.clusterId.localeCompare(b.clusterId));

  const clusterVerseIndex: Record<string, string[]> = {};
  for (const cluster of cleaned) {
    clusterVerseIndex[cluster.clusterId] = cluster.memberVerseIds;
  }

  fs.writeFileSync(
    OUTPUT_CLUSTERS,
    JSON.stringify({ ...buildDatasetMetadata('scripts/build-tsk-clusters.ts'), items: cleaned }, null, 2)
  );
  fs.writeFileSync(
    OUTPUT_CLUSTER_INDEX,
    JSON.stringify({ ...buildDatasetMetadata('scripts/build-tsk-clusters.ts'), items: clusterVerseIndex }, null, 2)
  );

  console.log(JSON.stringify({ output_clusters: OUTPUT_CLUSTERS, output_index: OUTPUT_CLUSTER_INDEX, count: cleaned.length }, null, 2));
}

main();
