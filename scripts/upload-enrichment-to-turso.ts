/**
 * upload-enrichment-to-turso — uploads original-language + cross-reference
 * datasets so the edge runtime (no filesystem) reaches parity with local:
 *
 *   strongs        <- data/strongs-dict.json (14k entries)
 *   morph_ot       <- data/morphhb/* per-verse [{t,s,m}]
 *   interlinear_nt <- data/opengnt/* merged [{w,s,m,tr,g}] + dict backfill
 *   openhebrew     <- per-verse preformatted layer strings (OT)
 *   tsk_refs       <- datasets/cross_references.txt aggregated per verse
 *
 * Run: `ts-node --project tsconfig.scripts.json scripts/upload-enrichment-to-turso.ts`
 * Dry run (sizes only, no writes): `DRY_RUN=1 ...`
 * Credentials ONLY from env (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN) —
 * never hardcode tokens in this file.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { createClient, type Client } from '@libsql/client';
import { compactNtChapter, compactOtChapter } from '../lib/study-compact';
import { ENRICHMENT_DDL } from '../lib/datasets/turso-schema';

type StmtArgs = Array<string | number | null>;
type BatchStatement = { sql: string; args: StmtArgs };

const gunzip = promisify(zlib.gunzip);
const brotliDecompress = promisify(zlib.brotliDecompress);

const DRY_RUN = process.env.DRY_RUN === '1';
const ROOT = process.cwd();
const BATCH_SIZE = 500;

const OT_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT',
  '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
  'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
  'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
  'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
]);

// Matches open-hebrew-bible.ts BOOK_CODE_TO_TITLE for resolving data files.
const BOOK_CODE_TO_TITLE: Record<string, string> = {
  GEN: 'Gen', EXO: 'Exo', LEV: 'Lev', NUM: 'Num', DEU: 'Deu',
  JOS: 'Jos', JDG: 'Jdg', RUT: 'Rut', '1SA': '1Sa', '2SA': '2Sa',
  '1KI': '1Ki', '2KI': '2Ki', '1CH': '1Ch', '2CH': '2Ch', EZR: 'Ezr',
  NEH: 'Neh', EST: 'Est', JOB: 'Job', PSA: 'Psa', PRO: 'Pro',
  ECC: 'Ecc', SNG: 'Sng', ISA: 'Isa', JER: 'Jer', LAM: 'Lam',
  EZK: 'Ezk', DAN: 'Dan', HOS: 'Hos', JOL: 'Jol', AMO: 'Amo',
  OBA: 'Oba', JON: 'Jon', MIC: 'Mic', NAM: 'Nam', HAB: 'Hab',
  ZEP: 'Zep', HAG: 'Hag', ZEC: 'Zec', MAL: 'Mal',
};

async function readMaybeCompressed(filePath: string): Promise<string> {
  const raw = await fs.promises.readFile(filePath);
  if (filePath.endsWith('.br')) return (await brotliDecompress(raw)).toString('utf8');
  if (filePath.endsWith('.gz')) return (await gunzip(raw)).toString('utf8');
  return raw.toString('utf8');
}

async function resolveDataFile(basePath: string): Promise<string | null> {
  for (const candidate of [basePath, `${basePath}.br`, `${basePath}.gz`]) {
    try {
      await fs.promises.access(candidate);
      return candidate;
    } catch { /* next */ }
  }
  return null;
}

type BatchClient = Pick<Client, 'batch'>;

async function writeBatches(
  client: BatchClient | null,
  stmts: BatchStatement[],
  label: string
): Promise<number> {
  let written = 0;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    const chunk = stmts.slice(i, i + BATCH_SIZE);
    if (!DRY_RUN && client) await client.batch(chunk, 'write');
    written += chunk.length;
    process.stdout.write(`\r${label}: ${written}/${stmts.length}...`);
  }
  process.stdout.write('\n');
  return written;
}

