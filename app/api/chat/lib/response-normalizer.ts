/**
 * Response content normalization and structured payload building.
 *
 * Handles:
 *  - Post-processing raw LLM output (verse formatting, morph blocks, blank lines)
 *  - Building the structured JSON payload attached to responses
 *  - Streaming cached content through the AI SDK
 *  - Context utilization diagnostics
 */

import { simulateReadableStream, streamText } from 'ai';
import type { VerseContext } from '@/lib/bible-fetch';
import {
  buildStructuredVerseResponse,
  compactStructuredChatResponse,
  normalizeOriginalLanguageEntries,
  type StructuredChatResponse,
} from '@/lib/verse-response';
import { expandCitationReference } from '@/lib/prompts';
import { ENABLE_RETRIEVAL_DEBUG } from '@/lib/feature-flags';

const DEBUG_LLM = ENABLE_RETRIEVAL_DEBUG;

// ---------------------------------------------------------------------------
// Fallback banner
// ---------------------------------------------------------------------------

export function ensureFallbackBanner(
  content: string,
  modelUsed: string,
  fallbackUsed: boolean,
  finalFallback: boolean
): string {
  if (!fallbackUsed || finalFallback) return content;
  const banner = `Using fallback model: ${modelUsed} due to rate limits / availability`;
  if (content.startsWith(banner)) return content;
  return `${banner}\n\n${content}`;
}

// ---------------------------------------------------------------------------
// Morph block line formatters (used inside normalizeResponseContent)
// ---------------------------------------------------------------------------

function normalizeOriginalKeywordLine(line: string): string {
  const match = line.match(/^(\s*[-*]\s+)(.+)$/);
  if (!match) return line;

  const prefix = match[1];
  const body = match[2].trim();
  if (!body || body.startsWith('`') || body.startsWith('```')) return line;

  const wordWithMetaMatch = body.match(/^(\[?[^\(\]]+\]?)(\s*\(.*\))$/);
  if (wordWithMetaMatch) {
    const word = wordWithMetaMatch[1].replace(/^\[|\]$/g, '').trim();
    const rest = wordWithMetaMatch[2].trim();
    return `${prefix}\`${word}\` ${rest}`;
  }

  const compactMatch = body.match(/^([^\s,;:]+)(.*)$/);
  if (!compactMatch) return line;

  const word = compactMatch[1].replace(/^\[|\]$/g, '').trim();
  const rest = compactMatch[2] || '';
  return `${prefix}\`${word}\`${rest}`;
}

