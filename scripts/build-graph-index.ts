import * as fs from 'fs';
import * as path from 'path';

type GraphNode = { id: string; kind: 'verse' | 'topic' };
type GraphEdge = { from: string; to: string; weight: number; kind: 'tsk' | 'topic' | 'cluster' };
type GraphIndex = {
  version: string;
  nodes: GraphNode[];
  adjacency: Record<string, Array<{ id: string; weight: number; kind: string }>>;
  metadata: { sourceFiles: string[]; totalEdges: number };
};

const DATA_DIR = path.resolve(__dirname, '../data');
const OUT_FILE = path.resolve(DATA_DIR, 'graph-index.json');

const tskFile = path.resolve(DATA_DIR, 'tsk-clusters.json');
const verseTopicsFile = path.resolve(DATA_DIR, 'verse-topics.json');
const topicVerseFile = path.resolve(DATA_DIR, 'topic-verse-index.json');

const nodes = new Map<string, GraphNode>();
const adj = new Map<string, Map<string, { weight: number; kind: string }>>();

function addNode(id: string, kind: 'verse' | 'topic') {
  if (!nodes.has(id)) {
    nodes.set(id, { id, kind });
  }
}

function addEdge(from: string, to: string, weight: number, kind: string) {
  if (!adj.has(from)) adj.set(from, new Map());
  const neighbors = adj.get(from)!;
  if (!neighbors.has(to) || neighbors.get(to)!.weight < weight) {
    neighbors.set(to, { weight, kind });
  }
}

// 1. Parse tsk-clusters.json — hub-and-spoke model
// Each cluster becomes a virtual 'cluster' node; member verses connect to it.
// This avoids O(n²) all-pairs edges that OOM on large clusters.
console.log('Parsing tsk-clusters.json...');
if (fs.existsSync(tskFile)) {
  const data = JSON.parse(fs.readFileSync(tskFile, 'utf8'));
  let clustersParsed = 0;
  for (const item of data.items || []) {
    const verses = (item.memberVerseIds || []).map((v: string) => v.toUpperCase());
    if (verses.length === 0) continue;

    const hubId = `cluster:${item.clusterId}`;
    addNode(hubId, 'topic'); // virtual cluster hub treated as topic-like node

    // Edge weight: inverse of cluster size, capped at 1.0
    const weight = Math.min(1.0, 1 / Math.sqrt(verses.length));

    for (const v of verses) {
      addNode(v, 'verse');
      addEdge(v, hubId, weight, 'cluster');
      addEdge(hubId, v, weight, 'cluster');
    }
    clustersParsed++;
  }
  console.log(`Parsed ${clustersParsed} clusters (hub-and-spoke, ${clustersParsed} virtual hubs)`);
} else {
  console.log(`Warning: ${tskFile} not found`);
}

// 2. Parse verse-topics.json
console.log('Parsing verse-topics.json...');
if (fs.existsSync(verseTopicsFile)) {
  const data = JSON.parse(fs.readFileSync(verseTopicsFile, 'utf8'));
  let mappingsParsed = 0;
  for (const item of data.items || []) {
    const verseId = item.verseId.toUpperCase();
    addNode(verseId, 'verse');
    
    for (const t of item.topics || []) {
      const topicId = t.id;
      const weight = t.confidence ?? 1.0;
      addNode(topicId, 'topic');
      addEdge(verseId, topicId, weight, 'topic');
      addEdge(topicId, verseId, weight, 'topic');
      mappingsParsed++;
    }
  }
  console.log(`Parsed ${mappingsParsed} verse-topic mappings`);
} else {
  console.log(`Warning: ${verseTopicsFile} not found`);
}

// 3. Parse topic-verse-index.json
console.log('Parsing topic-verse-index.json...');
if (fs.existsSync(topicVerseFile)) {
  const data = JSON.parse(fs.readFileSync(topicVerseFile, 'utf8'));
  let mappingsParsed = 0;
  for (const [topicId, verses] of Object.entries(data.items || {})) {
    addNode(topicId, 'topic');
    for (const v of (verses as string[])) {
      const verseId = v.toUpperCase();
      addNode(verseId, 'verse');
      
      const topicAdj = adj.get(topicId);
      if (!topicAdj || !topicAdj.has(verseId)) {
        addEdge(topicId, verseId, 0.5, 'topic');
        addEdge(verseId, topicId, 0.5, 'topic');
        mappingsParsed++;
      }
    }
  }
  console.log(`Parsed ${mappingsParsed} additional topic-verse mappings`);
} else {
  console.log(`Warning: ${topicVerseFile} not found`);
}

// 4. Prune adjacency list to top 20 neighbors by weight descending
console.log('Pruning graph and preparing output...');
const adjacency: Record<string, Array<{ id: string; weight: number; kind: string }>> = {};
let totalEdges = 0;

for (const [nodeId, neighborsMap] of adj.entries()) {
  const neighborsList = Array.from(neighborsMap.entries()).map(([id, info]) => ({
    id,
    weight: info.weight,
    kind: info.kind
  }));
  
  // Sort descending by weight
  neighborsList.sort((a, b) => b.weight - a.weight);
  
  // Top 20
  const top20 = neighborsList.slice(0, 20);
  adjacency[nodeId] = top20;
  totalEdges += top20.length;
}

const graphIndex: GraphIndex = {
  version: new Date().toISOString(),
  nodes: Array.from(nodes.values()),
  adjacency,
  metadata: {
    sourceFiles: ['tsk-clusters.json', 'verse-topics.json', 'topic-verse-index.json'],
    totalEdges
  }
};

// 5. Write output
fs.writeFileSync(OUT_FILE, JSON.stringify(graphIndex, null, 2), 'utf8');
console.log(`Wrote graph-index.json with ${nodes.size} nodes, ${totalEdges} edges`);
