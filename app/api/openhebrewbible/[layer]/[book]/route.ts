import fs from 'fs';
import { NextRequest } from 'next/server';
import path from 'path';
import zlib from 'zlib';

const DATA_DIR = path.join(process.cwd(), 'data', 'openhebrewbible');
const INDEX_PATH = path.join(process.cwd(), 'data', 'openhebrewbible-index.json');

const BOOK_CODE_TO_TITLE: Record<string, string> = {
  GEN: 'Gen',
  EXO: 'Exo',
  LEV: 'Lev',
  NUM: 'Num',
  DEU: 'Deu',
  JOS: 'Jos',
  JDG: 'Jdg',
  RUT: 'Rut',
  '1SA': '1Sa',
  '2SA': '2Sa',
  '1KI': '1Ki',
  '2KI': '2Ki',
  '1CH': '1Ch',
  '2CH': '2Ch',
  EZR: 'Ezr',
  NEH: 'Neh',
  EST: 'Est',
  JOB: 'Job',
  PSA: 'Psa',
  PRO: 'Pro',
  ECC: 'Ecc',
  SNG: 'Sng',
  ISA: 'Isa',
  JER: 'Jer',
  LAM: 'Lam',
  EZK: 'Ezk',
  DAN: 'Dan',
  HOS: 'Hos',
  JOL: 'Jol',
  AMO: 'Amo',
  OBA: 'Oba',
  JON: 'Jon',
  MIC: 'Mic',
  NAM: 'Nam',
  HAB: 'Hab',
  ZEP: 'Zep',
  HAG: 'Hag',
  ZEC: 'Zec',
  MAL: 'Mal'
};

const TITLE_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(BOOK_CODE_TO_TITLE).flatMap(([upper, title]) => [
    [upper, title],
    [title.toUpperCase(), title],
    [title, title]
  ])
);

let indexCache: Record<string, { clauses?: string; poetic?: string; alignments?: string; gloss?: string }> = {};
try {
  indexCache = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as Record<string, { clauses?: string; poetic?: string; alignments?: string; gloss?: string }>;
} catch (error) {
  console.warn('OpenHebrewBible index load failed in API route', error);
}

function normalizeBook(input: string): string {
  if (!input) return input;
  const trimmed = input.replace(/\s+/g, '');
  const upper = trimmed.toUpperCase();
  if (indexCache[trimmed]) return trimmed;
  if (indexCache[upper]) return upper;
  if (TITLE_ALIASES[upper]) return TITLE_ALIASES[upper];
  return trimmed;
}

function resolvePaths(file: string) {
  const basePath = path.join(DATA_DIR, file);
  if (file.endsWith('.br')) {
    return {
      brPath: basePath,
      gzPath: basePath.replace(/\.json\.br$/, '.json.gz')
    };
  }
  if (file.endsWith('.gz')) {
    return {
      brPath: basePath.replace(/\.json\.gz$/, '.json.br'),
      gzPath: basePath
    };
  }
  return {
    brPath: `${basePath}.br`,
    gzPath: `${basePath}.gz`
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ layer?: string; book?: string }> }) {
  const { layer, book: rawBook } = await params;
  if (!layer || !rawBook) {
    return new Response('Not Found', { status: 404 });
  }
  const book = normalizeBook(rawBook);
  const entry = indexCache[book];
  if (!entry || !layer || !(layer in entry)) {
    return new Response('Not Found', { status: 404 });
  }
  const file = entry[layer as keyof typeof entry];
  if (!file) {
    return new Response('Not Found', { status: 404 });
  }

  const { brPath, gzPath } = resolvePaths(file);

  const acceptEncoding = req.headers.get('accept-encoding') || '';
  let body: Buffer;
  let encoding: 'br' | 'gzip' | null = null;

  if (acceptEncoding.includes('br') && fs.existsSync(brPath)) {
    body = fs.readFileSync(brPath);
    encoding = 'br';
  } else if (acceptEncoding.includes('gzip') && fs.existsSync(gzPath)) {
    body = fs.readFileSync(gzPath);
    encoding = 'gzip';
  } else if (fs.existsSync(gzPath)) {
    const raw = fs.readFileSync(gzPath);
    body = zlib.gunzipSync(raw);
  } else if (fs.existsSync(brPath)) {
    const raw = fs.readFileSync(brPath);
    body = zlib.brotliDecompressSync(raw);
  } else {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Vary': 'Accept-Encoding'
  });
  if (encoding) {
    headers.set('Content-Encoding', encoding);
  }

  return new Response(new Uint8Array(body), { status: 200, headers });
}

export const runtime = 'nodejs';
