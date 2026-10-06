/**
 * Integration: enrichment dataset readers against a file-backed Turso
 * (SQLite) database. Proves the Turso-first path end to end — the same
 * SQL the edge runtime executes — without touching local dataset files
 * for the primed verses.
 */
process.env.TURSO_DATABASE_URL = 'file:/tmp/enrichment-test.db';

import fs from 'fs';
import { describe, it, expect, beforeAll } from 'vitest';

import { getDbPool } from '@/lib/db';
import { ENRICHMENT_DDL, clearTursoSchemaCache } from '@/lib/datasets/turso-schema';
import { getMorphForVerse } from '@/lib/datasets/morphhb';
import { getOpenGNTLayers } from '@/lib/opengnt';
import { getStrongsEntries, getStrongsEntry } from '@/lib/datasets/strongs';
import { getCrossReferences } from '@/lib/datasets/tsk';
import { getOpenHebrewText } from '@/lib/datasets/open-hebrew-bible';

const DB_PATH = '/tmp/enrichment-test.db';

beforeAll(async () => {
  try {
    fs.rmSync(DB_PATH);
  } catch { /* fresh start best-effort */ }
  clearTursoSchemaCache();
  const pool = getDbPool();
  if (!pool) throw new Error('no db pool for file-backed test database');
  for (const sql of ENRICHMENT_DDL) {
    await pool.query(sql);
  }
  await pool.query(
    'INSERT INTO strongs (id, lexeme, transliteration, pronunciation, short_def) VALUES (?, ?, ?, ?, ?)',
    ['G4541', 'Σαμαρείτης', 'Samareítēs', "sam-ar-i'-tace", 'Samaritan']
  );
  await pool.query('INSERT INTO morph_ot (verse_id, tokens) VALUES (?, ?)', [
    'GEN 1:1',
    JSON.stringify([{ t: 'בְּרֵאשִׁית', s: 'H7225', m: 'HR/Ncfsa' }]),
  ]);
  await pool.query('INSERT INTO interlinear_nt (verse_id, tokens) VALUES (?, ?)', [
    'LUK 10:25',
    JSON.stringify([{ w: 'νομικός', s: 'G3544', m: 'A-NSM', tr: 'nomikós', g: 'a lawyer' }]),
  ]);
  await pool.query('INSERT INTO openhebrew (verse_id, layers) VALUES (?, ?)', [
    'GEN 1:1',
    'Clauses: c1',
  ]);
  await pool.query('INSERT INTO tsk_refs (verse_id, refs) VALUES (?, ?)', [
    'JHN 3:16',
    JSON.stringify([{ reference: 'ROM 5:8', votes: 949 }]),
  ]);
});

describe('turso-backed enrichment readers', () => {
  it('reads Strong\'s entries singly and in batch', async () => {
    const single = await getStrongsEntry('g4541');
    expect(single?.short_definition).toBe('Samaritan');
    const batch = await getStrongsEntries(['G4541', 'H9999']);
    expect(batch.get('G4541')?.transliteration).toBe('Samareítēs');
    expect(batch.has('H9999')).toBe(false);
  });

  it('reads MorphHB words for an OT verse', async () => {
    const words = await getMorphForVerse('GEN', 1, 1);
    expect(words?.[0]).toMatchObject({ s: 'H7225', m: 'HR/Ncfsa' });
  });

  it('reads OpenGNT layers for an NT verse', async () => {
    const layers = await getOpenGNTLayers('LUK 10:25');
    expect(layers?.morphology?.[0]).toMatchObject({ w: 'νομικός', s: 'G3544' });
    expect(layers?.interlinear?.[0]).toMatchObject({ w: 'νομικός', i: 'a lawyer' });
  });

  it('reads preformatted OpenHebrew text', async () => {
    await expect(getOpenHebrewText('GEN', 1, 1)).resolves.toBe('Clauses: c1');
  });

  it('reads TSK cross-references', async () => {
    const refs = await getCrossReferences('JHN 3:16');
    expect(refs[0]).toMatchObject({ reference: 'ROM 5:8', votes: 949 });
  });
});
