'use client';

import React from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UIMessage } from 'ai';
import type { VerseContext } from '@/lib/bible-fetch';
import {
  hasStructuredOriginalLanguage,
  normalizeOriginalLanguageEntries,
  type StructuredChatResponse,
  type StructuredVerseResponse,
} from '@/lib/verse-response';
import { MessageContent, buildMarkdownComponents } from './MessageContent';
import { MessageCitations, type VerseBlock } from './MessageCitations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMessageText(message: UIMessage): string {
  const m = message as any;
  if (typeof m.content === 'string') return m.content;
  if (typeof m.text === 'string') return m.text;

  if (Array.isArray(m.content)) {
    return m.content
      .map((part: any) => (typeof part === 'string' ? part : part.text || part.value || ''))
      .join('');
  }

  if (Array.isArray(m.parts)) {
    return m.parts
      .map((part: any) => (part.text || part.value || (part.type === 'text' ? part.text : '')))
      .join('');
  }

  return '';
}

function extractReference(lines: string[]): string | null {
  const joined = lines.join(' ');
  const match = joined.match(/([1-3]?[A-Z]{2,3}\s+\d+:\d+(?:[-\u2013]\d+)?)/);
  if (!match) return null;
  return match[1].replace('\u2013', '-');
}

function stripOuterQuotes(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\u201c') && trimmed.endsWith('\u201d'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function shortenQuote(text: string, max = 90): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\u2026`;
}

