'use client';

import React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fetchStrongsDetail, type StudyToken } from '@/lib/study-api';
import { cn } from '@/lib/utils';

type InterlinearWordTooltipProps = {
  token: StudyToken;
  className?: string;
};

/**
 * InterlinearWordTooltip — interactive lexical tooltip over original-language
 * tokens. Shows Strong's code, script, transliteration, morphology, and the
 * dictionary definition (lazy-fetched, cached).
 */
export const InterlinearWordTooltip = React.memo(function InterlinearWordTooltip({
  token,
  className,
}: InterlinearWordTooltipProps) {
  const [detail, setDetail] = React.useState<{
    short_definition?: string;
    definition?: string;
    transliteration?: string;
    lexeme?: string;
  } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const isHebrew = token.strongs.toUpperCase().startsWith('H');

  const handleOpen = React.useCallback(() => {
    if (detail || loading) return;
    setLoading(true);
    void fetchStrongsDetail(token.strongs).then((result) => {
      setDetail(result);
      setLoading(false);
    });
  }, [detail, loading, token.strongs]);

  const definition = detail?.short_definition || detail?.definition || token.gloss;
  const transliteration = detail?.transliteration || token.transliteration;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          dir={isHebrew ? 'rtl' : 'ltr'}
          onClick={handleOpen}
          onMouseEnter={handleOpen}
          onFocus={handleOpen}
          aria-label={`${token.w}, ${token.strongs}${token.gloss ? `, meaning ${token.gloss}` : ''}`}
          className={cn(
            isHebrew ? 'hebrew-text' : 'greek-text',
            'cursor-pointer rounded px-0.5 font-semibold text-primary/90 underline decoration-dotted underline-offset-4',
            'hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50',
            className
          )}
        >
          {token.w}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,22rem)] max-h-[72vh] space-y-2 overflow-y-auto text-xs">
        <div className="flex items-center justify-between gap-2">
          <span
            dir={isHebrew ? 'rtl' : 'ltr'}
            className={cn(
              isHebrew ? 'hebrew-text' : 'greek-text',
              'rounded-md border border-primary/10 bg-primary/5 px-2 py-1 text-base font-bold'
            )}
          >
            {detail?.lexeme || token.w}
          </span>
          <a
            href={`https://bolls.life/dictionary/${isHebrew ? 'BDBT' : 'TGNT'}/${token.strongs.toUpperCase()}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 font-mono text-[10px] text-muted-foreground underline underline-offset-2"
          >
            {token.strongs.toUpperCase()}
          </a>
        </div>
        {transliteration && (
          <div className="break-words text-[11px] italic text-muted-foreground">{transliteration}</div>
        )}
        {token.morph && (
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Morphology</div>
            <div className="font-mono text-[11px] text-primary/90">{token.morph}</div>
          </div>
        )}
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Meaning</div>
          {loading ? (
            <div className="text-muted-foreground">Loading definition…</div>
          ) : definition ? (
            <div className="break-words leading-relaxed [overflow-wrap:anywhere]">{definition}</div>
          ) : (
            <div className="text-muted-foreground">No definition available.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});
