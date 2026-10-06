'use client';

import React from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PericopeMap } from './PericopeMap';
import { ParallelVerseGrid } from './ParallelVerseGrid';
import {
  fetchStudyChapter,
  prefetchAdjacentChapters,
  type StudyChapter,
} from '@/lib/study-api';
import {
  chapterCount,
  findActivePericope,
  toDisplayRef,
  type StudyVerseRef,
} from '@/lib/study-utils';
import { cn } from '@/lib/utils';

export const STUDY_TRANSLATIONS = ['BSB', 'KJV', 'WEB', 'ASV', 'NHEB'] as const;

type StudyPaneProps = {
  target: StudyVerseRef & { pericopeId?: string };
  primary: string;
  secondary: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
  onClose: () => void;
  onNavigateChapter: (delta: -1 | 1) => void;
  onFocusPericope: (pericopeId: string | undefined, startVerse?: number, endVerse?: number) => void;
};

function scrollToVerse(verse: number): void {
  if (typeof document === 'undefined') return;
  // Both the desktop split view and the mobile drawer can be mounted at
  // once (one CSS-hidden), so pick the visible row.
  const candidates = Array.from(document.querySelectorAll(`[data-verse="${verse}"]`));
  const visible = candidates.find((el) => (el as HTMLElement).offsetParent !== null) ?? candidates[0];
  visible?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * StudyPane — split-pane / drawer container for parallel study. Owns chapter
 * fetching (cached), pericope selection, translation toggles, and scroll
 * synchronization between the story map and the verse grid.
 */
export function StudyPane({
  target,
  primary,
  secondary,
  onPrimaryChange,
  onSecondaryChange,
  onClose,
  onNavigateChapter,
  onFocusPericope,
}: StudyPaneProps) {
  const [chapter, setChapter] = React.useState<StudyChapter | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [showSecondary, setShowSecondary] = React.useState(true);
  const [showInterlinear, setShowInterlinear] = React.useState(true);
  const scrollerRef = React.useRef<HTMLDivElement>(null);

  const { book, chapter: chapterNum, verse, endVerse, pericopeId } = target;
  const maxChapter = chapterCount(book);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void fetchStudyChapter(book, chapterNum, primary, secondary).then((result) => {
      if (cancelled) return;
      if (!result) {
        setChapter(null);
        setLoadError(`Could not load ${book} ${chapterNum}. Check your connection and try again.`);
      } else {
        setChapter(result);
        prefetchAdjacentChapters(book, chapterNum, primary, secondary, maxChapter || chapterNum + 1);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [book, chapterNum, primary, secondary, maxChapter]);

  const activePericope = React.useMemo(() => {
    if (!chapter) return null;
    if (pericopeId) {
      const byId = chapter.pericopes.find((p) => p.id === pericopeId) ?? null;
      if (byId) return byId;
    }
    return findActivePericope(chapter.pericopes, verse);
  }, [chapter, pericopeId, verse]);

  // Scroll the focused citation into view once chapter text arrives.
  React.useEffect(() => {
    if (!chapter || loading) return;
    const timer = window.setTimeout(() => scrollToVerse(verse), 120);
    return () => window.clearTimeout(timer);
  }, [chapter, loading, verse, chapterNum, book]);

  // Escape closes the pane; arrow keys move chapters when focus is in header.
  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Yield to open lexical tooltips/popovers so Escape dismisses them
      // first instead of tearing down the whole pane.
      if (document.querySelector('[role="dialog"]')) return;
      onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const canPrev = chapterNum > 1;
  const canNext = maxChapter === 0 || chapterNum < maxChapter;

  return (
    <section
      aria-label={`Study pane, ${book} chapter ${chapterNum}`}
      className="flex h-full min-h-0 flex-col bg-card"
    >
      {/* Header controls */}
      <header className="shrink-0 border-b bg-card/95 backdrop-blur">
        <div className="flex items-center gap-1.5 px-3 py-2 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onNavigateChapter(-1)}
            disabled={!canPrev || loading}
            aria-label="Previous chapter"
            title="Previous chapter"
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 text-center leading-tight">
            <div className="truncate font-serif text-base font-bold tracking-tight sm:text-lg">
              {book} {chapterNum}
            </div>
            <div className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">
              {toDisplayRef({ book, chapter: chapterNum, verse, endVerse })}
              {activePericope ? ` · ${activePericope.title}` : ''}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onNavigateChapter(1)}
            disabled={!canNext || loading}
            aria-label="Next chapter"
            title="Next chapter"
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close study pane"
            title="Close study pane"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/40 px-3 py-2 sm:px-4">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="uppercase tracking-wider">Primary</span>
            <select
              value={primary}
              onChange={(e) => onPrimaryChange(e.target.value)}
              aria-label="Primary translation"
              className="h-7 cursor-pointer rounded-md border border-input bg-background px-1.5 text-[11px] font-semibold text-foreground"
            >
              {STUDY_TRANSLATIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="uppercase tracking-wider">Compare</span>
            <select
              value={secondary}
              onChange={(e) => onSecondaryChange(e.target.value)}
              aria-label="Comparison translation"
              className="h-7 cursor-pointer rounded-md border border-input bg-background px-1.5 text-[11px] font-semibold text-foreground"
            >
              {STUDY_TRANSLATIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={showSecondary}
              onClick={() => setShowSecondary((v) => !v)}
              className={cn(
                'rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                showSecondary ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
              )}
            >
              2nd
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={showInterlinear}
              onClick={() => setShowInterlinear((v) => !v)}
              className={cn(
                'rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
                showInterlinear ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
              )}
            >
              <span className="inline-flex items-center gap-1">
                <BookOpen className="h-3 w-3" />
                Interlinear
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading {book} {chapterNum}…
          </div>
        ) : loadError || !chapter ? (
          <div className="mx-4 mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-center text-sm text-destructive">
            {loadError ?? 'Chapter unavailable.'}
          </div>
        ) : (
          <div className="space-y-3 px-3 py-3 sm:px-4">
            <PericopeMap
              pericopes={chapter.pericopes}
              totalVerses={chapter.verseCount}
              activePericopeId={activePericope?.id}
              focusVerse={verse}
              onSelectPericope={(p) => {
                if (!p) {
                  onFocusPericope(undefined);
                  return;
                }
                onFocusPericope(p.id, p.startVerse, p.endVerse);
                window.setTimeout(() => scrollToVerse(p.startVerse), 60);
              }}
            />
            <ParallelVerseGrid
              verses={chapter.verses}
              primaryLabel={chapter.primary}
              secondaryLabel={chapter.secondary}
              showSecondary={showSecondary}
              showInterlinear={showInterlinear}
              focusVerse={verse}
              focusEndVerse={endVerse}
              activePericope={activePericope}
            />
          </div>
        )}
      </div>
    </section>
  );
}
