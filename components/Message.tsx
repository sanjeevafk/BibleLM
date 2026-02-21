'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { OriginalLangBlock } from './OriginalLangBlock';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UIMessage } from 'ai';

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

export const Message = React.memo(function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);
  const messageText = getMessageText(message);

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const processedContent = React.useMemo(() => {
    const preprocessContent = (text: string) => {
      // Convert `<orig ... />` XML block to markdown codeblock we can intercept.
      const rx = /<orig word="([^"]*)" translit="([^"]*)" strongs="([^"]*)" gloss="([^"]*)" \/>/g;
      const xmlProcessed = text.replace(rx, (match, word, translit, strongs, gloss) => {
        return '```orig|' + word + '|' + (translit || '') + '|' + strongs + '|' + (gloss || '') + '```';
      });

      const lines = xmlProcessed.split(/\r?\n/);
      let inOriginalBlock = false;
      
      const outLines = lines.map((line) => {
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        const trimmedLine = line.trim();

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
        const glossMatch = details.match(/-\s*(.+)$/);
        let gloss = glossMatch ? glossMatch[1].trim() : '';
        if (gloss.startsWith('[') && gloss.endsWith(']')) {
          gloss = gloss.slice(1, -1);
        }

        const beforeStrongs = details.split(/Strong's\s+[A-Z]?\d+/i)[0] || '';
        const translit = beforeStrongs.replace(/[\s,]+$/g, '').trim();

        return indent + '- ```orig|' + word + '|' + translit + '|' + strongs + '|' + gloss + '```';
      });

      return outLines.join('\n');
    };
    return preprocessContent(messageText);
  }, [messageText]);

  return (
    <div className={`flex w-full my-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`relative flex flex-col max-w-[85%] md:max-w-[75%] px-4 py-3 rounded-2xl ${
          isUser 
            ? 'bg-blue-600 text-white rounded-br-sm shadow-md' 
            : 'bg-muted text-foreground border rounded-bl-sm shadow-sm'
        }`}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed overflow-x-visible">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              p({ children }) {
                // Safely extract text for the disclaimer check
                const text = React.Children.toArray(children)
                  .map(child => (typeof child === 'string' ? child : ''))
                  .join('');
                  
                if (text.includes('All quotes from') && text.includes('OSHB')) {
                  return <p className="text-[10px] text-muted-foreground mt-4 pt-2 border-t font-sans tracking-wide uppercase opacity-70">{children}</p>;
                }
                return <p className="mb-4 last:mb-0 leading-relaxed">{children}</p>;
              },
              li({ children }) {
                const text = React.Children.toArray(children)
                  .map(child => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
                  .join('')
                  .trim();
                
                const isOriginalWord = text.includes('orig|');
                // More robust reference detection: Look for 3-letter book code at start or within parentheses
                const isReference = /([A-Z0-9]{3})\s\d+:\d+/i.test(text);

                if (isOriginalWord) {
                  return <li className="list-none inline-block mr-1 my-1">{children}</li>;
                }

                if (isReference && text.length < 40) {
                  return <li className="list-none text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-2 mb-3 px-1 border-l-2 border-muted-foreground/20 ml-1">{children}</li>;
                }

                // Verse detection: starts with quote, or long text in a list that isn't a reference/orig block
                if (text.startsWith('"') || text.startsWith('“') || (text.length > 50 && !text.includes('**Original key words:**'))) {
                  return (
                    <li className="list-none bible-verse border-l-4 border-primary/20 bg-primary/5 pl-5 pr-3 py-4 my-6 rounded-r-xl shadow-sm transition-all hover:border-primary/40">
                      {children}
                    </li>
                  );
                }

                return <li className="mb-3 ml-4 list-disc marker:text-muted-foreground/50">{children}</li>;
              },
              strong({ children }) {
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
                    />
                  );
                }
                
                return <code className={`bg-black/10 dark:bg-white/10 rounded px-1.5 py-0.5 font-mono text-[13px] ${className || ''}`} {...rest}>{children}</code>;
              }
            }}
          >
            {processedContent}
          </ReactMarkdown>

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