// Exported for unit tests.
export function isVerseStartLine(value: string): boolean {
  const trimmed = value.trimStart();
  const lower = trimmed.toLowerCase();

  // Must be a list item.
  if (!trimmed.startsWith('- ')) return false;

  // Exclusions checked first.
  if (
    lower.startsWith('- reference') ||
    lower.startsWith('- **original key words') ||
    lower.startsWith('- **original language details') ||
    lower.startsWith('- hebrew:') ||
    lower.startsWith('- greek:') ||
    lower.startsWith('- meaning:') ||
    lower.startsWith('- original key words') ||
    lower.startsWith('- original language details')
  ) {
    return false;
  }

  // Stricter positive check: the content after '- ' must either
  //   (a) open with a quotation mark  — e.g. - "In the beginning…"
  //   (b) begin with a recognisable verse reference — e.g. - JHN 3:16 or - 1 Cor 13:4
  const rest = trimmed.slice(2); // drop '- '
  const startsWithQuote = /^["'\u2018\u2019\u201C\u201D]/.test(rest);
  // Optional leading digit (e.g. "1 ") for numbered books, then 2+ letter book name,
  // optional period, space, chapter digits, colon, verse digits.
  const startsWithReference = /^(?:\d\s+)?[A-Za-z]{2,}\.?\s+\d+:\d+/.test(rest);

  return startsWithQuote || startsWithReference;
}

function parseVerseBlocks(content: string): {
  preamble: string;
  blocks: VerseBlock[];
  postamble: string;
} {
  const lines = content.split(/\r?\n/);
  const preambleLines: string[] = [];
  const postambleLines: string[] = [];
  const blocks: VerseBlock[] = [];
  let i = 0;
  let inVerseSection = false;

  while (i < lines.length) {
    const line = lines[i];
    const isVerseStart = isVerseStartLine(line);
    if (!isVerseStart) {
      if (!inVerseSection) {
        preambleLines.push(line);
      } else {
        postambleLines.push(line);
      }
      i += 1;
      continue;
    }

    inVerseSection = true;
    const blockLines: string[] = [line];
    i += 1;

    while (i < lines.length) {
      const next = lines[i];
      if (isVerseStartLine(next)) break;
      if (!next.trim()) {
        blockLines.push(next);
        i += 1;
        continue;
      }
      if (/^\S/.test(next) && !next.startsWith('- ') && !next.startsWith('* ')) break;
      blockLines.push(next);
      i += 1;
    }

    const quoteLine = blockLines[0].replace(/^-+\s*/, '').trim();
    const cleanedQuote = stripOuterQuotes(quoteLine);
    const blockReference = extractReference(blockLines);
    const markdownLines = [...blockLines];
    markdownLines[0] = quoteLine;

    blocks.push({
      id: `${blockReference || 'verse'}-${blocks.length + 1}`,
      reference: blockReference,
      shortQuote: shortenQuote(cleanedQuote),
      markdown: markdownLines.join('\n').trim(),
    });

    if (
      i < lines.length &&
      lines[i] &&
      /^\S/.test(lines[i]) &&
      !lines[i].startsWith('- ') &&
      !lines[i].startsWith('* ')
    ) {
      postambleLines.push(...lines.slice(i));
      break;
    }
  }

  return {
    preamble: preambleLines.join('\n').trim(),
    blocks,
    postamble: postambleLines.join('\n').trim(),
  };
}

function buildBlocksFromMetadata(verses: VerseContext[]): VerseBlock[] {
  return verses
    .filter((verse) => Boolean(verse?.text && verse?.reference))
    .map((verse, index) => {
      const originalLanguage = normalizeOriginalLanguageEntries(verse.original).slice(0, 8);
      const originalLines = originalLanguage.map((entry) => {
        const language = entry.strongs.toUpperCase().startsWith('H') ? 'Hebrew' : 'Greek';
        const label = entry.transliteration
          ? `${language}: ${entry.word} (${entry.strongs}; ${entry.transliteration})`
          : `${language}: ${entry.word} (${entry.strongs})`;
        return `- ${label}\n  Meaning: ${entry.meaning}`;
      });

      const markdownParts = [
        `"${verse.text}"`,
        `- **${verse.reference}${verse.translation ? ` (${verse.translation})` : ''}**`,
      ];

      if (originalLines.length > 0) {
        markdownParts.push('**Original language details:**');
        markdownParts.push(...originalLines);
      }

      return {
        id: `${verse.reference}-${index + 1}`,
        reference: verse.reference,
        shortQuote: shortenQuote(stripOuterQuotes(verse.text)),
        markdown: markdownParts.join('\n'),
        verseText: verse.text,
        translation: verse.translation,
        originalLanguage,
      };
    });
}

function buildBlocksFromStructuredResponse(sections: StructuredVerseResponse[]): VerseBlock[] {
  return sections
    .filter((section) => Boolean(section?.verse?.reference && section?.verse?.text))
    .map((section, index) => ({
      id: `${section.verse.reference}-${index + 1}`,
      reference: section.verse.reference,
      shortQuote: shortenQuote(stripOuterQuotes(section.verse.text)),
      markdown: `"${section.verse.text}"\n- **${section.verse.reference}${section.verse.translation ? ` (${section.verse.translation})` : ''}**`,
      verseText: section.verse.text,
      translation: section.verse.translation,
      analysisSummary: section.analysis?.summary,
      originalLanguage: section.original_language,
    }));
}

/** Preprocesses message text: converts XML `<orig />` blocks and inline original-language
 *  list items into markdown `orig|…` code tokens that MessageContent can render. */
function preprocessContent(text: string): string {
  const rx = /<orig word="([^"]*)" translit="([^"]*)" strongs="([^"]*)" gloss="([^"]*)"(?: morph="([^"]*)")? \/>/g;
  const xmlProcessed = text.replace(rx, (_, word, translit, strongs, gloss, morph) => {
    return '```orig|~|' + word + '|~|' + (translit || '') + '|~|' + strongs + '|~|' + (gloss || '') + '|~|' + (morph || '') + '|~|```';
  });

  const lines = xmlProcessed.split(/\r?\n/);
  let inOriginalBlock = false;
  let currentRef = '';

  const outLines = lines.map((line) => {
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : '';
    const trimmedLine = line.trim();
    const refMatch = trimmedLine.match(/([A-Z0-9]{3})\s+(\d+):(\d+)/i);
    if (refMatch) {
      currentRef = `${refMatch[1].toUpperCase()} ${refMatch[2]}:${refMatch[3]}`;
    }

    if (/\*\*Original (?:key words|language details):\*\*/i.test(trimmedLine)) {
      inOriginalBlock = true;
      return line;
    }

    if (inOriginalBlock && (trimmedLine === '' || trimmedLine.startsWith('- "'))) {
      inOriginalBlock = false;
      return line;
    }

    if (!inOriginalBlock) return line;
    if (!trimmedLine.startsWith('- ')) return line;

    const content = trimmedLine.slice(2).trim();
    const match = content.match(/^(.+?)\s*\((.+)\)\s*$/);
    if (!match) return line;

    let word = match[1].trim();
    if (word.startsWith('[') && word.endsWith(']')) word = word.slice(1, -1);

    const details = match[2];
    const strongsMatch = details.match(/Strong's\s+([A-Z]?\d+)/i);
    if (!strongsMatch) return line;

    const strongs = strongsMatch[1];
    const morphMatch = details.match(/Morph:\s*([A-Za-z0-9/]+)/i);
    const glossMatch = details.match(/-\s*(.+)$/);
    let gloss = glossMatch ? glossMatch[1].trim() : '';
    if (gloss.startsWith('[') && gloss.endsWith(']')) gloss = gloss.slice(1, -1);
    if (morphMatch) gloss = gloss.replace(/Morph:.*$/i, '').trim();
    gloss = gloss.replace(/[,;]\s*$/g, '').trim();

    const beforeStrongs = details.split(/Strong's\s+[A-Z]?\d+/i)[0] || '';
    const translit = beforeStrongs.replace(/[\s,]+$/g, '').trim();
    const morph = morphMatch ? morphMatch[1] : '';
    return indent + '- ```orig|~|' + word + '|~|' + translit + '|~|' + strongs + '|~|' + gloss + '|~|' + morph + '|~|' + (morph ? '' : currentRef) + '```';
  });

  return outLines.join('\n');
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageMetadata = {
  modelUsed?: string;
  fallbackUsed?: boolean;
  finalFallback?: boolean;
  verses?: VerseContext[];
  metadata?: { translation?: string };
  response?: StructuredChatResponse;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const Message = React.memo(function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);
  const messageText = getMessageText(message);
  const metadata = (message as any).metadata as MessageMetadata | undefined;
  const verses = metadata?.verses;
  const structuredResponse = metadata?.response;

  const structuredSections = React.useMemo(() => {
    if (!Array.isArray(structuredResponse?.sections)) return [];
    return structuredResponse.sections.filter(
      (section: StructuredVerseResponse) => Boolean(section?.verse?.reference && section?.verse?.text)
    );
  }, [structuredResponse]);

  const metadataVerses = React.useMemo(() => {
    if (!Array.isArray(verses)) return [];
    return verses.filter((verse): verse is VerseContext => Boolean(verse?.reference && verse?.text));
  }, [verses]);

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const processedContent = React.useMemo(() => preprocessContent(messageText), [messageText]);

  const { preamble, blocks, postamble } = React.useMemo(
    () => parseVerseBlocks(processedContent),
    [processedContent]
  );

  const fallbackSummary = structuredResponse?.analysis?.summary?.trim() || '';

  const verseBlocks = React.useMemo(() => {
    if (structuredSections.length > 0) return buildBlocksFromStructuredResponse(structuredSections);
    if (blocks.length > 0) return blocks;
    if (metadataVerses.length > 0) return buildBlocksFromMetadata(metadataVerses);
    return [];
  }, [blocks, metadataVerses, structuredSections]);

  const markdownComponents = React.useMemo(() => buildMarkdownComponents(), []);

  return (
    <div className={`group flex w-full my-6 animate-in fade-in slide-in-from-bottom-2 duration-300 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative flex flex-col max-w-[94%] sm:max-w-[85%] md:max-w-[82%] px-0 py-0 rounded-2xl transition-all duration-200 ${
          isUser
            ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-br-sm shadow-md hover:shadow-lg px-4 py-3'
            : 'bg-card text-foreground border border-border/50 shadow-sm hover:shadow-md'
        }`}
      >
        <div className={`text-sm sm:text-[15px] leading-relaxed break-words [overflow-wrap:anywhere] ${!isUser && 'px-5 py-4 sm:px-6 sm:py-5'}`}>
          {/* Preamble / analysis summary */}
          {(preamble || fallbackSummary) && (
            <MessageContent content={preamble || fallbackSummary} components={markdownComponents} />
          )}

          {/* Citation cards */}
          <MessageCitations
            blocks={verseBlocks}
            preamble={preamble}
            fallbackSummary={fallbackSummary}
          />

          {/* Postamble */}
          {postamble && (
            <div className="mt-8 border-t border-border/40 pt-6">
              <MessageContent content={postamble} components={markdownComponents} />
            </div>
          )}
        </div>

        {!isUser && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute -right-12 top-0 h-9 w-9 text-muted-foreground/40 hover:text-primary opacity-0 group-hover:opacity-100 transition-all duration-300 hover:bg-transparent"
            onClick={handleCopy}
            title="Copy whole response"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </div>
  );
});
