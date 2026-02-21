'use client';

import React from 'react';

export interface OriginalLangProps {
  word: string;
  translit?: string;
  strongs: string;
  gloss?: string;
}

export function OriginalLangBlock({ word, translit, strongs, gloss }: OriginalLangProps) {
  const [showTooltip, setShowTooltip] = React.useState(false);
  
  // Determine if hebrew based on strongs code starting with H
  const isHebrew = strongs.startsWith('H');
  const langClass = isHebrew ? 'hebrew-text' : 'greek-text';
  const bollsLink = `https://bolls.life/dictionary/${isHebrew ? 'BDBT' : 'BDBT'}/${strongs}`;
  
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
    </div>
  );
}


