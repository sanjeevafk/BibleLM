/**
 * turso-schema — shared Turso layout + codecs for enrichment datasets.
 *
 * Tables (created by scripts/upload-enrichment-to-turso.ts):
 *   strongs        (id PK, lexeme, transliteration, pronunciation, short_def)
 *   morph_ot       (verse_id PK, tokens JSON [{t,s,m}])
 *   interlinear_nt (verse_id PK, tokens JSON [{w,s,m,tr,g}])
 *   openhebrew     (verse_id PK, layers TEXT — preformatted display string)
 *   tsk_refs       (verse_id PK, refs JSON [{reference, votes}])
 *
 * Readers use queryTursoJson with an in-memory cache; any failure returns
 * null so callers fall back to the local-filesystem datasets.
 */

import { getDbPool } from '../db';

const memoryCache = new Map<string, unknown>();

/** DDL for the enrichment tables (shared by the upload script and tests). */
export const ENRICHMENT_DDL: string[] = [
  'CREATE TABLE IF NOT EXISTS strongs (id TEXT PRIMARY KEY, lexeme TEXT, transliteration TEXT, pronunciation TEXT, short_def TEXT)',
  'CREATE TABLE IF NOT EXISTS morph_ot (verse_id TEXT PRIMARY KEY, tokens TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS interlinear_nt (verse_id TEXT PRIMARY KEY, tokens TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS openhebrew (verse_id TEXT PRIMARY KEY, layers TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS tsk_refs (verse_id TEXT PRIMARY KEY, refs TEXT NOT NULL)',
];

/** Clears the module-level row cache (unit tests). */
export function clearTursoSchemaCache(): void {
  memoryCache.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Single-row JSON lookup by primary key. Null on any miss or error. */
export async function queryTursoJson<T>(cacheKey: string, table: string, id: string): Promise<T | null> {
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey) as T | null;
  try {
    const pool = getDbPool();
    if (!pool) return null;
    const column = table === 'openhebrew' ? 'layers' : table === 'strongs' ? null : 'tokens';
    const sql =
      table === 'strongs'
        ? 'SELECT lexeme, transliteration, pronunciation, short_def FROM strongs WHERE id = ?'
        : table === 'tsk_refs'
          ? 'SELECT refs AS value FROM tsk_refs WHERE verse_id = ?'
          : `SELECT ${column} AS value FROM ${table} WHERE verse_id = ?`;
    const res = await pool.query<Record<string, unknown>>(sql, [id]);
    const row = res.rows[0];
    if (!row) {
      memoryCache.set(cacheKey, null);
      return null;
    }
    if (table === 'strongs' || table === 'openhebrew') {
      memoryCache.set(cacheKey, row);
      return row as unknown as T;
    }
    const raw = row.value;
    if (typeof raw !== 'string') {
      memoryCache.set(cacheKey, null);
      return null;
    }
    const parsed = JSON.parse(raw) as T;
    memoryCache.set(cacheKey, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export type MorphTokenRow = { t: string; s: string; m?: string };

export function decodeMorphTokens(raw: unknown): MorphTokenRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: MorphTokenRow[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const t = asString(item.t);
    const s = asString(item.s);
    if (!t || !s) return null;
    const token: MorphTokenRow = { t, s };
    const m = asOptionalString(item.m);
    if (m) token.m = m;
    out.push(token);
  }
  return out;
}

export type InterlinearTokenRow = {
  w: string;
  s: string;
  m?: string;
  tr?: string;
  g?: string;
};

export function decodeInterlinearTokens(raw: unknown): InterlinearTokenRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: InterlinearTokenRow[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const w = asString(item.w);
    const s = asString(item.s);
    if (!w || !s) return null;
    const token: InterlinearTokenRow = { w, s };
    const m = asOptionalString(item.m);
    if (m) token.m = m;
    const tr = asOptionalString(item.tr);
    if (tr) token.tr = tr;
    const g = asOptionalString(item.g);
    if (g) token.g = g;
    out.push(token);
  }
  return out;
}

export type TskRefRow = { reference: string; votes: number | null };

export function decodeTskRefs(raw: unknown): TskRefRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TskRefRow[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return null;
    const reference = asString(item.reference);
    if (!reference) return null;
    const votes = typeof item.votes === 'number' && Number.isFinite(item.votes) ? item.votes : null;
    out.push({ reference, votes });
  }
  return out;
}

export type StrongsRow = {
  lexeme?: string;
  transliteration?: string;
  pronunciation?: string;
  short_definition?: string;
};

export function decodeStrongsRow(raw: unknown): StrongsRow | null {
  if (!isRecord(raw)) return null;
  const row: StrongsRow = {};
  const lexeme = asOptionalString(raw.lexeme);
  if (lexeme) row.lexeme = lexeme;
  const transliteration = asOptionalString(raw.transliteration);
  if (transliteration) row.transliteration = transliteration;
  const pronunciation = asOptionalString(raw.pronunciation);
  if (pronunciation) row.pronunciation = pronunciation;
  const shortDef = asOptionalString(raw.short_def ?? raw.short_definition);
  if (shortDef) row.short_definition = shortDef;
  return row;
}
