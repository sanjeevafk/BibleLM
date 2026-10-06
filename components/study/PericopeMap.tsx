'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
  buildPericopeSegments,
  type PericopeLike,
} from '@/lib/study-utils';

type PericopeMapProps<T extends PericopeLike = PericopeLike> = {
  pericopes: T[];
  totalVerses: number;
  activePericopeId?: string;
  focusVerse?: number;
  onSelectPericope?: (pericope: T | null) => void;
};

const GAP_STYLES =
  'bg-muted/40 text-muted-foreground/60 border-border/40 hover:bg-muted/70';
const PERICOPE_STYLES =
  'bg-primary/10 text-primary border-primary/25 hover:bg-primary/20';
const ACTIVE_STYLES =
  'bg-primary/25 text-primary border-primary/60 ring-1 ring-primary/40';

/**
 * PericopeMap — Sankey-style proportional chapter timeline. Segment widths
 * reflect `(endVerse - startVerse + 1) / totalChapterVerses`. Clicking a
 * segment scrolls the parallel grid to that passage.
 */
export function PericopeMap<T extends PericopeLike = PericopeLike>({
  pericopes,
  totalVerses,
  activePericopeId,
  focusVerse,
  onSelectPericope,
}: PericopeMapProps<T>) {
  const segments = React.useMemo(
    () => buildPericopeSegments(pericopes, totalVerses),
    [pericopes, totalVerses]
  );

  if (segments.length === 0) return null;

  const hasPericopes = segments.some((s) => s.pericope !== null);

  return (
    <div aria-label="Chapter pericope story map">
      <div
        role="list"
        aria-label="Story sections in this chapter"
        className="flex w-full items-stretch gap-1 overflow-x-auto pb-1"
      >
        {segments.map((segment) => {
          const isActive = segment.pericope
            ? segment.pericope.id === activePericopeId
            : false;
          const containsFocus =
            focusVerse !== undefined &&
            focusVerse >= segment.startVerse &&
            focusVerse <= segment.endVerse;
          const label =
            segment.pericope?.title ||
            (segment.startVerse === segment.endVerse
              ? `v${segment.startVerse}`
              : `v${segment.startVerse}–${segment.endVerse}`);
          return (
            <button
              key={segment.pericope ? segment.pericope.id : `gap-${segment.startVerse}-${segment.endVerse}`}
              type="button"
              role="listitem"
              title={
                segment.pericope
                  ? `${segment.pericope.title} (${segment.pericope.reference})`
                  : `Verses ${segment.startVerse}–${segment.endVerse}`
              }
              aria-label={
                segment.pericope
                  ? `${segment.pericope.title}, verses ${segment.startVerse} to ${segment.endVerse}${isActive ? ', selected' : ''}`
                  : `Verses ${segment.startVerse} to ${segment.endVerse}`
              }
              aria-pressed={segment.pericope ? isActive : undefined}
              onClick={() => onSelectPericope?.(segment.pericope)}
              style={{ flexGrow: Math.max(segment.widthPct, 4), flexBasis: 0, minWidth: 44 }}
              className={cn(
                'group flex min-h-[52px] flex-col justify-center gap-0.5 overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-colors',
                segment.pericope ? PERICOPE_STYLES : GAP_STYLES,
                isActive && ACTIVE_STYLES,
                containsFocus && !isActive && 'ring-1 ring-primary/30'
              )}
            >
              <span className="truncate text-[11px] font-semibold leading-tight">
                {label}
              </span>
              <span className="whitespace-nowrap text-[10px] leading-tight opacity-70">
                v{segment.startVerse}–{segment.endVerse}
              </span>
            </button>
          );
        })}
      </div>
      {!hasPericopes && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          No story sections catalogued for this chapter yet.
        </p>
      )}
    </div>
  );
}
