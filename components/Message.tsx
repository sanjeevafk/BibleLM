'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { OriginalLangBlock } from './OriginalLangBlock';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UIMessage } from 'ai';

function getMessageText(message: UIMessage): string {
  const legacyContent = (message as { content?: unknown }).content;
  if (typeof legacyContent === 'string') return legacyContent;
  if (!Array.isArray(message.parts)) return '';

  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

export function Message({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = React.useState(false);
  const messageText = getMessageText(message);

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const preprocessContent = (text: string) => {
    // Convert `<orig ... />` XML block to markdown codeblock we can intercept.
    const rx = /<orig word="([^"]*)" translit="([^"]*)" strongs="([^"]*)" gloss="([^"]*)" \/>/g;
    const xmlProcessed = text.replace(rx, (match, word, translit, strongs, gloss) => {
      return '```orig|' + word + '|' + (translit || '') + '|' + strongs + '|' + (gloss || '') + '```';
    });

    // Convert plain markdown "Original key words" bullets into the same codeblock format.
    const lines = xmlProcessed.split(/\r?\n/);
    let inOriginalBlock = false;
    const outLines = lines.map((line) => {
      if (/^\s*\*\*Original key words:\*\*/i.test(line)) {
        inOriginalBlock = true;
        return line;
      }

      if (inOriginalBlock && line.trim() === '') {
        inOriginalBlock = false;
        return line;
      }

      if (!inOriginalBlock) return line;

      const trimmed = line.trim();
      if (!trimmed.startsWith('- ')) return line;

      const content = trimmed.slice(2).trim();
      const match = content.match(/^(.+?)\s*\((.+)\)\s*$/);
      if (!match) return line;

      const word = match[1].trim();
      const details = match[2];
      const strongsMatch = details.match(/Strong's\s+([A-Z]?\d+)/i);
      if (!strongsMatch) return line;

      const strongs = strongsMatch[1];
      const glossMatch = details.match(/-\s*(.+)$/);
      const gloss = glossMatch ? glossMatch[1].trim() : '';
      const beforeStrongs = details.split(/Strong's\s+[A-Z]?\d+/i)[0] || '';
      const translit = beforeStrongs.replace(/[\s,]+$/g, '').trim();

      return '```orig|' + word + '|' + translit + '|' + strongs + '|' + gloss + '```';
    });

    return outLines.join('\n');
  };

  const processedContent = preprocessContent(messageText);

  return (
    <div className={`flex w-full my-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`relative flex flex-col max-w-[85%] md:max-w-[75%] px-4 py-3 rounded-2xl ${
          isUser 
            ? 'bg-blue-600 text-white rounded-br-sm' 
            : 'bg-muted text-foreground border rounded-bl-sm'
        }`}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed overflow-x-auto">
          <ReactMarkdown 
            remarkPlugins={[remarkGfm]}
            components={{
              code(props: { children?: React.ReactNode; className?: string; [key: string]: unknown } | any) {
                const { children, className, ...rest } = props;
                const text = String(children);
                
                // Catch our special orig encoding
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
                
                return <code className={`bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 ${className || ''}`} {...rest}>{children}</code>;
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
}
