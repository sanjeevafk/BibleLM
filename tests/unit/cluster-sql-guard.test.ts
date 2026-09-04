/**
 * Regression guard for the pg placeholder bug:
 * lib/retrieval/pipeline.ts must use $1,$2 placeholders (pg),
 * never `?`, and LIKE clauses must escape wildcards.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('TSK cluster SQL placeholders', () => {
  it('uses numbered $n placeholders and ESCAPE clauses', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../lib/retrieval/pipeline.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/label LIKE \?/);
    expect(src).not.toMatch(/LIMIT \?/);
    expect(src).toMatch(/label LIKE \$/);
    expect(src).toMatch(/ESCAPE/);
  });

  it('passage query escapes LIKE wildcards', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../lib/retrieval/verse-fetch.ts'),
      'utf8'
    );
    expect(src).toContain('escapeLikePattern');
    expect(src).toMatch(/LIKE \$1 ESCAPE/);
  });
});
