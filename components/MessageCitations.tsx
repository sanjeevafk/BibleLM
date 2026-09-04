'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { OriginalLangBlock } from './OriginalLangBlock';
import type { StructuredOriginalLanguageEntry } from '@/lib/verse-response';
import { buildMarkdownComponents } from './MessageContent';

export type VerseBlock = {
  id: string;
  reference: string | null;
  shortQuote: string;
  markdown: string;
  verseText?: string;
  translation?: string;
  analysisSummary?: string;
  originalLanguage?: StructuredOriginalLanguageEntry[];
  peshitta?: string;
};

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

function hasMeaningfulOriginalLanguageMarkdown(markdown: string): boolean {
  const normalized = markdown
    .replace(/\*\*Original (?:key words|language details):\*\*/gi, '')
    .replace(/[-*]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Boolean(normalized);
}

function hasStructuredOriginalLanguageEntries(entries: StructuredOriginalLanguageEntry[] | undefined): boolean {
  return Array.isArray(entries) && entries.length > 0 && entries.some((e) => Boolean(e?.word && e?.strongs));
}

function stripMarkdownForCopy(text: string): string {
  return text.replace(/\*\*|\*|__|_|`|~~|#|> /g, '');
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

interface MessageCitationsProps {
  blocks: VerseBlock[];
  preamble?: string;
  fallbackSummary?: string;
}

export function MessageCitations({ blocks, preamble, fallbackSummary }: MessageCitationsProps) {
  const [copiedVerseId, setCopiedVerseId] = React.useState<string | null>(null);
  const markdownComponents = React.useMemo(() => buildMarkdownComponents(), []);

  const handleCopyVerse = React.useCallback(async (block: VerseBlock) => {
    if (!navigator?.clipboard?.writeText) return;
    const copyText = stripMarkdownForCopy(block.markdown);
    try {
      await navigator.clipboard.writeText(copyText);
      setCopiedVerseId(block.id);
      setTimeout(() => setCopiedVerseId((current) => (current === block.id ? null : current)), 1600);
    } catch (err) {
      // Silently fail on clipboard rejection or log if preferred
      console.warn('Failed to copy verse:', err);
    }
  }, []);

  if (blocks.length === 0) return null;

  return (
    <div className="mt-8 space-y-6">
      {blocks.map((block) => {
        const section = splitOriginalLanguageSection(block.markdown);
        const hasStructuredOriginal = hasStructuredOriginalLanguageEntries(block.originalLanguage);
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
                      Original Words &amp; Meanings
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

              {block.peshitta && (
                <div className="mt-3 rounded-lg border border-border/40 bg-muted/20 p-3">
                  <div className="flex items-center justify-between text-[10px] font-mono font-medium text-muted-foreground/70 uppercase tracking-wider mb-1.5">
                    <span>Syriac Peshitta (Aramaic NT)</span>
                  </div>
                  <p className="font-serif text-sm sm:text-base text-foreground/90 leading-relaxed text-right font-normal" dir="rtl">
                    {block.peshitta}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
