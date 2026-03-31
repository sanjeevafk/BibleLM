'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { OriginalLangBlock } from './OriginalLangBlock';
import { Copy, Check, Quote, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UIMessage } from 'ai';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { VerseContext } from '@/lib/bible-fetch';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  hasStructuredOriginalLanguage,
  normalizeOriginalLanguageEntries,
  type StructuredChatResponse,
  type StructuredOriginalLanguageEntry,
  type StructuredVerseResponse,
} from '@/lib/verse-response';

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

type VerseBlock = {
  id: string;
  reference: string | null;
  shortQuote: string;
  markdown: string;
  verseText?: string;
  translation?: string;
  analysisSummary?: string;
  originalLanguage?: StructuredOriginalLanguageEntry[];
};

type MessageMetadata = {
  modelUsed?: string;
  fallbackUsed?: boolean;
  finalFallback?: boolean;
  verses?: VerseContext[];
  metadata?: {
    translation?: string;
  };
  response?: StructuredChatResponse;
};

function extractReference(lines: string[]): string | null {
  const joined = lines.join(' ');
  const match = joined.match(/([1-3]?[A-Z]{2,3}\s+\d+:\d+(?:[-–]\d+)?)/);
  if (!match) return null;
  return match[1].replace('–', '-');
}

function stripOuterQuotes(text: string): string {
  const trimmed = text.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('“') && trimmed.endsWith('”'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function shortenQuote(text: string, max = 90): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
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
    ) {
      return false;
    }
    return true;
  };

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
      if (isVerseStartLine(next)) {
        break;
      }
      if (!next.trim()) {
        blockLines.push(next);
        i += 1;
        continue;
      }
      if (/^\S/.test(next) && !next.startsWith('- ') && !next.startsWith('* ')) {
        break;
      }
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

function splitOriginalLanguageSection(markdown: string): { main: string; original: string } {
  const lines = markdown.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /\*\*Original (?:key words|language details):\*\*/i.test(line.trim()));
  if (startIndex === -1) {
    return { main: markdown.trim(), original: '' };
  }

  const main = lines.slice(0, startIndex).join('\n').trim();
  const original = lines.slice(startIndex).join('\n').trim();
  return { main, original };
}

