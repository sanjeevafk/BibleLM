import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { describe, expect, it } from 'vitest';

import { compactNtChapter, compactOtChapter } from '@/lib/study-compact';

const DATA_DIR = path.join(process.cwd(), 'data');

type NtMorphBook = Record<string, Record<string, Array<{ w: string; s: string; r: string; l: string }>>>;
type NtInterlinearBook = Record<string, Record<string, Array<{ w: string; i: string }>>>;
type OtMorphBook = Record<string, Record<string, Array<{ t: string; s: string; m: string }>>>;
type StrongsDict = Record<string, { transliteration?: string; short_definition?: string }>;

function readDataJson<T>(relative: string): T {
  const full = path.join(DATA_DIR, relative);
  if (fs.existsSync(full)) {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
  }
  const br = `${full}.br`;
  if (fs.existsSync(br)) {
    return JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(br)).toString('utf8')) as T;
  }
  const gz = `${full}.gz`;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8')) as T;
}

describe('compactNtChapter (real OpenGNT data)', () => {
  it('merges Luke 10 with aligned glosses and G-prefixed Strong\'s', () => {
    const morph = readDataJson<NtMorphBook>('opengnt/opengnt-morph-LUK.json');
    const interlinear = readDataJson<NtInterlinearBook>('opengnt/opengnt-interlinear-LUK.json');
    const chapter = compactNtChapter(morph, interlinear, 10);
    const v25 = chapter.verses['25'];
    expect(v25.length).toBeGreaterThan(5);
    expect(v25[0]).toMatchObject({ w: 'Καὶ', s: 'G2532', g: 'And' });
    const lawyer = v25.find((t) => t.s === 'G3544');
    expect(lawyer?.g).toBeTruthy();
    for (const token of v25) {
      expect(token.s).toMatch(/^G\d+$/);
      expect(token).not.toHaveProperty('d');
    }
  });
});

describe('compactOtChapter (real MorphHB + Strong\'s data)', () => {
  it('merges Genesis 1 with H-prefixed Strong\'s and baked glosses', () => {
    const morph = readDataJson<OtMorphBook>('morphhb/GEN.json');
    const strongs = readDataJson<StrongsDict>('strongs-dict.json');
    const chapter = compactOtChapter(morph, strongs, 1);
    const v1 = chapter.verses['1'];
    expect(v1.length).toBeGreaterThan(3);
    expect(v1[0].s).toBe('H7225');
    expect(v1[0].g).toBeTruthy();
    expect(v1[0].tr).toBeTruthy();
    for (const token of v1) {
      expect(token.s).toMatch(/^H\d+$/);
    }
  });
});
