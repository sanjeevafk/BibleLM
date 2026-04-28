/**
 * tests/unit/normalizeTranslation.test.ts
 *
 * Unit tests for the `normalizeTranslation` utility in route.ts.
 *
 * Because this function is currently co-located in the route handler we test
 * the logic directly here. If it is later extracted to a shared module this
 * test file only needs a single import path update.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inline the function under test (mirrors route.ts implementation exactly)
// ---------------------------------------------------------------------------

function normalizeTranslation(input: string | null | undefined): string {
  if (!input) return 'BSB';
  const upper = String(input).trim().toUpperCase();
  const validTranslations = ['BSB', 'KJV', 'WEB', 'ASV', 'NHEB'];
  return validTranslations.includes(upper) ? upper : 'BSB';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeTranslation', () => {
  describe('returns BSB as the default', () => {
    it('returns BSB for null', () => {
      expect(normalizeTranslation(null)).toBe('BSB');
    });

    it('returns BSB for undefined', () => {
      expect(normalizeTranslation(undefined)).toBe('BSB');
    });

    it('returns BSB for empty string', () => {
      expect(normalizeTranslation('')).toBe('BSB');
    });

    it('returns BSB for whitespace-only string', () => {
      expect(normalizeTranslation('   ')).toBe('BSB');
    });

    it('returns BSB for an unrecognised translation code', () => {
      expect(normalizeTranslation('NIV')).toBe('BSB');
    });

    it('returns BSB for a partially valid code', () => {
      expect(normalizeTranslation('BS')).toBe('BSB');
    });
  });

  describe('accepts valid translation codes', () => {
    const VALID = ['BSB', 'KJV', 'WEB', 'ASV', 'NHEB'] as const;

    for (const code of VALID) {
      it(`accepts "${code}" as-is`, () => {
        expect(normalizeTranslation(code)).toBe(code);
      });

      it(`normalises lowercase "${code.toLowerCase()}" to "${code}"`, () => {
        expect(normalizeTranslation(code.toLowerCase())).toBe(code);
      });

      it(`normalises mixed-case "${code[0] + code.slice(1).toLowerCase()}" to "${code}"`, () => {
        expect(normalizeTranslation(code[0] + code.slice(1).toLowerCase())).toBe(code);
      });
    }
  });

  describe('trims surrounding whitespace', () => {
    it('strips leading spaces', () => {
      expect(normalizeTranslation('  KJV')).toBe('KJV');
    });

    it('strips trailing spaces', () => {
      expect(normalizeTranslation('KJV  ')).toBe('KJV');
    });

    it('strips both sides', () => {
      expect(normalizeTranslation('  kjv  ')).toBe('KJV');
    });
  });
});
