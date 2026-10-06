/**
 * build-study-assets — generates the static files the Side-by-Side Study
 * Pane fetches at runtime:
 *
 *   public/data/translations-index.json
 *   public/data/translations/*.json            (copied plain JSON)
 *   public/data/interlinear/<BOOK>-<chapter>.json (compact merged tokens)
 *   public/data/strongs-dict.json               (copied, lazy-loaded)
 *
 * Run via `npm run build:study-assets` (also a prerequisite of `npm run build`).
 * Output is git-ignored build output served by Vite (dev) and ASSETS (prod).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { compactNtChapter, compactOtChapter } from '../lib/study-compact';

const gunzip = promisify(zlib.gunzip);
const inflateRaw = promisify(zlib.inflateRaw);
const brotliDecompress = promisify(zlib.brotliDecompress);

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'public', 'data');

const OT_BOOKS = new Set([
  'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT',
  '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH',
  'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER',
  'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON',
  'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
]);

async function readMaybeCompressed(filePath: string): Promise<string> {
  const raw = await fs.promises.readFile(filePath);
  if (filePath.endsWith('.br')) return (await brotliDecompress(raw)).toString('utf8');
  if (filePath.endsWith('.gz')) return (await gunzip(raw)).toString('utf8');
  if (filePath.endsWith('.zz')) return (await inflateRaw(raw)).toString('utf8');
  return raw.toString('utf8');
}

async function resolveDataFile(basePath: string): Promise<string | null> {
  for (const candidate of [basePath, `${basePath}.br`, `${basePath}.gz`]) {
    try {
      await fs.promises.access(candidate);
      return candidate;
    } catch {
      // try next suffix
    }
  }
  return null;
}

async function copyFile(src: string, dest: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(src, dest);
}

async function buildTranslations(): Promise<number> {
  const indexRaw = await fs.promises.readFile(path.join(DATA_DIR, 'translations-index.json'), 'utf8');
  const index = JSON.parse(indexRaw) as Record<string, Record<string, string>>;
  await copyFile(
    path.join(DATA_DIR, 'translations-index.json'),
    path.join(OUT_DIR, 'translations-index.json')
  );
  let count = 0;
  const seen = new Set<string>();
  for (const books of Object.values(index)) {
    for (const file of Object.values(books)) {
      if (seen.has(file) || file.includes('..') || path.isAbsolute(file)) continue;
      seen.add(file);
      const plain = path.join(DATA_DIR, 'translations', file);
      try {
        await fs.promises.access(plain);
      } catch {
        continue; // compressed-only variants are skipped; plain JSON is the contract
      }
      await copyFile(plain, path.join(OUT_DIR, 'translations', file));
      count += 1;
    }
  }
  return count;
}

async function buildInterlinear(): Promise<number> {
  const opengntIndex = JSON.parse(
    await fs.promises.readFile(path.join(DATA_DIR, 'opengnt-index.json'), 'utf8')
  ) as Record<string, { morph?: string; interlinear?: string }>;
  const morphhbIndex = JSON.parse(
    await fs.promises.readFile(path.join(DATA_DIR, 'morphhb-index.json'), 'utf8')
  ) as Record<string, string>;
  const strongsDict = JSON.parse(
    await readMaybeCompressed(
      (await resolveDataFile(path.join(DATA_DIR, 'strongs-dict.json'))) ?? ''
    )
  ) as Record<string, { transliteration?: string; short_definition?: string; definition?: string }>;

  const outDir = path.join(OUT_DIR, 'interlinear');
  await fs.promises.mkdir(outDir, { recursive: true });

  const books = new Set<string>([
    ...Object.keys(opengntIndex),
    ...Object.keys(morphhbIndex),
  ]);
  let count = 0;

  for (const book of books) {
    if (OT_BOOKS.has(book)) {
      const file = morphhbIndex[book];
      if (!file || file.includes('..')) continue;
      const resolved = await resolveDataFile(path.join(DATA_DIR, 'morphhb', file));
      if (!resolved) continue;
      const morphBook = JSON.parse(await readMaybeCompressed(resolved));
      for (const chapter of Object.keys(morphBook)) {
        const compact = compactOtChapter(morphBook, strongsDict, Number.parseInt(chapter, 10));
        await fs.promises.writeFile(
          path.join(outDir, `${book}-${chapter}.json`),
          JSON.stringify(compact)
        );
        count += 1;
      }
    } else {
      const entry = opengntIndex[book];
      if (!entry?.morph) continue;
      const morphPath = await resolveDataFile(path.join(DATA_DIR, 'opengnt', entry.morph));
      if (!morphPath) continue;
      const morphBook = JSON.parse(await readMaybeCompressed(morphPath));
      let interlinearBook = null;
      if (entry.interlinear) {
        const intPath = await resolveDataFile(path.join(DATA_DIR, 'opengnt', entry.interlinear));
        if (intPath) interlinearBook = JSON.parse(await readMaybeCompressed(intPath));
      }
      for (const chapter of Object.keys(morphBook)) {
        const compact = compactNtChapter(morphBook, interlinearBook, Number.parseInt(chapter, 10));
        await fs.promises.writeFile(
          path.join(outDir, `${book}-${chapter}.json`),
          JSON.stringify(compact)
        );
        count += 1;
      }
    }
  }
  return count;
}

async function main(): Promise<void> {
  const started = Date.now();
  const translations = await buildTranslations();
  const chapters = await buildInterlinear();
  await copyFile(path.join(DATA_DIR, 'strongs-dict.json'), path.join(OUT_DIR, 'strongs-dict.json'));
  console.log(
    `[study-assets] ${translations} translation books, ${chapters} interlinear chapters in ${Date.now() - started}ms -> public/data`
  );
}

main().catch((error) => {
  console.error('[study-assets] build failed:', error);
  process.exit(1);
});
