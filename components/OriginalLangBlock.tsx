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
    <div className="inline-flex flex-wrap items-center gap-1.5 px-2 py-1 my-1 text-sm bg-muted/50 border rounded-md shadow-sm">
      <span className={`font-medium ${langClass}`}>{word}</span>
      
      {translit && (
        <span className="text-muted-foreground italic text-xs">({translit})</span>
      )}
      
      <span className="text-muted-foreground">•</span>
      
      <a 
        href={bollsLink} 
        target="_blank" 
        rel="noreferrer"
        className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-mono"
        title="View in Dictionary"
      >
        {strongs}
      </a>
      
      {gloss && (
        <>
          <span className="text-muted-foreground">•</span>
          <span className="text-foreground text-xs">{gloss}</span>
        </>
      )}
    </div>
  );
}
