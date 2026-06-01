'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Quote, BookOpen } from 'lucide-react';
import { OriginalLangBlock } from './OriginalLangBlock';

/** Parses and renders the markdown content of a single chat message. */

export type MarkdownComponentsMap = Components;

export function buildMarkdownComponents(): MarkdownComponentsMap {
  const markdownComponents: Components = {
    p({ children }) {
      const text = React.Children.toArray(children)
        .map(child => (typeof child === 'string' ? child : ''))
        .join('')
        .trim();

      if (text.includes('All quotes from') && text.includes('OSHB')) {
        return <p className="text-[10px] text-muted-foreground/60 mt-4 pt-3 border-t font-sans tracking-tight uppercase opacity-80 break-words">{children}</p>;
      }

      if (
        (text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith('\u201c') && text.endsWith('\u201d'))
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

      if (text.startsWith('orig|~|')) {
        // Delimiter '|~|' is coordinated with Message.preprocessContent
        // to avoid collisions if gloss contains literal pipe characters.
        const parts = text.split('|~|');
        if (!parts[1]?.trim() || !parts[3]?.trim()) {
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
    },
  };
  return markdownComponents;
}

interface MessageContentProps {
  content: string;
  components?: Components;
}

export function MessageContent({ content, components }: MessageContentProps) {
  const mdComponents = React.useMemo(() => components ?? buildMarkdownComponents(), [components]);
  return (
    <div className="prose prose-sm sm:prose-base dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
