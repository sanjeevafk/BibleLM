'use client';

import React from 'react';

export interface OriginalLangProps {
  word: string;
  translit?: string;
  strongs: string;
  gloss?: string;
}

export function OriginalLangBlock({ word, translit, strongs, gloss }: OriginalLangProps) {
  // Determine if hebrew based on strongs code starting with H
  const isHebrew = strongs.startsWith('H');
  const langClass = isHebrew ? 'hebrew-text' : 'greek-text';
  const bollsLink = `https://bolls.life/dictionary/${isHebrew ? 'BDBT' : 'BDBT'}/${strongs}`;
  
  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 m-0.5 bg-card border rounded-lg shadow-sm hover:shadow-md transition-shadow group">
      <div className="flex flex-col items-start leading-tight">
        <span className={`${langClass} text-base font-bold text-primary`}>{word}</span>
        {translit && (
          <span className="text-[10px] text-muted-foreground italic font-sans">{translit}</span>
        )}
      </div>

      <div className="h-6 w-px bg-border mx-1" />

      <div className="flex flex-col gap-0.5">
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
          >
            {strongs}
          </a>
          {gloss && (
            <span className="text-[11px] font-medium text-foreground/80 max-w-[120px] truncate" title={gloss}>
              {gloss}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

