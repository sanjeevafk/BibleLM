'use client';

import React from 'react';
import { InterlinearWordTooltip } from './InterlinearWordTooltip';
import type { StudyPericope, StudyVerse } from '@/lib/study-api';
import { isVerseInFocus } from '@/lib/study-utils';
import { cn } from '@/lib/utils';

type ParallelVerseGridProps = {
  verses: StudyVerse[];
  primaryLabel: string;
  secondaryLabel: string;
  showSecondary: boolean;
  showInterlinear: boolean;
  focusVerse: number;
  focusEndVerse?: number;
  activePericope?: StudyPericope | null;
  isRtlPrimary?: boolean;
};

/**
 * ParallelVerseGrid — synchronized multi-column reader. Verse-by-verse rows
 * keep the primary translation, comparison translation, and original-language
 * interlinear aligned; the focused citation range stays highlighted.
 */
export const ParallelVerseGrid = React.memo(function ParallelVerseGrid({
  verses,
  primaryLabel,
  secondaryLabel,
  showSecondary,
  showInterlinear,
  focusVerse,
  focusEndVerse,
  activePericope,
  isRtlPrimary = false,
}: ParallelVerseGridProps) {
  const focus = React.useMemo(
    () => ({ verse: focusVerse, endVerse: focusEndVerse }),
    [focusVerse, focusEndVerse]
  );

  if (verses.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No verse text available for this chapter.
      </div>
    );
  }

  return (
    <ol aria-label="Parallel chapter reader" className="divide-y divide-border/40">
      {verses.map((row) => {
        const inCitationFocus = isVerseInFocus(row.verse, focus);
        const inPericopeFocus =
          activePericope !== null &&
          activePericope !== undefined &&
          row.verse >= activePericope.startVerse &&
          row.verse <= activePericope.endVerse;
        return (
          <li
            key={row.verse}
            data-verse={row.verse}
            aria-current={inCitationFocus ? 'true' : undefined}
            className={cn(
              'scroll-mt-32 px-3 py-3 transition-colors sm:px-4',
              inCitationFocus && 'border-l-2 border-l-primary bg-primary/[0.07]',
              !inCitationFocus && inPericopeFocus && 'bg-primary/[0.03]'
            )}
          >
            <div className="flex items-baseline gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'shrink-0 font-mono text-[11px] font-semibold',
                  inCitationFocus ? 'text-primary' : 'text-muted-foreground/70'
                )}
              >
                {row.verse}
              </span>
              {inCitationFocus && (
                <span className="sr-only">(cited passage)</span>
              )}
            </div>

            <div className={cn('mt-1.5 grid gap-3', showSecondary && 'md:grid-cols-2 md:gap-4')}>
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60">
                  {primaryLabel}
                </div>
                <p
                  dir={isRtlPrimary ? 'rtl' : 'ltr'}
                  className="bible-verse text-[15px] leading-relaxed text-foreground/90"
                >
                  {row.primary ?? <span className="text-muted-foreground/60">—</span>}
                </p>
              </div>
              {showSecondary && (
                <div>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60">
                    {secondaryLabel}
                  </div>
                  <p className="bible-verse text-[15px] leading-relaxed text-foreground/80">
                    {row.secondary ?? <span className="text-muted-foreground/60">—</span>}
                  </p>
                </div>
              )}
            </div>

            {showInterlinear && row.interlinear.length > 0 && (
              <div className="mt-2 rounded-lg border border-border/40 bg-muted/20 p-2">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60">
                  Original language
                </div>
                <p className="flex flex-wrap gap-x-1.5 gap-y-1 text-[15px] leading-relaxed">
                  {row.interlinear.map((token, idx) => (
                    <InterlinearWordTooltip
                      key={`${token.strongs}-${idx}`}
                      token={token}
                    />
                  ))}
                </p>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
});
