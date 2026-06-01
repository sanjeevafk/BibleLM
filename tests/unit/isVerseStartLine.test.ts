/**
 * Unit tests for isVerseStartLine.
 * Verifies that generic bullets no longer misfire as verse starts.
 */

import { describe, it, expect } from 'vitest';
import { isVerseStartLine } from '@/components/Message';

// ---------------------------------------------------------------------------
// True verse lines — should return true
// ---------------------------------------------------------------------------

describe('isVerseStartLine → true for genuine verse lines', () => {
  it('standard double-quote opening', () => {
    expect(isVerseStartLine('- "In the beginning was the Word..."')).toBe(true);
  });

  it('curly open-quote (U+201C)', () => {
    expect(isVerseStartLine('- \u201CFor God so loved the world\u201D')).toBe(true);
  });

  it('single curly-quote opening', () => {
    expect(isVerseStartLine("- \u2018He is risen\u2019")).toBe(true);
  });

  it('bare verse reference — 3-letter code', () => {
    expect(isVerseStartLine('- JHN 3:16 — the classic')).toBe(true);
  });

  it('bare verse reference — full book name', () => {
    expect(isVerseStartLine('- Genesis 1:1')).toBe(true);
  });

  it('numbered book reference — 1 Cor 13:4', () => {
    expect(isVerseStartLine('- 1 Cor 13:4')).toBe(true);
  });

  it('numbered book reference — 2 Timothy 3:16', () => {
    expect(isVerseStartLine('- 2 Timothy 3:16')).toBe(true);
  });

  it('indented verse line (leading whitespace)', () => {
    expect(isVerseStartLine('  - "Love is patient, love is kind."')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Generic bullets — should return false
// ---------------------------------------------------------------------------

describe('isVerseStartLine → false for generic bullets', () => {
  it('plain prose bullet', () => {
    expect(isVerseStartLine('- Pray without ceasing.')).toBe(false);
  });

  it('explanation bullet', () => {
    expect(isVerseStartLine('- This verse emphasizes the importance of faith.')).toBe(false);
  });

  it('bullet starting with a number (not a reference)', () => {
    expect(isVerseStartLine('- 42 reasons to believe.')).toBe(false);
  });

  it('non-list line (no dash prefix)', () => {
    expect(isVerseStartLine('Just a sentence.')).toBe(false);
  });

  it('empty line', () => {
    expect(isVerseStartLine('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Exclusion patterns — should return false
// ---------------------------------------------------------------------------

describe('isVerseStartLine → false for excluded patterns', () => {
  it('- reference …', () => {
    expect(isVerseStartLine('- Reference: John 3:16')).toBe(false);
  });

  it('- **Original key words …', () => {
    expect(isVerseStartLine('- **Original key words:**')).toBe(false);
  });

  it('- **Original language details …', () => {
    expect(isVerseStartLine('- **Original language details:**')).toBe(false);
  });

  it('- Hebrew: …', () => {
    expect(isVerseStartLine('- Hebrew: some word')).toBe(false);
  });

  it('- Greek: …', () => {
    expect(isVerseStartLine('- Greek: logos')).toBe(false);
  });

  it('- Meaning: …', () => {
    expect(isVerseStartLine('- Meaning: love')).toBe(false);
  });

  it('- original key words (no bold)', () => {
    expect(isVerseStartLine('- original key words:')).toBe(false);
  });

  it('- original language details (no bold)', () => {
    expect(isVerseStartLine('- original language details:')).toBe(false);
  });
});
