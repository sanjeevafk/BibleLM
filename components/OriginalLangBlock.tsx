'use client';

import React from 'react';
import { decodeMorph } from '@/lib/morph-utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface OriginalLangProps {
  word: string;
  translit?: string;
  strongs: string;
  gloss?: string;
  morph?: string;
  verseRef?: string;
}

export const OriginalLangBlock = React.memo(function OriginalLangBlock({ word, translit, strongs, gloss, morph }: OriginalLangProps) {
  const normalizedWord = word?.trim() || '';
  const normalizedStrongs = strongs?.trim() || '';
  const normalizedGloss = gloss?.trim() || '';
  
  // Determine if hebrew based on strongs code starting with H
  const isHebrew = normalizedStrongs.startsWith('H');
  const langClass = isHebrew ? 'hebrew-text' : 'greek-text';
  const bollsLink = `https://bolls.life/dictionary/${isHebrew ? 'BDBT' : 'TGNT'}/${normalizedStrongs}`;
  const morphValue = morph?.trim() || '';
  const decodedMorph = morphValue ? decodeMorph(morphValue) : null;

  if (!normalizedWord || !normalizedStrongs) {
    return null;
  }
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          dir={isHebrew ? 'rtl' : 'ltr'}
          className={`${langClass} cursor-pointer underline underline-offset-4 decoration-dotted font-semibold text-primary/90 bg-transparent border-0 p-0 appearance-none`}
        >
          {normalizedWord}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,22rem)] max-h-[72vh] overflow-y-auto space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span dir={isHebrew ? 'rtl' : 'ltr'} className={`${langClass} text-base font-bold bg-primary/5 px-2 py-1 rounded-md border border-primary/10`}>{normalizedWord}</span>
          <a
            href={bollsLink}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-mono text-muted-foreground underline underline-offset-2 shrink-0"
          >
            {normalizedStrongs}
          </a>
        </div>
        {translit && (
          <div className="text-[11px] text-muted-foreground italic break-words">{translit}</div>
        )}
        {normalizedGloss && (
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Meaning</div>
            <div className="leading-relaxed break-words [overflow-wrap:anywhere]">{normalizedGloss}</div>
          </div>
        )}
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Strong&#39;s</div>
          <div className="font-mono text-[11px]">
            <a href={bollsLink} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-primary/90">
              {normalizedStrongs}
            </a>
          </div>
        </div>
        {morphValue && (
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Morph</div>
            <div className="font-mono text-[11px] text-primary/90">{morphValue}</div>
            {decodedMorph?.description && (
              <div className="text-[10px] text-muted-foreground mt-1 break-words [overflow-wrap:anywhere]">{decodedMorph.description}</div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});
