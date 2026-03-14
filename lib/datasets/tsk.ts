import { loadDataset, resolveDatasetPath } from './base';

export type TskCrossReference = {
  reference: string;
  votes: number | null;
};

type VerseRef = {
  book: string;
  chapter: number;
  verse: number;
};

const TSK_PATH = resolveDatasetPath('datasets', 'cross_references.txt');

const BOOK_MAP: Record<string, string> = {
  genesis: 'GEN',
  gen: 'GEN',
  exodus: 'EXO',
  exod: 'EXO',
  exo: 'EXO',
  leviticus: 'LEV',
  lev: 'LEV',
  numbers: 'NUM',
  num: 'NUM',
  deuteronomy: 'DEU',
  deut: 'DEU',
  deuter: 'DEU',
  joshua: 'JOS',
  josh: 'JOS',
  jos: 'JOS',
  judges: 'JDG',
  judg: 'JDG',
  jdg: 'JDG',
  ruth: 'RUT',
  rut: 'RUT',
  '1samuel': '1SA',
  '1sam': '1SA',
  '1sa': '1SA',
  '2samuel': '2SA',
  '2sam': '2SA',
  '2sa': '2SA',
  '1kings': '1KI',
  '1kgs': '1KI',
  '1ki': '1KI',
  '2kings': '2KI',
  '2kgs': '2KI',
  '2ki': '2KI',
  '1chronicles': '1CH',
  '1chr': '1CH',
  '1ch': '1CH',
  '2chronicles': '2CH',
  '2chr': '2CH',
  '2ch': '2CH',
  ezra: 'EZR',
  ezr: 'EZR',
  nehemiah: 'NEH',
  neh: 'NEH',
  esther: 'EST',
  esth: 'EST',
  est: 'EST',
  job: 'JOB',
  psalms: 'PSA',
  psalm: 'PSA',
  ps: 'PSA',
  psa: 'PSA',
  proverbs: 'PRO',
  prov: 'PRO',
  pro: 'PRO',
  ecclesiastes: 'ECC',
  eccl: 'ECC',
  ecc: 'ECC',
  songofsongs: 'SNG',
  songofsolomon: 'SNG',
  song: 'SNG',
  canticles: 'SNG',
  cant: 'SNG',
  isaiah: 'ISA',
  isa: 'ISA',
  jeremiah: 'JER',
  jer: 'JER',
  lamentations: 'LAM',
  lam: 'LAM',
  ezekiel: 'EZK',
  ezek: 'EZK',
  ezk: 'EZK',
  daniel: 'DAN',
  dan: 'DAN',
  hosea: 'HOS',
  hos: 'HOS',
  joel: 'JOL',
  jol: 'JOL',
  amos: 'AMO',
  amo: 'AMO',
  obadiah: 'OBA',
  obad: 'OBA',
  oba: 'OBA',
  jonah: 'JON',
  jon: 'JON',
  micah: 'MIC',
  mic: 'MIC',
  nahum: 'NAM',
  nah: 'NAM',
  habakkuk: 'HAB',
  hab: 'HAB',
  zephaniah: 'ZEP',
  zeph: 'ZEP',
  zep: 'ZEP',
  haggai: 'HAG',
  hag: 'HAG',
  zechariah: 'ZEC',
  zech: 'ZEC',
  zec: 'ZEC',
  malachi: 'MAL',
  mal: 'MAL',
  matthew: 'MAT',
  matt: 'MAT',
  mat: 'MAT',
  mark: 'MRK',
  mrk: 'MRK',
  luke: 'LUK',
  luk: 'LUK',
  john: 'JHN',
  jhn: 'JHN',
  acts: 'ACT',
  act: 'ACT',
  romans: 'ROM',
  rom: 'ROM',
  '1corinthians': '1CO',
  '1cor': '1CO',
  '1co': '1CO',
  '2corinthians': '2CO',
  '2cor': '2CO',
  '2co': '2CO',
  galatians: 'GAL',
  gal: 'GAL',
  ephesians: 'EPH',
  eph: 'EPH',
  philippians: 'PHP',
  phil: 'PHP',
  php: 'PHP',
  colossians: 'COL',
  col: 'COL',
  '1thessalonians': '1TH',
  '1thess': '1TH',
  '1th': '1TH',
  '2thessalonians': '2TH',
  '2thess': '2TH',
  '2th': '2TH',
  '1timothy': '1TI',
  '1tim': '1TI',
  '1ti': '1TI',
  '2timothy': '2TI',
  '2tim': '2TI',
  '2ti': '2TI',
  titus: 'TIT',
  tit: 'TIT',
  philemon: 'PHM',
  philem: 'PHM',
  phlm: 'PHM',
  phm: 'PHM',
  hebrews: 'HEB',
  heb: 'HEB',
  james: 'JAS',
  jas: 'JAS',
  '1peter': '1PE',
  '1pet': '1PE',
  '1pe': '1PE',
  '2peter': '2PE',
  '2pet': '2PE',
  '2pe': '2PE',
  '1john': '1JN',
  '1jn': '1JN',
  '2john': '2JN',
  '2jn': '2JN',
  '3john': '3JN',
  '3jn': '3JN',
  jude: 'JUD',
  jud: 'JUD',
  revelation: 'REV',
  rev: 'REV',
};

