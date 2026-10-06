'use client';

import React from 'react';
import {
  chapterCount,
  parseStudyRef,
  toDisplayRef,
  toStudyParam,
  type StudyVerseRef,
} from '@/lib/study-utils';

export type StudyTarget = StudyVerseRef & { pericopeId?: string };

function readFromUrl(): StudyTarget | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const study = params.get('study');
  if (!study) return null;
  const ref = parseStudyRef(study);
  if (!ref) return null;
  const pericopeId = params.get('pericope') || undefined;
  return { ...ref, pericopeId };
}

function writeToUrl(target: StudyTarget | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!target) {
    url.searchParams.delete('study');
    url.searchParams.delete('pericope');
  } else {
    url.searchParams.set('study', toStudyParam(target));
    if (target.pericopeId) {
      url.searchParams.set('pericope', target.pericopeId);
    } else {
      url.searchParams.delete('pericope');
    }
  }
  window.history.replaceState(null, '', url.toString());
}

/**
 * Owns Study Pane state: the focused citation/pericope, open/closed, and
 * shareable `?study=` / `?pericope=` URL synchronization.
 */
export function useStudyPane() {
  const [target, setTarget] = React.useState<StudyTarget | null>(() => readFromUrl());

  // Deep-link support: opening a shared URL lands directly in study mode.
  React.useEffect(() => {
    setTarget(readFromUrl());
  }, []);

  const openStudy = React.useCallback((reference: string, pericopeId?: string) => {
    const ref = parseStudyRef(reference);
    if (!ref) return false;
    const next: StudyTarget = { ...ref, pericopeId };
    setTarget(next);
    writeToUrl(next);
    return true;
  }, []);

  const closeStudy = React.useCallback(() => {
    setTarget(null);
    writeToUrl(null);
  }, []);

  const navigateChapter = React.useCallback(
    (delta: -1 | 1) => {
      setTarget((current) => {
        if (!current) return current;
        const nextChapter = current.chapter + delta;
        const max = chapterCount(current.book);
        if (nextChapter < 1 || (max > 0 && nextChapter > max)) return current;
        const next: StudyTarget = {
          book: current.book,
          chapter: nextChapter,
          verse: 1,
          pericopeId: undefined,
        };
        writeToUrl(next);
        return next;
      });
    },
    []
  );

  const focusVerse = React.useCallback((verse: number, endVerse?: number) => {
    setTarget((current) => {
      if (!current) return current;
      const next: StudyTarget = { ...current, verse, endVerse, pericopeId: current.pericopeId };
      writeToUrl(next);
      return next;
    });
  }, []);

  const focusPericope = React.useCallback((pericopeId: string | undefined, startVerse?: number, endVerse?: number) => {
    setTarget((current) => {
      if (!current) return current;
      const next: StudyTarget = {
        ...current,
        pericopeId,
        verse: startVerse ?? current.verse,
        endVerse: endVerse ?? current.endVerse,
      };
      writeToUrl(next);
      return next;
    });
  }, []);

  const displayRef = React.useMemo(() => (target ? toDisplayRef(target) : null), [target]);

  return {
    target,
    isOpen: target !== null,
    displayRef,
    openStudy,
    closeStudy,
    navigateChapter,
    focusVerse,
    focusPericope,
  };
}

export type UseStudyPane = ReturnType<typeof useStudyPane>;
