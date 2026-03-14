import fs from 'fs';
import { NextRequest } from 'next/server';
import path from 'path';
import zlib from 'zlib';

const MORPHHB_DIR = path.join(process.cwd(), 'data', 'morphhb');
const INDEX_PATH = path.join(process.cwd(), 'data', 'morphhb-index.json');

const OSIS_TO_BOOK: Record<string, string> = {
  Gen: 'GEN',
  Exod: 'EXO',
  Lev: 'LEV',
  Num: 'NUM',
  Deut: 'DEU',
  Josh: 'JOS',
  Judg: 'JDG',
  Ruth: 'RUT',
  '1Sam': '1SA',
  '2Sam': '2SA',
  '1Kgs': '1KI',
  '2Kgs': '2KI',
  '1Chr': '1CH',
  '2Chr': '2CH',
  Ezra: 'EZR',
  Neh: 'NEH',
  Esth: 'EST',
  Job: 'JOB',
  Ps: 'PSA',
  Prov: 'PRO',
  Eccl: 'ECC',
  Song: 'SNG',
  Isa: 'ISA',
  Jer: 'JER',
  Lam: 'LAM',
  Ezek: 'EZK',
  Dan: 'DAN',
  Hos: 'HOS',
  Joel: 'JOL',
  Amos: 'AMO',
  Obad: 'OBA',
  Jonah: 'JON',
  Mic: 'MIC',
  Nah: 'NAM',
  Hab: 'HAB',
  Zeph: 'ZEP',
  Hag: 'HAG',
  Zech: 'ZEC',
  Mal: 'MAL'
};

let indexCache: Record<string, string> = {};
try {
  indexCache = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) as Record<string, string>;
} catch (error) {
  console.warn('MorphHB index load failed in API route', error);
}

const OSIS_TO_BOOK_UPPER: Record<string, string> = Object.fromEntries(
  Object.entries(OSIS_TO_BOOK).map(([key, value]) => [key.toUpperCase(), value])
);

function normalizeBook(input: string): string {
  if (!input) return input;
  const trimmed = input.replace(/\s+/g, '');
  const upper = trimmed.toUpperCase();
  if (indexCache[upper]) return upper;
  if (OSIS_TO_BOOK[trimmed]) return OSIS_TO_BOOK[trimmed];
  if (OSIS_TO_BOOK_UPPER[upper]) return OSIS_TO_BOOK_UPPER[upper];
  return upper;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ book?: string }> }) {
  const { book: rawBook } = await params;
  if (!rawBook) {
    return new Response('Not Found', { status: 404 });
  }
  const book = normalizeBook(rawBook);
  const file = indexCache[book];
  if (!file) {
    return new Response('Not Found', { status: 404 });
  }

  const basePath = path.join(MORPHHB_DIR, file);
  const brPath = basePath.replace(/\.json\.gz$/, '.json.br');

  const acceptEncoding = req.headers.get('accept-encoding') || '';
  let body: Buffer;
  let encoding: 'br' | 'gzip' | null = null;

  if (acceptEncoding.includes('br') && fs.existsSync(brPath)) {
    body = fs.readFileSync(brPath);
    encoding = 'br';
  } else if (acceptEncoding.includes('gzip') && fs.existsSync(basePath)) {
    body = fs.readFileSync(basePath);
    encoding = 'gzip';
  } else if (fs.existsSync(basePath)) {
    const raw = fs.readFileSync(basePath);
    body = zlib.gunzipSync(raw);
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