async function main(): Promise<void> {
  const client = DRY_RUN
    ? null
    : createClient({
      url: process.env.TURSO_DATABASE_URL || '',
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  if (!DRY_RUN && !process.env.TURSO_DATABASE_URL) {
    throw new Error('TURSO_DATABASE_URL is required (never hardcode tokens here)');
  }

  const ddl = ENRICHMENT_DDL;
  if (!DRY_RUN && client) {
    for (const sql of ddl) await client.execute(sql);
  }

  // 1. Strong's dictionary
  const strongsDict = JSON.parse(
    await readMaybeCompressed((await resolveDataFile(path.join(ROOT, 'data', 'strongs-dict.json'))) as string)
  ) as Record<string, { lexeme?: string; transliteration?: string; pronunciation?: string; short_definition?: string; definition?: string }>;
  const strongsStmts: BatchStatement[] = Object.entries(strongsDict)
    .filter(([id]) => /^[HG]\d+$/.test(id.toUpperCase()))
    .map(([id, e]) => ({
      sql: 'INSERT OR REPLACE INTO strongs (id, lexeme, transliteration, pronunciation, short_def) VALUES (?, ?, ?, ?, ?)',
      args: [id.toUpperCase(), e.lexeme || null, e.transliteration || null, e.pronunciation || null, e.short_definition || null],
    }));

  // 2+3. Morphology + interlinear, per verse. Reuses the compact transforms
  // so Turso rows match the static-asset token shape 1:1.
  const morphIndex = JSON.parse(
    await fs.promises.readFile(path.join(ROOT, 'data', 'morphhb-index.json'), 'utf8')
  ) as Record<string, string>;
  const morphStmts: BatchStatement[] = [];
  for (const [book, file] of Object.entries(morphIndex)) {
    if (file.includes('..')) continue;
    const resolved = await resolveDataFile(path.join(ROOT, 'data', 'morphhb', file));
    if (!resolved) continue;
    const morphBook = JSON.parse(await readMaybeCompressed(resolved));
    for (const chapter of Object.keys(morphBook)) {
      const compact = compactOtChapter(morphBook, strongsDict, Number.parseInt(chapter, 10));
      for (const [verse, tokens] of Object.entries(compact.verses)) {
        const minimal = tokens.map((t) => ({ t: t.w, s: t.s, ...(t.m ? { m: t.m } : {}) }));
        morphStmts.push({
          sql: 'INSERT OR REPLACE INTO morph_ot (verse_id, tokens) VALUES (?, ?)',
          args: [`${book} ${chapter}:${verse}`, JSON.stringify(minimal)],
        });
      }
    }
  }

  const opengntIndex = JSON.parse(
    await fs.promises.readFile(path.join(ROOT, 'data', 'opengnt-index.json'), 'utf8')
  ) as Record<string, { morph?: string; interlinear?: string }>;
  const interlinearStmts: BatchStatement[] = [];
  for (const [book, entry] of Object.entries(opengntIndex)) {
    if (OT_BOOKS.has(book) || !entry?.morph) continue;
    const morphPath = await resolveDataFile(path.join(ROOT, 'data', 'opengnt', entry.morph));
    if (!morphPath) continue;
    const morphBook = JSON.parse(await readMaybeCompressed(morphPath));
    let interlinearBook = null;
    if (entry.interlinear) {
      const intPath = await resolveDataFile(path.join(ROOT, 'data', 'opengnt', entry.interlinear));
      if (intPath) interlinearBook = JSON.parse(await readMaybeCompressed(intPath));
    }
    for (const chapter of Object.keys(morphBook)) {
      const compact = compactNtChapter(morphBook, interlinearBook, Number.parseInt(chapter, 10));
      for (const [verse, tokens] of Object.entries(compact.verses)) {
        // Backfill gloss/transliteration from the dictionary (mirrors the
        // edge reader path) so rows are self-sufficient.
        const filled = tokens.map((t) => {
          const out: Record<string, string> = { w: t.w, s: t.s };
          if (t.m) out.m = t.m;
          const dict = strongsDict[t.s] || strongsDict[t.s.toUpperCase()];
          if (t.tr || dict?.transliteration) out.tr = t.tr || dict.transliteration || '';
          if (t.g || dict?.short_definition || dict?.definition) {
            out.g = t.g || dict.short_definition || (dict as { definition?: string }).definition || '';
          }
          return out;
        });
        interlinearStmts.push({
          sql: 'INSERT OR REPLACE INTO interlinear_nt (verse_id, tokens) VALUES (?, ?)',
          args: [`${book} ${chapter}:${verse}`, JSON.stringify(filled)],
        });
      }
    }
  }

  // 4. OpenHebrewBible preformatted layer strings (prompt parity). Verse
  // enumeration comes from each book's clauses layer; formatting reuses
  // the exact enrichment formatter.
  const openhebrewStmts: BatchStatement[] = [];
  {
    const { getOpenHebrewBibleLayers } = await import('../lib/datasets/open-hebrew-bible');
    const { formatOpenHebrewLayers } = await import('../lib/retrieval/enrichment');
    const ohbIndex = JSON.parse(
      await fs.promises.readFile(path.join(ROOT, 'data', 'openhebrewbible-index.json'), 'utf8')
    ) as Record<string, { clauses?: string }>;
    for (const [title, entry] of Object.entries(ohbIndex)) {
      const code = Object.keys(BOOK_CODE_TO_TITLE).find((c) => BOOK_CODE_TO_TITLE[c] === title);
      if (!code || !entry?.clauses || entry.clauses.includes('..')) continue;
      const clausesPath = await resolveDataFile(path.join(ROOT, 'data', 'openhebrewbible', entry.clauses));
      if (!clausesPath) continue;
      const clausesBook = JSON.parse(await readMaybeCompressed(clausesPath)) as {
        verses?: Record<string, Record<string, unknown>>;
      };
      for (const [chapter, verses] of Object.entries(clausesBook.verses ?? {})) {
        for (const verse of Object.keys(verses)) {
          const layers = await getOpenHebrewBibleLayers(
            code, Number.parseInt(chapter, 10), Number.parseInt(verse, 10)
          ).catch(() => null);
          if (!layers) continue;
          const formatted = formatOpenHebrewLayers(layers);
          if (!formatted) continue;
          openhebrewStmts.push({
            sql: 'INSERT OR REPLACE INTO openhebrew (verse_id, layers) VALUES (?, ?)',
            args: [`${code} ${chapter}:${verse}`, formatted],
          });
        }
      }
    }
  }

  // 5. TSK cross-references aggregated per source verse.

  // 5. TSK cross-references aggregated per source verse (raw votes kept;
  // read-time filtering matches the file path exactly).
  const tskStmts: BatchStatement[] = [];
  {
    const { getCrossReferences } = await import('../lib/datasets/tsk');
    const bibleIndex = JSON.parse(
      await fs.promises.readFile(path.join(ROOT, 'data', 'bible-full-index.json'), 'utf8')
    ) as Record<string, unknown>;
    for (const verseId of Object.keys(bibleIndex)) {
      const refs = await getCrossReferences(verseId).catch(() => []);
      if (refs.length === 0) continue;
      tskStmts.push({
        sql: 'INSERT OR REPLACE INTO tsk_refs (verse_id, refs) VALUES (?, ?)',
        args: [verseId.trim().toUpperCase(), JSON.stringify(refs)],
      });
    }
  }

  const byteSize = (stmts: BatchStatement[]) =>
    stmts.reduce((sum, s) => sum + JSON.stringify(s.args).length, 0);
  console.log(
    `[sizes] strongs=${strongsStmts.length} rows | ` +
    `morph_ot=${morphStmts.length} rows ${(byteSize(morphStmts) / 1048576).toFixed(1)}MB | ` +
    `interlinear_nt=${interlinearStmts.length} rows ${(byteSize(interlinearStmts) / 1048576).toFixed(1)}MB | ` +
    `openhebrew=${openhebrewStmts.length} rows ${(byteSize(openhebrewStmts) / 1048576).toFixed(1)}MB | ` +
    `tsk_refs=${tskStmts.length} rows ${(byteSize(tskStmts) / 1048576).toFixed(1)}MB`
  );
  if (DRY_RUN) {
    console.log('[dry] no writes performed');
    return;
  }

  await writeBatches(client, strongsStmts, 'strongs');
  await writeBatches(client, morphStmts, 'morph_ot');
  await writeBatches(client, interlinearStmts, 'interlinear_nt');
  await writeBatches(client, openhebrewStmts, 'openhebrew');
  await writeBatches(client, tskStmts, 'tsk_refs');
  console.log('[done] enrichment upload complete');
}

main().catch((error) => {
  console.error('Enrichment upload failed:', error);
  process.exit(1);
});
