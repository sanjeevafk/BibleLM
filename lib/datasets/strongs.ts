import { loadJsonDataset, resolveDatasetPath } from './base';
import { getDbPool } from '../db';
import { decodeStrongsRow } from './turso-schema';

export type StrongsEntry = {
  definition?: string;
  short_definition?: string;
  transliteration?: string;
  [key: string]: string | undefined;
};

const STRONGS_DICT_PATH = resolveDatasetPath('data', 'strongs-dict.json');

export async function loadStrongsDictionary(): Promise<Record<string, StrongsEntry> | null> {
  return loadJsonDataset<Record<string, StrongsEntry>>('strongs:dictionary', [STRONGS_DICT_PATH]);
}

function normalizeId(strongsId: string): string | null {
  const normalized = strongsId.trim().toUpperCase();
  return normalized ? normalized : null;
}

function rowToEntry(row: {
  lexeme?: string;
  transliteration?: string;
  pronunciation?: string;
  short_definition?: string;
}): StrongsEntry | null {
  const decoded = decodeStrongsRow({ short_definition: row.short_definition, ...row });
  if (!decoded) return null;
  const entry: StrongsEntry = {};
  if (decoded.lexeme) entry.lexeme = decoded.lexeme;
  if (decoded.transliteration) entry.transliteration = decoded.transliteration;
  if (decoded.pronunciation) entry.pronunciation = decoded.pronunciation;
  if (decoded.short_definition) entry.short_definition = decoded.short_definition;
  return entry;
}

async function getStrongsRowFromTurso(
  id: string
): Promise<{ lexeme?: string; transliteration?: string; pronunciation?: string; short_definition?: string } | null> {
  try {
    const pool = getDbPool();
    if (!pool) return null;
    const res = await pool.query<Record<string, unknown>>(
      'SELECT lexeme, transliteration, pronunciation, short_def FROM strongs WHERE id = ?',
      [id]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      lexeme: typeof row.lexeme === 'string' ? row.lexeme : undefined,
      transliteration: typeof row.transliteration === 'string' ? row.transliteration : undefined,
      pronunciation: typeof row.pronunciation === 'string' ? row.pronunciation : undefined,
      short_definition: typeof row.short_def === 'string' ? row.short_def : undefined,
    };
  } catch {
    return null;
  }
}

export async function getStrongsEntry(strongsId: string): Promise<StrongsEntry | null> {
  const normalizedId = normalizeId(strongsId);
  if (!normalizedId) {
    return null;
  }

  const tursoRow = await getStrongsRowFromTurso(normalizedId);
  if (tursoRow) {
    return rowToEntry(tursoRow);
  }

  const dict = await loadStrongsDictionary();
  if (!dict) {
    return null;
  }

  return dict[normalizedId] || null;
}

/**
 * Batch Strong's lookup in a single query (enrichment hydration path).
 * Falls back per-id to the local dictionary when Turso is unavailable.
 */
export async function getStrongsEntries(
  strongsIds: string[]
): Promise<Map<string, StrongsEntry>> {
  const result = new Map<string, StrongsEntry>();
  const normalized = Array.from(
    new Set(strongsIds.map(normalizeId).filter((id): id is string => Boolean(id)))
  );
  if (normalized.length === 0) return result;

  try {
    const pool = getDbPool();
    if (pool) {
      const placeholders = normalized.map(() => '?').join(', ');
      const res = await pool.query<Record<string, unknown>>(
        `SELECT id, lexeme, transliteration, pronunciation, short_def FROM strongs WHERE id IN (${placeholders})`,
        normalized
      );
      for (const row of res.rows) {
        const id = typeof row.id === 'string' ? row.id.toUpperCase() : '';
        if (!id) continue;
        const entry = rowToEntry({
          lexeme: typeof row.lexeme === 'string' ? row.lexeme : undefined,
          transliteration: typeof row.transliteration === 'string' ? row.transliteration : undefined,
          pronunciation: typeof row.pronunciation === 'string' ? row.pronunciation : undefined,
          short_definition: typeof row.short_def === 'string' ? row.short_def : undefined,
        });
        if (entry) result.set(id, entry);
      }
      if (result.size === normalized.length) return result;
    }
  } catch {
    // Fall through to per-id local fallback below.
  }

  const missing = normalized.filter((id) => !result.has(id));
  if (missing.length > 0) {
    const dict = await loadStrongsDictionary().catch(() => null);
    for (const id of missing) {
      const entry = dict?.[id];
      if (entry) result.set(id, entry);
    }
  }
  return result;
}
