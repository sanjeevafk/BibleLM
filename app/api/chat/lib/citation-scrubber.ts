/**
 * Citation whitelist enforcement.
 *
 * The LLM sometimes hallucinates verse references that were not in the
 * retrieved context. This module scrubs those invalid citations from the
 * model output so only verified references remain in the final response.
 *
 * All functions are pure string transforms — no I/O.
 */

import { buildCitationWhitelist, expandCitationReference } from '@/lib/prompts';
import type { VerseContext } from '@/lib/bible-fetch';

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

function normalizeCitationToken(citation: string): string {
  const trimmed = citation.trim();
  let end = trimmed.length;
  while (end > 0) {
    const char = trimmed[end - 1];
    if (!'()[],.;:!?'.includes(char)) break;
    end -= 1;
  }
  return collapseCitationWhitespace(trimmed.slice(0, end));
}

function collapseCitationWhitespace(value: string): string {
  let result = '';
  let previousWasWhitespace = false;
  for (const char of value) {
    const isWhitespace = char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f' || char === '\v';
    if (isWhitespace) {
      if (!previousWasWhitespace && result.length > 0) result += ' ';
      previousWasWhitespace = true;
      continue;
    }
    result += char;
    previousWasWhitespace = false;
  }
  return result.trim();
}

function removeAllOccurrences(value: string, target: string): string {
  if (!target) return value;
  let result = value;
  let index = result.indexOf(target);
  while (index !== -1) {
    result = `${result.slice(0, index)}${result.slice(index + target.length)}`;
    index = result.indexOf(target);
  }
  return result;
}

function stripBracketedCitationSegments(content: string, citation: string, opening: string, closing: string): string {
  if (!citation) return content;
  let result = content;
  let searchStart = 0;

  while (searchStart < result.length) {
    const citationIndex = result.indexOf(citation, searchStart);
    if (citationIndex === -1) break;

    const openingIndex = result.lastIndexOf(opening, citationIndex);
    const closingIndex = result.indexOf(closing, citationIndex + citation.length);
    if (openingIndex !== -1 && closingIndex !== -1) {
      const segment = result.slice(openingIndex + 1, closingIndex);
      if (segment.includes(citation)) {
        result = `${result.slice(0, openingIndex)}${result.slice(closingIndex + 1)}`;
        searchStart = openingIndex;
        continue;
      }
    }
    searchStart = citationIndex + citation.length;
  }
  return result;
}

function stripEmptyCitationDelimiters(content: string): string {
  let result = content;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pair of ['()', '[]']) {
      const next = removeAllOccurrences(result, pair);
      if (next !== result) { result = next; changed = true; }
    }
  }
  return result;
}

function collapseRepeatedSpacesPerLine(value: string): string {
  let result = '';
  let previousWasSpace = false;
  for (const char of value) {
    if (char === ' ' || char === '\t') {
      if (!previousWasSpace) result += ' ';
      previousWasSpace = true;
      continue;
    }
    result += char;
    previousWasSpace = false;
  }
  return result;
}

function collapseBlankLines(value: string): string {
  let result = '';
  let consecutiveNewlines = 0;
  for (const char of value) {
    if (char === '\n') {
      consecutiveNewlines += 1;
      if (consecutiveNewlines <= 2) result += char;
      continue;
    }
    consecutiveNewlines = 0;
    result += char;
  }
  return result;
}

function removeSpaceBeforeCitationPunctuation(value: string): string {
  let result = '';
  for (const char of value) {
    if (',.;:!?'.includes(char) && result.endsWith(' ')) result = result.slice(0, -1);
    result += char;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Citation validation
// ---------------------------------------------------------------------------

function buildCitationWhitelistSet(verses: VerseContext[]): Set<string> {
  const whitelist = new Set<string>();
  for (const citation of buildCitationWhitelist(verses)) {
    const normalized = normalizeCitationToken(citation);
    if (normalized) whitelist.add(normalized.toLowerCase());
  }
  return whitelist;
}

function extractCitations(content: string): string[] {
  const matches = content.match(
    /(?<![1-3]\s)\b(?:[1-3][A-Z]{2}|[A-Z]{2,3}|[1-3]\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+\d+:\d+(?:[-–]\d+)?\b/g
  );
  return matches ? matches.map((match) => normalizeCitationToken(match)) : [];
}

function isAllowedCitation(citation: string, whitelist: Set<string>): boolean {
  const normalized = normalizeCitationToken(citation);
  if (!normalized) return true;
  const expanded = expandCitationReference(normalized);
  return whitelist.has(normalized.toLowerCase()) || whitelist.has(expanded.toLowerCase());
}

/**
 * Removes any bible citations from `content` that are not in the retrieved verses whitelist.
 * Also cleans up empty brackets and structural whitespace left by removals.
 */
export function scrubInvalidCitations(content: string, verses: VerseContext[]): string {
  const whitelist = buildCitationWhitelistSet(verses);
  if (whitelist.size === 0) return content;

  const citations = extractCitations(content);
  const invalidCitations = Array.from(
    new Set(citations.filter((citation) => !isAllowedCitation(citation, whitelist)))
  );

  if (invalidCitations.length === 0) return content;

  let sanitized = content;
  for (const citation of invalidCitations) {
    sanitized = stripBracketedCitationSegments(sanitized, citation, '(', ')');
    sanitized = stripBracketedCitationSegments(sanitized, citation, '[', ']');
    sanitized = removeAllOccurrences(sanitized, citation);
  }

  sanitized = stripEmptyCitationDelimiters(sanitized);
  sanitized = collapseRepeatedSpacesPerLine(sanitized);
  sanitized = collapseBlankLines(sanitized);
  sanitized = removeSpaceBeforeCitationPunctuation(sanitized).trim();

  console.info(JSON.stringify({
    event: 'citation_whitelist_enforced',
    removedCitations: invalidCitations,
    allowedCitations: Array.from(whitelist),
  }));

  return sanitized;
}
