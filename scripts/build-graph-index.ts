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

const tskRawFile = path.resolve(__dirname, '../datasets/cross_references.txt');
const tskClustersFile = path.resolve(DATA_DIR, 'tsk-clusters.json');
const verseTopicsFile = path.resolve(DATA_DIR, 'verse-topics.json');
const topicVerseFile = path.resolve(DATA_DIR, 'topic-verse-index.json');

const BOOK_MAP: Record<string, string> = {
  genesis: 'GEN', gen: 'GEN',
  exodus: 'EXO', exod: 'EXO', exo: 'EXO',
  leviticus: 'LEV', lev: 'LEV',
  numbers: 'NUM', num: 'NUM',
  deuteronomy: 'DEU', deut: 'DEU', deuter: 'DEU',
  joshua: 'JOS', josh: 'JOS', jos: 'JOS',
  judges: 'JDG', judg: 'JDG', jdg: 'JDG',
  ruth: 'RUT', rut: 'RUT',
  '1samuel': '1SA', '1sam': '1SA', '1sa': '1SA',
  '2samuel': '2SA', '2sam': '2SA', '2sa': '2SA',
  '1kings': '1KI', '1kgs': '1KI', '1ki': '1KI',
  '2kings': '2KI', '2kgs': '2KI', '2ki': '2KI',
  '1chronicles': '1CH', '1chr': '1CH', '1ch': '1CH',
  '2chronicles': '2CH', '2chr': '2CH', '2ch': '2CH',
  ezra: 'EZR', ezr: 'EZR',
  nehemiah: 'NEH', neh: 'NEH',
  esther: 'EST', esth: 'EST', est: 'EST',
  job: 'JOB',
  psalms: 'PSA', psalm: 'PSA', ps: 'PSA', psa: 'PSA',
  proverbs: 'PRO', prov: 'PRO', pro: 'PRO',
  ecclesiastes: 'ECC', eccl: 'ECC', ecc: 'ECC',
  songofsongs: 'SNG', songofsolomon: 'SNG', song: 'SNG', canticles: 'SNG', cant: 'SNG',
  isaiah: 'ISA', isa: 'ISA',
  jeremiah: 'JER', jer: 'JER',
  lamentations: 'LAM', lam: 'LAM',
  ezekiel: 'EZK', ezek: 'EZK', ezk: 'EZK',
  daniel: 'DAN', dan: 'DAN',
  hosea: 'HOS', hos: 'HOS',
  joel: 'JOL', jol: 'JOL',
  amos: 'AMO', amo: 'AMO',
  obadiah: 'OBA', obad: 'OBA', oba: 'OBA',
  jonah: 'JON', jon: 'JON',
  micah: 'MIC', mic: 'MIC',
  nahum: 'NAM', nah: 'NAM',
  habakkuk: 'HAB', hab: 'HAB',
  zephaniah: 'ZEP', zeph: 'ZEP', zep: 'ZEP',
  haggai: 'HAG', hag: 'HAG',
  zechariah: 'ZEC', zech: 'ZEC', zec: 'ZEC',
  malachi: 'MAL', mal: 'MAL',
  matthew: 'MAT', matt: 'MAT', mat: 'MAT',
  mark: 'MRK', mrk: 'MRK',
  luke: 'LUK', luk: 'LUK',
  john: 'JHN', jhn: 'JHN',
  acts: 'ACT', act: 'ACT',
  romans: 'ROM', rom: 'ROM',
  '1corinthians': '1CO', '1cor': '1CO', '1co': '1CO',
  '2corinthians': '2CO', '2cor': '2CO', '2co': '2CO',
  galatians: 'GAL', gal: 'GAL',
  ephesians: 'EPH', eph: 'EPH',
  philippians: 'PHP', phil: 'PHP', php: 'PHP',
  colossians: 'COL', col: 'COL',
  '1thessalonians': '1TH', '1thess': '1TH', '1th': '1TH',
  '2thessalonians': '2TH', '2thess': '2TH', '2th': '2TH',
  '1timothy': '1TI', '1tim': '1TI', '1ti': '1TI',
  '2timothy': '2TI', '2tim': '2TI', '2ti': '2TI',
  titus: 'TIT', tit: 'TIT',
  philemon: 'PHM', phlm: 'PHM', phm: 'PHM',
  hebrews: 'HEB', heb: 'HEB',
  james: 'JAS', jas: 'JAS',
  '1peter': '1PE', '1pet': '1PE', '1pe': '1PE',
  '2peter': '2PE', '2pet': '2PE', '2pe': '2PE',
  '1john': '1JN', '1jn': '1JN',
  '2john': '2JN', '2jn': '2JN',
  '3john': '3JN', '3jn': '3JN',
  jude: 'JUD', jud: 'JUD',
  revelation: 'REV', rev: 'REV',
};

function normalizeBook(raw: string): string | null {
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return BOOK_MAP[cleaned] ?? null;
}

function normalizeVerseId(raw: string): string | null {
  const trimmed = raw.trim();
  // Handle Gen.1.1 format
  const dotMatch = trimmed.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/);
  if (dotMatch) {
    const book = normalizeBook(dotMatch[1]);
    if (!book) return null;
    return `${book} ${dotMatch[2]}:${dotMatch[3]}`;
  }
  // Handle DEUT 22:21 format
  const spaceMatch = trimmed.match(/^([1-3]?[A-Za-z]+)\s+(\d+):(\d+)$/);
  if (spaceMatch) {
    const book = normalizeBook(spaceMatch[1]);
    if (!book) return null;
    return `${book} ${spaceMatch[2]}:${spaceMatch[3]}`;
  }
  return null;
}