function normalizeBook(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const mapped = BOOK_MAP[cleaned];
  if (!mapped) {
    throw new Error(`Unknown TSK book token: ${raw}`);
  }
  return mapped;
}

function parseReference(ref: string): VerseRef {
  const match = ref.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid TSK reference: ${ref}`);
  }

  return {
    book: normalizeBook(match[1]),
    chapter: Number.parseInt(match[2], 10),
    verse: Number.parseInt(match[3], 10),
  };
}

function parseRange(ref: string): VerseRef[] {
  if (!ref.includes('-')) {
    return [parseReference(ref)];
  }

  const [startRaw, endRaw] = ref.split('-');
  const start = parseReference(startRaw);
  const end = parseReference(endRaw);

  if (start.book !== end.book || start.chapter !== end.chapter) {
    return [start, end];
  }

  const out: VerseRef[] = [];
  for (let verse = start.verse; verse <= end.verse; verse += 1) {
    out.push({ book: start.book, chapter: start.chapter, verse });
  }

  return out;
}

function toReferenceKey(ref: VerseRef): string {
  return `${ref.book} ${ref.chapter}:${ref.verse}`;
}

async function loadTskIndex(): Promise<Map<string, TskCrossReference[]>> {
  const parsed = await loadDataset<Map<string, TskCrossReference[]>>(
    'tsk:cross-references',
    [TSK_PATH],
    (raw) => {
      const map = new Map<string, TskCrossReference[]>();
      const lines = raw.split(/\r?\n/);

      for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim()) {
          continue;
        }

        const parts = line.split('\t');
        if (parts.length < 2) {
          continue;
        }

        let fromRefs: VerseRef[];
        let toRefs: VerseRef[];
        try {
          fromRefs = parseRange(parts[0]);
          toRefs = parseRange(parts[1]);
        } catch {
          continue;
        }

        const votes = parts.length >= 3 ? Number.parseInt(parts[2], 10) : null;
        const normalizedVotes = Number.isNaN(votes) ? null : votes;

        for (const source of fromRefs) {
          const sourceKey = toReferenceKey(source);
          const current = map.get(sourceKey) || [];
          for (const target of toRefs) {
            current.push({
              reference: toReferenceKey(target),
              votes: normalizedVotes,
            });
          }
          map.set(sourceKey, current);
        }
      }

      return map;
    }
  );

  return parsed || new Map<string, TskCrossReference[]>();
}

export async function getCrossReferences(reference: string): Promise<TskCrossReference[]> {
  const normalized = reference.trim().toUpperCase();
  if (!normalized) {
    return [];
  }

  const index = await loadTskIndex();
  const raw = index.get(normalized) || [];
  const deduped = new Map<string, TskCrossReference>();

  for (const entry of raw) {
    const current = deduped.get(entry.reference);
    if (!current || (entry.votes ?? Number.NEGATIVE_INFINITY) > (current.votes ?? Number.NEGATIVE_INFINITY)) {
      deduped.set(entry.reference, entry);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => (right.votes ?? 0) - (left.votes ?? 0));
}
