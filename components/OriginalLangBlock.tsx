'use client';

import React from 'react';
import { decodeMorph } from '@/lib/morph-utils';
import { getMorphForVerse } from '@/lib/morphhb-client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface OriginalLangProps {
  word: string;
  translit?: string;
  strongs: string;
  gloss?: string;
  morph?: string;
  ref?: string;
}

export const OriginalLangBlock = React.memo(function OriginalLangBlock({ word, translit, strongs, gloss, morph, ref }: OriginalLangProps) {
  const [resolvedMorph, setResolvedMorph] = React.useState<string | undefined>(morph);
  const [attemptedFetch, setAttemptedFetch] = React.useState(false);
  
  // Determine if hebrew based on strongs code starting with H
  const isHebrew = strongs.startsWith('H');
  const langClass = isHebrew ? 'hebrew-text' : 'greek-text';
  const bollsLink = `https://bolls.life/dictionary/${isHebrew ? 'BDBT' : 'BDBT'}/${strongs}`;
  const morphValue = resolvedMorph ?? morph;
  const canFetchMorph = Boolean(isHebrew && ref && !morphValue);
  const decodedMorph = morphValue ? decodeMorph(morphValue) : null;

  React.useEffect(() => {
    setResolvedMorph(morph);
  }, [morph]);

  React.useEffect(() => {
    if (!canFetchMorph || attemptedFetch || morphValue) return;
    setAttemptedFetch(true);

    const normalizeHebrew = (input: string) =>
      input.replace(/[\u0591-\u05C7]/g, '').replace(/[^\u0590-\u05FF]/g, '');

    getMorphForVerse(ref as string)
      .then((words) => {
        if (!words) return;
        const normWord = normalizeHebrew(word);
        const exact = words.find((w) => w.s === strongs && normalizeHebrew(w.t) === normWord);
        const byStrongs = words.find((w) => w.s === strongs);
        const byWord = words.find((w) => normalizeHebrew(w.t) === normWord);
        const match = exact || byStrongs || byWord;
        if (match?.m) {
          setResolvedMorph(match.m);
        }
      })
      .catch(() => {
        // Silent: fallback to existing data
      });
  }, [attemptedFetch, canFetchMorph, morphValue, ref, strongs, word]);
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          dir={isHebrew ? 'rtl' : 'ltr'}
          className={`${langClass} cursor-pointer underline underline-offset-4 decoration-dotted font-semibold text-primary/90 bg-transparent border-0 p-0 appearance-none`}
        >
          {word}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,22rem)] max-h-[72vh] overflow-y-auto space-y-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span dir={isHebrew ? 'rtl' : 'ltr'} className={`${langClass} text-base font-bold bg-primary/5 px-2 py-1 rounded-md border border-primary/10`}>{word}</span>
          <a
            href={bollsLink}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-mono text-muted-foreground underline underline-offset-2 shrink-0"
          >
            {strongs}
          </a>
        </div>
        {translit && (
          <div className="text-[11px] text-muted-foreground italic break-words">{translit}</div>
        )}
        {gloss && (
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gloss</div>
            <div className="leading-relaxed break-words [overflow-wrap:anywhere]">{gloss}</div>
          </div>
        )}
        <div className="rounded-md border bg-muted/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Strong's</div>
          <div className="font-mono text-[11px]">
            <a href={bollsLink} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-primary/90">
              {strongs}
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
