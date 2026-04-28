/**
 * tests/unit/scrubInvalidCitations.test.ts
 *
 * Unit tests for `scrubInvalidCitations` from app/api/chat/lib/citation-scrubber.ts.
 *
 * This function sanitises the LLM's generated text by removing any
 * verse citation markers (e.g. [JHN 3:16]) that are not backed by an actual
 * retrieved VerseContext. Removing phantom citations is critical for
 * maintaining the "Sola Scriptura" trust model.
 */

import { describe, it, expect } from 'vitest';
import type { VerseContext } from '../../lib/bible-fetch';

import { scrubInvalidCitations } from '../../app/api/chat/lib/citation-scrubber';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function verse(reference: string, text = 'Sample text.'): VerseContext {
  return { reference, translation: 'BSB', text, original: [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scrubInvalidCitations', () => {
  describe('keeps valid citations', () => {
    it('preserves a citation that matches a retrieved verse', () => {
      const verses = [verse('JHN 3:16')];
      const input = 'God loved the world [JHN 3:16].';
      expect(scrubInvalidCitations(input, verses)).toBe(input);
    });

    it('preserves multiple valid citations in the same text', () => {
      const verses = [verse('JHN 3:16'), verse('ROM 8:28')];
      const input = 'See [JHN 3:16] and [ROM 8:28].';
      expect(scrubInvalidCitations(input, verses)).toBe(input);
    });

    it('is case-insensitive when matching citations', () => {
      const verses = [verse('JHN 3:16')];
      const input = 'See [jhn 3:16].';
      // The citation is valid — keep it
      expect(scrubInvalidCitations(input, verses)).toBe(input);
    });
  });

  describe('removes invalid citations', () => {
    it('removes a citation with no matching verse', () => {
      const verses = [verse('JHN 3:16')];
      const input = 'Unsubstantiated claim [MAT 5:3].';
      const result = scrubInvalidCitations(input, verses);
      expect(result).not.toContain('[MAT 5:3]');
      expect(result).toContain('Unsubstantiated claim');
    });

    it('removes multiple phantom citations', () => {
      const verses: VerseContext[] = [];
      const input = 'See [JHN 3:16] and [ROM 8:28].';
      const result = scrubInvalidCitations(input, verses);
      expect(result).not.toContain('[JHN 3:16]');
      expect(result).not.toContain('[ROM 8:28]');
    });

    it('removes an invalid citation while preserving a valid one', () => {
      const verses = [verse('JHN 3:16')];
      const input = 'Valid [JHN 3:16] and phantom [MAT 5:3].';
      const result = scrubInvalidCitations(input, verses);
      expect(result).toContain('[JHN 3:16]');
      expect(result).not.toContain('[MAT 5:3]');
    });
  });

  describe('edge cases', () => {
    it('returns the original text unchanged when there are no citation brackets', () => {
      const verses = [verse('JHN 3:16')];
      const input = 'No citations here at all.';
      expect(scrubInvalidCitations(input, verses)).toBe(input);
    });

    it('handles an empty verse list gracefully', () => {
      const input = 'See [JHN 3:16].';
      const result = scrubInvalidCitations(input, []);
      expect(result).not.toContain('[JHN 3:16]');
    });

    it('handles an empty text gracefully', () => {
      const verses = [verse('JHN 3:16')];
      expect(scrubInvalidCitations('', verses)).toBe('');
    });

    it('handles text with no invalid brackets', () => {
      const input = 'Some text with (parens) and {braces}.';
      expect(scrubInvalidCitations(input, [])).toBe(input);
    });
  });
});