function formatMorphArtifactLine(line: string): string[] | null {
  const trimmed = line.trim();
  const payload = trimmed
    .replace(/^[-*]\s*/, '')
    .replace(/^`{1,3}/, '')
    .replace(/`{1,3}$/, '')
    .trim();

  if (!/^orig\s*\|/i.test(payload)) return null;

  const parts = payload.split('|').map((part) => part.trim());
  if (parts.length < 4) return [];

  const [, wordCandidate, third, fourth, fifth] = parts;
  const hasTransliteration = /^[HG]\d+$/i.test(fourth || '');
  const word = wordCandidate?.trim();
  const transliteration = hasTransliteration ? third?.trim() : '';
  const strongs = hasTransliteration ? fourth?.trim() : third?.trim();
  const meaning = hasTransliteration ? fifth?.trim() : fourth?.trim();

  if (!word || !strongs || !meaning || !/^[HG]\d+$/i.test(strongs)) return [];

  const language = strongs.toUpperCase().startsWith('H') ? 'Hebrew' : 'Greek';
  const label = transliteration
    ? `${language}: ${word} (${strongs}; ${transliteration})`
    : `${language}: ${word} (${strongs})`;

  return [`- ${label}`, `  Meaning: ${meaning}`];
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

function extractResponseSections(content: string): { preamble: string; postamble: string } {
  const lines = content.split(/\r?\n/);
  const preambleLines: string[] = [];
  const postambleLines: string[] = [];
  let i = 0;
  let inVerseSection = false;

  const isVerseStartLine = (value: string) => {
    const trimmed = value.trimStart();
    const lower = trimmed.toLowerCase();
    if (!trimmed.startsWith('- ')) return false;
    if (
      lower.startsWith('- reference') ||
      lower.startsWith('- **original key words') ||
      lower.startsWith('- **original language details') ||
      lower.startsWith('- hebrew:') ||
      lower.startsWith('- greek:') ||
      lower.startsWith('- meaning:') ||
      lower.startsWith('- original key words') ||
      lower.startsWith('- original language details')
    ) return false;
    return true;
  };

  while (i < lines.length) {
    const line = lines[i];
    const isVerseStart = isVerseStartLine(line);
    if (!isVerseStart) {
      if (!inVerseSection) preambleLines.push(line);
      else postambleLines.push(line);
      i += 1;
      continue;
    }
    inVerseSection = true;
    i += 1;

    while (i < lines.length) {
      const next = lines[i];
      if (isVerseStartLine(next)) break;
      if (!next.trim()) { i += 1; continue; }
      if (/^\S/.test(next) && !next.startsWith('- ') && !next.startsWith('* ')) {
        postambleLines.push(...lines.slice(i));
        i = lines.length;
        break;
      }
      i += 1;
    }
  }

  return {
    preamble: preambleLines.join('\n').trim(),
    postamble: postambleLines.join('\n').trim(),
  };
}

function extractAnalysisSummary(content: string): string | undefined {
  const { preamble, postamble } = extractResponseSections(content);
  const summary = [preamble, postamble]
    .flatMap((section) => section.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^Using fallback model:/i.test(line)) return false;
      if (/^All quotes from /i.test(line)) return false;
      if (/^\*\*Original (?:key words|language details):\*\*/i.test(line)) return false;
      if (/^[-*]\s*(Hebrew|Greek):/i.test(line)) return false;
      if (/^\s*Meaning:/i.test(line)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return summary || undefined;
}

// ---------------------------------------------------------------------------
// Structured response payload
// ---------------------------------------------------------------------------

export function buildStructuredResponsePayload(
  content: string,
  verses: VerseContext[],
  translation: string
): StructuredChatResponse | undefined {
  const analysisSummary = extractAnalysisSummary(content);
  const sections = verses
    .map((verse) => buildStructuredVerseResponse(verse, translation))
    .filter((section): section is NonNullable<ReturnType<typeof buildStructuredVerseResponse>> => Boolean(section));

  return compactStructuredChatResponse({
    ...(analysisSummary ? { analysis: { summary: analysisSummary } } : {}),
    sections,
  });
}

// ---------------------------------------------------------------------------
// Main response normalizer
// ---------------------------------------------------------------------------

export function normalizeResponseContent(content: string, verses: VerseContext[]): string {
  if (!content || !content.trim()) return content;

  let normalized = content.replace(/\r\n/g, '\n').trim();

  normalized = normalized
    .replace(/^\s*[-*]?\s*Reference\s*:\s*(.+)$/gim, (_match, ref) => `- **${String(ref).trim()}**`)
    .replace(/^\s*[-*]?\s*Ref(?:erence)?\s*-\s*(.+)$/gim, (_match, ref) => `- **${String(ref).trim()}**`)
    .replace(/^\s*([-*]\s*)?\*\*Original (?:key words|language details):?\*\*\s*$/gim, '**Original language details:**');

  const lines = normalized.split('\n');
  const output: string[] = [];
  let inOriginalBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const formattedArtifact = formatMorphArtifactLine(line);
    if (formattedArtifact) {
      if (formattedArtifact.length > 0) output.push(...formattedArtifact);
      continue;
    }

    if (/^\*\*Original (?:key words|language details):\*\*$/i.test(trimmed)) {
      inOriginalBlock = true;
      output.push('**Original language details:**');
      continue;
    }

    const startsNewVerse =
      /^[-*]\s*["\u201c]/.test(trimmed) ||
      /^[-*]\s*\*\*[A-Z0-9]{2,}\s+\d+:\d+/.test(trimmed) ||
      /^Textual conclusion/i.test(trimmed) ||
      /^All quotes from/i.test(trimmed);

    if (inOriginalBlock && startsNewVerse) inOriginalBlock = false;

    if (inOriginalBlock && /^[-*]\s+/.test(trimmed)) {
      output.push(normalizeOriginalKeywordLine(line));
      continue;
    }

    output.push(line);
  }

  normalized = output.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (!/\*\*[A-Z0-9]{2,}\s+\d+:\d+(?:[-–]\d+)?/.test(normalized) && verses.length > 0) {
    const refs = verses.map((verse) => `- **${verse.reference} (${verse.translation})**`).join('\n');
    normalized = `${normalized}\n\n${refs}`.trim();
  }

  if (!/\*\*Original (?:key words|language details):\*\*/i.test(normalized)) {
    const originalSections = verses
      .map((verse) => ({
        verse,
        entries: normalizeOriginalLanguageEntries(verse.original),
      }))
      .filter(({ entries }) => entries.length > 0)
      .slice(0, 4)
      .map(({ verse, entries }) => {
        const words = entries
          .slice(0, 6)
          .map((entry) => {
            const language = entry.strongs.toUpperCase().startsWith('H') ? 'Hebrew' : 'Greek';
            const label = entry.transliteration
              ? `${language}: ${entry.word} (${entry.strongs}; ${entry.transliteration})`
              : `${language}: ${entry.word} (${entry.strongs})`;
            return `- ${label}\n  Meaning: ${entry.meaning}`;
          })
          .join('\n');
        return `- **${verse.reference}**\n**Original language details:**\n${words}`;
      })
      .join('\n\n');

    if (originalSections) normalized = `${normalized}\n\n${originalSections}`.trim();
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Context utilization diagnostics
// ---------------------------------------------------------------------------

export function logContextUtilizationDiagnostics(
  content: string,
  verses: VerseContext[],
  options?: { requestId?: string; modelUsed?: string | null; cacheHit?: boolean }
): void {
  if (!DEBUG_LLM) return;

  // Build whitelist from retrieved verses
  const { buildCitationWhitelist } = require('@/lib/prompts');
  const retrievedWhitelist = new Set<string>();
  for (const citation of buildCitationWhitelist(verses)) {
    const normalized = citation.trim().toLowerCase();
    if (normalized) retrievedWhitelist.add(normalized);
  }

  const citedWhitelist = new Set(
    (content.match(/(?<![1-3]\s)\b(?:[1-3][A-Z]{2}|[A-Z]{2,3})\s+\d+:\d+(?:[-–]\d+)?\b/g) || [])
      .map((c) => expandCitationReference(c.trim()).toLowerCase())
      .filter((c) => retrievedWhitelist.has(c))
  );

  const retrievedCount = retrievedWhitelist.size;
  const citedCount = citedWhitelist.size;
  const citationUtilization = retrievedCount > 0 ? Number((citedCount / retrievedCount).toFixed(2)) : 0;

  console.info(JSON.stringify({
    event: 'context_utilization',
    requestId: options?.requestId,
    modelUsed: options?.modelUsed,
    cacheHit: options?.cacheHit ?? false,
    retrieved_count: retrievedCount,
    cited_count: citedCount,
    citation_utilization: citationUtilization,
  }));
}

// ---------------------------------------------------------------------------
// Cached-response streaming
// ---------------------------------------------------------------------------

export async function streamTextFromContent(
  text: string,
  messages: Array<{ role: string; content: string }>,
  preferredChunks?: string[]
) {
  const chunkText = (input: string): string[] => {
    const chunks: string[] = [];
    const maxChunkLength = 220;
    let cursor = 0;
    while (cursor < input.length) {
      chunks.push(input.slice(cursor, cursor + maxChunkLength));
      cursor += maxChunkLength;
    }
    return chunks.length > 0 ? chunks : [input];
  };

  const chunks =
    Array.isArray(preferredChunks) && preferredChunks.length > 0
      ? preferredChunks
      : chunkText(text);
  const textDeltas = chunks.map((delta) => ({ type: 'text-delta', id: 'text-1', delta }));

  const cachedStreamModel = {
    specificationVersion: 'v3',
    provider: 'cache',
    modelId: 'cache',
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          ...textDeltas,
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: text.length, text: text.length, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  };

  return streamText({ model: cachedStreamModel as any, messages: messages as any });
}
