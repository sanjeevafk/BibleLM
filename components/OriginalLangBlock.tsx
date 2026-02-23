'use client';

import React from 'react';
import { decodeMorph } from '@/lib/morph-utils';
import { getMorphForVerse } from '@/lib/morphhb-client';

export interface OriginalLangProps {
  word: string;
  translit?: string;
  strongs: string;
  gloss?: string;
  morph?: string;
  ref?: string;
}

export const OriginalLangBlock = React.memo(function OriginalLangBlock({ word, translit, strongs, gloss, morph, ref }: OriginalLangProps) {
  const [showTooltip, setShowTooltip] = React.useState(false);
  const [showGrammar, setShowGrammar] = React.useState(false);
  const [resolvedMorph, setResolvedMorph] = React.useState<string | undefined>(morph);
  const [attemptedFetch, setAttemptedFetch] = React.useState(false);
  
  // Determine if hebrew based on strongs code starting with H
  const isHebrew = strongs.startsWith('H');
  const langClass = isHebrew ? 'hebrew-text' : 'greek-text';
  const bollsLink = `https://bolls.life/dictionary/${isHebrew ? 'BDBT' : 'BDBT'}/${strongs}`;
  const canFetchMorph = Boolean(isHebrew && ref && !morphValue);
  const morphValue = resolvedMorph ?? morph;
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
    <div 
      className="relative inline-flex items-center gap-2 px-2 py-1 m-0.5 bg-card border rounded-lg shadow-sm hover:shadow-md transition-all group cursor-help select-none"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex flex-col items-start leading-tight">
        <span className={`${langClass} text-base font-bold text-primary`}>{word}</span>
        {translit && (
          <span className="text-[10px] text-muted-foreground italic font-sans">{translit}</span>
        )}
      </div>

      <div className="h-6 w-px bg-border mx-1" />

      <div className="flex items-center gap-1.5">
        <a 
          href={bollsLink} 
          target="_blank" 
          rel="noreferrer"
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold transition-colors ${
            isHebrew 
              ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' 
              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {strongs}
        </a>
        {(morphValue || canFetchMorph) && (
          <button
            type="button"
            className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setShowGrammar((prev) => !prev);
            }}
          >
            Grammar
          </button>
        )}
      </div>

      {showTooltip && gloss && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-popover text-popover-foreground text-[11px] rounded-xl border shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="font-bold mb-1 border-b pb-1 flex justify-between items-center capitalize">
            <span>Definition</span>
            <span className="text-[9px] text-muted-foreground font-mono">{strongs}</span>
          </div>
          <div className="leading-relaxed">
            {gloss}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-popover" />
        </div>
      )}

      {showGrammar && morphValue && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-56 p-3 bg-popover text-popover-foreground text-[11px] rounded-xl border shadow-xl z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="font-bold mb-1 border-b pb-1 flex justify-between items-center uppercase tracking-wide">
            <span>Grammar</span>
            <span className="text-[9px] text-muted-foreground font-mono">{morphValue}</span>
          </div>
          <div className="leading-relaxed">
            {decodedMorph ? decodedMorph.description : 'Morphology code unavailable'}
          </div>
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-8 border-transparent border-b-popover" />
        </div>
      )}
    </div>
  );
});
