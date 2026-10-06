import { describe, it, expect } from 'vitest';

import {
  decodeInterlinearTokens,
  decodeMorphTokens,
  decodeStrongsRow,
  decodeTskRefs,
} from '@/lib/datasets/turso-schema';

describe('decodeMorphTokens', () => {
  it('accepts well-formed token rows', () => {
    expect(
      decodeMorphTokens([{ t: 'בְּרֵאשִׁית', s: 'H7225', m: 'HR/Ncfsa' }])
    ).toEqual([{ t: 'בְּרֵאשִׁית', s: 'H7225', m: 'HR/Ncfsa' }]);
  });

  it('rejects rows missing required fields', () => {
    expect(decodeMorphTokens([{ t: 'x' }])).toBeNull();
    expect(decodeMorphTokens([{ s: 'H1' }])).toBeNull();
    expect(decodeMorphTokens('nope')).toBeNull();
    expect(decodeMorphTokens([42])).toBeNull();
  });
});

describe('decodeInterlinearTokens', () => {
  it('keeps optional gloss/transliteration/morphology', () => {
    expect(
      decodeInterlinearTokens([{ w: 'Καὶ', s: 'G2532', m: 'CONJ', tr: 'kaí', g: 'And' }])
    ).toEqual([{ w: 'Καὶ', s: 'G2532', m: 'CONJ', tr: 'kaí', g: 'And' }]);
  });

  it('rejects rows missing word or Strong\'s', () => {
    expect(decodeInterlinearTokens([{ w: 'Καὶ' }])).toBeNull();
    expect(decodeInterlinearTokens(null)).toBeNull();
  });
});

describe('decodeTskRefs', () => {
  it('accepts references with votes', () => {
    expect(decodeTskRefs([{ reference: 'ROM 5:8', votes: 949 }])).toEqual([
      { reference: 'ROM 5:8', votes: 949 },
    ]);
  });

  it('normalizes non-numeric votes to null and rejects bad refs', () => {
    expect(decodeTskRefs([{ reference: 'ROM 5:8', votes: 'high' }])).toEqual([
      { reference: 'ROM 5:8', votes: null },
    ]);
    expect(decodeTskRefs([{ reference: '', votes: 1 }])).toBeNull();
  });
});

describe('decodeStrongsRow', () => {
  it('maps short_def and drops empty strings', () => {
    expect(
      decodeStrongsRow({ lexeme: 'Σαμαρείτης', short_def: 'Samaritan', transliteration: '' })
    ).toEqual({ lexeme: 'Σαμαρείτης', short_definition: 'Samaritan' });
  });

  it('rejects non-objects', () => {
    expect(decodeStrongsRow(null)).toBeNull();
    expect(decodeStrongsRow('G4541')).toBeNull();
  });
});