const nodes = new Map<string, GraphNode>();
const adj = new Map<string, Map<string, { weight: number; kind: string }>>();

function addNode(id: string, kind: 'verse' | 'topic') {
  if (!nodes.has(id)) {
    nodes.set(id, { id, kind });
  }
}

function addEdge(from: string, to: string, weight: number, kind: string) {
  if (from === to) return;
  if (!adj.has(from)) adj.set(from, new Map());
  const neighbors = adj.get(from)!;
  const existing = neighbors.get(to);
  if (!existing || existing.weight < weight) {
    neighbors.set(to, { weight, kind });
  }
}

// 1. Parse datasets/cross_references.txt (Canonical TSK direct cross-references)
console.log('Parsing datasets/cross_references.txt (344k TSK references)...');
if (fs.existsSync(tskRawFile)) {
  const rawContent = fs.readFileSync(tskRawFile, 'utf8');
  const lines = rawContent.split(/\r?\n/);
  let tskEdgesAdded = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;

    // Handle range e.g. Ps.89.11-Ps.89.12 or single Gen.1.1
    const fromId = normalizeVerseId(parts[0].split('-')[0]);
    const toId = normalizeVerseId(parts[1].split('-')[0]);
    if (!fromId || !toId) continue;

    const votes = parts.length >= 3 ? Number.parseInt(parts[2], 10) : 50;
    // Normalize votes: range typically -50 to 200+. Map to 0.2 - 0.95
    const voteWeight = Math.min(0.95, Math.max(0.2, (Number.isNaN(votes) ? 50 : votes) / 150));

    addNode(fromId, 'verse');
    addNode(toId, 'verse');
    addEdge(fromId, toId, voteWeight, 'tsk');
    addEdge(toId, fromId, voteWeight, 'tsk');
    tskEdgesAdded++;
  }
  console.log(`Parsed ${tskEdgesAdded} TSK cross-reference edges`);
} else {
  console.log(`Warning: ${tskRawFile} not found`);
}

// 2. Parse tsk-clusters.json — hub-and-spoke model with normalized verse IDs
console.log('Parsing tsk-clusters.json...');
if (fs.existsSync(tskClustersFile)) {
  const data = JSON.parse(fs.readFileSync(tskClustersFile, 'utf8'));
  let clustersParsed = 0;
  for (const item of data.items || []) {
    const rawVerses = (item.memberVerseIds || []) as string[];
    const verses: string[] = [];
    for (const raw of rawVerses) {
      const normalized = normalizeVerseId(raw);
      if (normalized) verses.push(normalized);
    }
    if (verses.length === 0) continue;

    const hubId = `cluster:${item.clusterId}`;
    addNode(hubId, 'topic');

    const weight = Math.min(1.0, 1 / Math.sqrt(verses.length));

    for (const v of verses) {
      addNode(v, 'verse');
      addEdge(v, hubId, weight, 'cluster');
      addEdge(hubId, v, weight, 'cluster');
    }
    clustersParsed++;
  }
  console.log(`Parsed ${clustersParsed} clusters (hub-and-spoke)`);
} else {
  console.log(`Warning: ${tskClustersFile} not found`);
}

// 3. Parse verse-topics.json
console.log('Parsing verse-topics.json...');
if (fs.existsSync(verseTopicsFile)) {
  const data = JSON.parse(fs.readFileSync(verseTopicsFile, 'utf8'));
  let mappingsParsed = 0;
  for (const item of data.items || []) {
    const verseId = normalizeVerseId(item.verseId);
    if (!verseId) continue;
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

// 4. Parse topic-verse-index.json
console.log('Parsing topic-verse-index.json...');
if (fs.existsSync(topicVerseFile)) {
  const data = JSON.parse(fs.readFileSync(topicVerseFile, 'utf8'));
  let mappingsParsed = 0;
  for (const [topicId, verses] of Object.entries(data.items || {})) {
    addNode(topicId, 'topic');
    for (const v of (verses as string[])) {
      const verseId = normalizeVerseId(v);
      if (!verseId) continue;
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

// 5. Prune adjacency list to top 20 neighbors by weight descending
console.log('Pruning graph to top-20 neighbors per node...');
const adjacency: Record<string, Array<{ id: string; weight: number; kind: string }>> = {};
let totalEdges = 0;

for (const [nodeId, neighborsMap] of adj.entries()) {
  const neighborsList = Array.from(neighborsMap.entries()).map(([id, info]) => ({
    id,
    weight: Math.round(info.weight * 1000) / 1000,
    kind: info.kind,
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
    sourceFiles: ['datasets/cross_references.txt', 'tsk-clusters.json', 'verse-topics.json', 'topic-verse-index.json'],
    totalEdges,
  },
};

// 6. Write output
fs.writeFileSync(OUT_FILE, JSON.stringify(graphIndex), 'utf8');
console.log(`Wrote graph-index.json with ${nodes.size} nodes, ${totalEdges} edges (${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2)} MB)`);
