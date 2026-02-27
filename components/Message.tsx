'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { OriginalLangBlock } from './OriginalLangBlock';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UIMessage } from 'ai';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

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

  while (i < lines.length) {
    const line = lines[i];
    const isVerseStart = /^-\s*[“"]/.test(line);
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
      if (/^-\s*[“"]/.test(next)) {
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

export const Message = React.memo(function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);
  const messageText = getMessageText(message);
  const metadata = (message as any).metadata as
    | { modelUsed?: string; fallbackUsed?: boolean; finalFallback?: boolean }
    | undefined;
  const fallbackUsed = !isUser && Boolean(metadata?.fallbackUsed && metadata?.modelUsed);
  const finalFallback = !isUser && Boolean(metadata?.finalFallback);

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

        if (/\*\*Original key words:\*\*/i.test(trimmedLine)) {
          inOriginalBlock = true;
          return line;
        }

        // If we encounter a new main bullet or empty line, we might be out of the local original block
        // But we should only exit on empty line or a line that clearly starts a new verse "Full quote"
        if (inOriginalBlock && (trimmedLine === '' || trimmedLine.startsWith('- "'))) {
          inOriginalBlock = false;
          return line;
        }

        if (!inOriginalBlock) return line;

        // Handle both "- [word]" and nested "  - [word]"
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

  const markdownComponents = {
    p({ children }: { children: React.ReactNode }) {
      const text = React.Children.toArray(children)
        .map(child => (typeof child === 'string' ? child : ''))
        .join('');
        
      if (text.includes('All quotes from') && text.includes('OSHB')) {
        return <p className="text-[10px] text-muted-foreground mt-4 pt-2 border-t font-sans tracking-wide uppercase opacity-70">{children}</p>;
      }
      return <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>;
    },
    li({ children }: { children: React.ReactNode }) {
      const text = React.Children.toArray(children)
        .map(child => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
        .join('')
        .trim();
      
      const isOriginalWord = text.includes('orig|');
      const isReference = /([A-Z0-9]{3})\s\d+:\d+/i.test(text);

      if (isOriginalWord) {
        return <li className="list-none inline-flex flex-wrap gap-1 my-1">{children}</li>;
      }

      if (isReference && text.length < 50) {
        return <li className="list-none text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-2 mb-3 px-1 border-l-2 border-muted-foreground/20 ml-1">{children}</li>;
      }

      return <li className="mb-3 ml-4 list-disc marker:text-muted-foreground/50">{children}</li>;
    },
    strong({ children }: { children: React.ReactNode }) {
      const text = React.Children.toArray(children)
        .map(child => (typeof child === 'string' ? child : ''))
        .join('');
      if (text.includes('Original key words:')) {
        return <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3 mt-6 pb-1 border-b border-muted-foreground/10">{children}</span>;
      }
      return <strong className="font-bold text-primary/90">{children}</strong>;
    },
    code(props: { children?: React.ReactNode; className?: string; [key: string]: unknown } | any) {
      const { children, className, ...rest } = props;
      const text = String(children);
      
      if (text.startsWith('orig|')) {
        const parts = text.split('|');
        return (
          <OriginalLangBlock 
            word={parts[1]} 
            translit={parts[2]} 
            strongs={parts[3]} 
            gloss={parts[4]} 
            morph={parts[5]} 
            ref={parts[6]} 
          />
        );
      }
      
      return <code className={`bg-black/10 dark:bg-white/10 rounded px-1.5 py-0.5 font-mono text-[13px] ${className || ''}`} {...rest}>{children}</code>;
    }
  } as const;

  return (
    <div className={`flex w-full my-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`relative flex flex-col max-w-[85%] md:max-w-[75%] px-4 py-3 rounded-2xl ${
          isUser 
            ? 'bg-blue-600 text-white rounded-br-sm shadow-md' 
            : 'bg-muted text-foreground border rounded-bl-sm shadow-sm'
        }`}
      >
        {!isUser && (fallbackUsed || finalFallback) && (
          <div className="mb-2 rounded-md border border-muted/60 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
            {fallbackUsed && metadata?.modelUsed ? (
              <div>Using fallback model: {metadata.modelUsed}</div>
            ) : null}
            {finalFallback ? (
              <div>All providers unavailable. Showing raw verses and original-language notes instead.</div>
            ) : null}
          </div>
        )}
        <div className="text-sm leading-relaxed overflow-x-visible">
          {preamble && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {preamble}
              </ReactMarkdown>
            </div>
          )}

          {blocks.length > 0 && (
            <div className="my-4 not-prose">
              {preamble && <hr className="my-4 border-muted/40" />}
              <Accordion type="multiple" className="space-y-3">
                {blocks.map((block) => (
                  <AccordionItem key={block.id} value={block.id}>
                    <AccordionTrigger className="px-1">
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {block.reference || 'Verse'}
                        </span>
                        <span className="text-sm font-medium text-foreground">
                          “{block.shortQuote}”
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-1 border-t border-muted/30">
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {block.markdown}
                        </ReactMarkdown>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
              {postamble && <hr className="my-4 border-muted/40" />}
            </div>
          )}

          {postamble && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
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
            className="absolute -right-10 top-0 h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
            title="Copy response"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </div>
  );
});