function stripMarkdownForCopy(text: string): string {
  return text
    .replace(/\*\*|\*|__|_|`|~~|#|> /g, '');
}

function hasMeaningfulOriginalLanguageMarkdown(markdown: string): boolean {
  const normalized = markdown
    .replace(/\*\*Original (?:key words|language details):\*\*/gi, '')
    .replace(/[-*]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return Boolean(normalized);
}

function renderStructuredOriginalLanguage(entries: StructuredOriginalLanguageEntry[], verseRef?: string) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
      {entries.map((entry, index) => (
        <div key={`${entry.word}-${entry.strongs}-${index}`} className="group relative overflow-hidden rounded-lg border border-border/40 bg-muted/20 p-2.5 transition-all hover:border-primary/20 hover:bg-muted/30">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <OriginalLangBlock
                word={entry.word}
                translit={entry.transliteration}
                strongs={entry.strongs}
                gloss={entry.meaning}
                verseRef={verseRef}
              />
              <span className="text-[10px] font-mono text-muted-foreground/60">{entry.strongs}</span>
            </div>
            <div className="text-xs font-medium text-foreground/80 line-clamp-2 leading-snug">{entry.meaning}</div>
            {entry.transliteration && (
              <div className="text-[10px] italic text-muted-foreground/70">{entry.transliteration}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export const Message = React.memo(function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);
  const [copiedVerseId, setCopiedVerseId] = React.useState<string | null>(null);
  const messageText = getMessageText(message);
  const metadata = (message as any).metadata as MessageMetadata | undefined;
  const verses = metadata?.verses;
  const structuredResponse = metadata?.response;
  
  const structuredSections = React.useMemo(() => {
    if (!Array.isArray(structuredResponse?.sections)) {
      return [];
    }
    return structuredResponse.sections.filter((section) => Boolean(section?.verse?.reference && section?.verse?.text));
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

  const handleCopyVerse = React.useCallback((block: VerseBlock) => {
    const copyText = stripMarkdownForCopy(block.markdown);
    navigator.clipboard.writeText(copyText);
    setCopiedVerseId(block.id);
    setTimeout(() => setCopiedVerseId((current) => (current === block.id ? null : current)), 1600);
  }, []);

  const processedContent = React.useMemo(() => {
    const preprocessContent = (text: string) => {
      // Convert `<orig ... />` XML block to markdown codeblock we can intercept.
      const rx = /<orig word="([^"]*)" translit="([^"]*)" strongs="([^"]*)" gloss="([^"]*)"(?: morph="([^"]*)")? \/>/g;
      const xmlProcessed = text.replace(rx, (match, word, translit, strongs, gloss, morph) => {
        return '```orig|' + word + '|' + (translit || '') + '|' + strongs + '|' + (gloss || '') + '|' + (morph || '') + '|```';
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
        if (word.startsWith('[') && word.endsWith(']')) {
          word = word.slice(1, -1);
        }
        
        const details = match[2];
        const strongsMatch = details.match(/Strong's\s+([A-Z]?\d+)/i);
        if (!strongsMatch) return line;

        const strongs = strongsMatch[1];
        const morphMatch = details.match(/Morph:\s*([A-Za-z0-9/]+)/i);
        const glossMatch = details.match(/-\s*(.+)$/);
        let gloss = glossMatch ? glossMatch[1].trim() : '';
        if (gloss.startsWith('[') && gloss.endsWith(']')) {
          gloss = gloss.slice(1, -1);
        }
        if (morphMatch) {
          gloss = gloss.replace(/Morph:.*$/i, '').trim();
        }
        gloss = gloss.replace(/[,;]\s*$/g, '').trim();

        const beforeStrongs = details.split(/Strong's\s+[A-Z]?\d+/i)[0] || '';
        const translit = beforeStrongs.replace(/[\s,]+$/g, '').trim();

        const morph = morphMatch ? morphMatch[1] : '';
        const refPart = morph ? '' : (currentRef || '');
        return indent + '- ```orig|' + word + '|' + translit + '|' + strongs + '|' + gloss + '|' + morph + '|' + refPart + '```';
      });

      return outLines.join('\n');
    };
    return preprocessContent(messageText);
  }, [messageText]);

  const { preamble, blocks, postamble } = React.useMemo(
    () => parseVerseBlocks(processedContent),
    [processedContent]
  );
  const fallbackSummary = structuredResponse?.analysis?.summary?.trim() || '';
  
  const verseBlocks = React.useMemo(() => {
    if (structuredSections.length > 0) {
      return buildBlocksFromStructuredResponse(structuredSections);
    }
    if (blocks.length > 0) {
      return blocks;
    }
    if (metadataVerses.length > 0) {
      return buildBlocksFromMetadata(metadataVerses);
    }
    return [];
  }, [blocks, metadataVerses, structuredSections]);

  const markdownComponents: Components = {
    p({ children }) {
      const text = React.Children.toArray(children)
        .map(child => (typeof child === 'string' ? child : ''))
        .join('')
        .trim();
        
      if (text.includes('All quotes from') && text.includes('OSHB')) {
        return <p className="text-[10px] text-muted-foreground/60 mt-4 pt-3 border-t font-sans tracking-tight uppercase opacity-80 break-words">{children}</p>;
      }
      
      // Standalone quotes (not in cards)
      if (
        (text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith('“') && text.endsWith('”'))
      ) {
        return (
          <div className="relative my-4 pl-5 border-l-2 border-primary/30 py-1 italic text-foreground/90 font-serif leading-relaxed text-[1.1rem]">
            <Quote className="absolute -left-1 -top-1 h-3 w-3 text-primary/20 rotate-180" />
            {children}
          </div>
        );
      }
      return <p className="mb-4 last:mb-0 leading-relaxed text-foreground/90">{children}</p>;
    },
    blockquote({ children }) {
      return <blockquote className="my-5 border-l-3 border-primary pl-5 py-2 font-serif italic text-foreground/80 bg-muted/10 rounded-r-lg leading-relaxed">{children}</blockquote>;
    },
    li({ children }) {
      const text = React.Children.toArray(children)
        .map(child => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
        .join('')
        .trim();
      
      const isOriginalWord = text.includes('orig|');
      const isReference = /([A-Z0-9]{3})\s\d+:\d+/i.test(text);

      if (isOriginalWord) {
        return <li className="list-none inline-flex flex-wrap gap-1.5 my-1.5 max-w-full">{children}</li>;
      }

      if (isReference && text.length < 50) {
        return (
          <li className="list-none group flex items-center gap-2 text-[11px] font-bold text-muted-foreground/70 uppercase tracking-widest mt-6 mb-3 px-3 py-1 bg-muted/20 border-l border-primary/40 rounded-r-md transition-all hover:bg-muted/30">
            <BookOpen className="h-2.5 w-2.5" />
            {children}
          </li>
        );
      }

      return <li className="mb-3 ml-5 list-disc marker:text-primary/40 text-foreground/90 leading-relaxed">{children}</li>;
    },
    strong({ children }) {
      const text = React.Children.toArray(children)
        .map(child => (typeof child === 'string' ? child : ''))
        .join('');
      if (text.includes('Original key words:') || text.includes('Original language details:')) {
        return <span className="block text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 mt-8 pb-1.5 border-b border-border/60">{children}</span>;
      }
      return <strong className="font-semibold text-foreground/95">{children}</strong>;
    },
    code(props) {
      const { children, className, ...rest } = props;
      const text = String(children);
      
      if (text.startsWith('orig|')) {
        const parts = text.split('|');
        if (!parts[1]?.trim() || !parts[3]?.trim() || !parts[4]?.trim()) {
          return null;
        }
        return (
          <OriginalLangBlock 
            word={parts[1]} 
            translit={parts[2]} 
            strongs={parts[3]} 
            gloss={parts[4]} 
            morph={parts[5]} 
            verseRef={parts[6]} 
          />
        );
      }
      
      return <code className={`bg-muted rounded px-1.5 py-0.5 font-mono text-[0.85em] ${className || ''}`} {...rest}>{children}</code>;
    }
  };

  return (
    <div className={`group flex w-full my-6 animate-in fade-in slide-in-from-bottom-2 duration-300 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`relative flex flex-col max-w-[94%] sm:max-w-[85%] md:max-w-[82%] px-0 py-0 rounded-2xl transition-all duration-200 ${
          isUser 
            ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-br-sm shadow-md hover:shadow-lg px-4 py-3' 
            : 'bg-card text-foreground border border-border/50 shadow-sm hover:shadow-md'
        }`}
      >
        <div className={`text-sm sm:text-[15px] leading-relaxed break-words [overflow-wrap:anywhere] ${!isUser && 'px-5 py-4 sm:px-6 sm:py-5'}`}>
          {(preamble || fallbackSummary) && (
            <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {preamble || fallbackSummary}
              </ReactMarkdown>
            </div>
          )}

          {verseBlocks.length > 0 && (
            <div className="mt-8 space-y-6">
              {verseBlocks.map((block, idx) => {
                const section = splitOriginalLanguageSection(block.markdown);
                const hasStructuredOriginal = hasStructuredOriginalLanguage(block.originalLanguage);
                const hasMarkdownOriginal = hasMeaningfulOriginalLanguageMarkdown(section.original);
                const verseCopied = copiedVerseId === block.id;
                
                return (
                  <Card key={block.id} className="group/card overflow-hidden border-border/40 bg-muted/5 transition-all hover:bg-muted/10 hover:border-border/80 shadow-none border">
                    <CardHeader className="space-y-4 px-4 sm:px-6 pb-2 pt-5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-serif text-sm font-semibold tracking-tight text-primary">
                          <span className="h-5 w-0.5 bg-primary/40 rounded-full" />
                          {block.reference || 'Verse'}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 opacity-0 group-hover/card:opacity-100 transition-opacity"
                          onClick={() => handleCopyVerse(block)}
                          title="Copy reference and text"
                        >
                          {verseCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground/60" />}
                        </Button>
                      </div>
                      <p className="bible-verse text-lg leading-relaxed text-foreground/90">
                        &quot;{block.shortQuote}&quot;
                      </p>
                    </CardHeader>
                    <CardContent className="px-4 sm:px-6 pb-5 pt-0 space-y-4">
                      {section.main && (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground/90 leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {section.main}
                          </ReactMarkdown>
                        </div>
                      )}

                      {block.analysisSummary && block.analysisSummary !== (preamble || fallbackSummary) && (
                        <p className="text-sm leading-relaxed text-muted-foreground/90 border-t border-border/40 pt-4 mt-4 italic">{block.analysisSummary}</p>
                      )}

                      {hasStructuredOriginal || hasMarkdownOriginal ? (
                        <Accordion type="single" className="w-full border-t border-border/40 mt-4">
                          <AccordionItem value={`${block.id}-orig`} className="border-b-0">
                            <AccordionTrigger className="py-3 px-1 text-[10px] sm:text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground/60 hover:text-primary transition-colors hover:no-underline">
                              Original Words & Meanings
                            </AccordionTrigger>
                            <AccordionContent className="px-0 pt-1 pb-2">
                              {hasStructuredOriginal ? (
                                renderStructuredOriginalLanguage(block.originalLanguage || [], block.reference || undefined)
                              ) : (
                                <div className="prose prose-sm dark:prose-invert max-w-none px-1">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                    {section.original}
                                  </ReactMarkdown>
                                </div>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {postamble && (
            <div className="mt-8 prose prose-sm sm:prose-base dark:prose-invert max-w-none border-t border-border/40 pt-6">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {postamble}
              </ReactMarkdown>
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
