import type { VerseContext } from './bible-fetch';

export type StructuredOriginalLanguageEntry = {
  word: string;
  transliteration?: string;
  strongs: string;
  meaning: string;
};

export type StructuredVerseResponse = {
  verse: {
    reference: string;
    translation: string;
    text: string;
  };
  analysis?: {
    summary: string;
  };
  original_language?: StructuredOriginalLanguageEntry[];
};

export type StructuredChatResponse = {
  analysis?: {
    summary: string;
  };
  sections: StructuredVerseResponse[];
};

const LOW_VALUE_MEANINGS = new Set(['and', 'the', 'of', 'to']);

function normalizeText(value: string | undefined | null): string {
  return value?.replace(/\s+/g, ' ').trim() || '';
}

function normalizeMeaning(value: string | undefined | null): string {
  const cleaned = normalizeText(value)
    .replace(/^[-:;,.\s]+/, '')
    .replace(/\s*Morph:.*$/i, '')
    .trim();

  if (!cleaned || cleaned.length < 2) {
    return '';
  }

  if (LOW_VALUE_MEANINGS.has(cleaned.toLowerCase())) {
    return '';
  }

  return cleaned;
}

export function normalizeOriginalLanguageEntries(
  entries: VerseContext['original'] | undefined
): StructuredOriginalLanguageEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return [];
  }

  const normalized = entries
    .map((entry) => {
      const word = normalizeText(entry?.word);
      const strongs = normalizeText(entry?.strongs);
      const meaning = normalizeMeaning(entry?.gloss);
      const transliteration = normalizeText(entry?.transliteration);

      if (!word || !strongs || !meaning) {
        return null;
      }

      return {
        word,
        strongs,
        meaning,
        ...(transliteration ? { transliteration } : {}),
      };
    })
    .filter((entry): entry is StructuredOriginalLanguageEntry => Boolean(entry));

  return Array.from(
    new Map(normalized.map((entry) => [`${entry.word}|${entry.strongs}|${entry.meaning}`, entry])).values()
  );
}

export function hasStructuredOriginalLanguage(
  entries: StructuredOriginalLanguageEntry[] | undefined
): boolean {
  return Array.isArray(entries) && entries.length > 0;
}

export function buildStructuredVerseResponse(
  verse: VerseContext,
  translationFallback: string,
  analysisSummary?: string
): StructuredVerseResponse | null {
  const reference = normalizeText(verse?.reference);
  const translation = normalizeText(verse?.translation) || translationFallback;
  const text = normalizeText(verse?.text);

  if (!reference || !translation || !text) {
    return null;
  }

  const originalLanguage = normalizeOriginalLanguageEntries(verse.original);
  const summary = normalizeText(analysisSummary);

  return {
    verse: {
      reference,
      translation,
      text,
    },
    ...(summary ? { analysis: { summary } } : {}),
    ...(originalLanguage.length > 0 ? { original_language: originalLanguage } : {}),
  };
}

export function compactStructuredChatResponse(
  response: StructuredChatResponse | undefined
): StructuredChatResponse | undefined {
  if (!response) {
    return undefined;
  }

  const summary = normalizeText(response.analysis?.summary);
  const sections = response.sections
    .map((section) => {
      const analysisSummary = normalizeText(section.analysis?.summary);
      const originalLanguage = normalizeOriginalLanguageEntries(
        section.original_language?.map((entry) => ({
          word: entry.word,
          strongs: entry.strongs,
          gloss: entry.meaning,
          transliteration: entry.transliteration,
        })) || []
      );

      return {
        verse: section.verse,
        ...(analysisSummary ? { analysis: { summary: analysisSummary } } : {}),
        ...(originalLanguage.length > 0 ? { original_language: originalLanguage } : {}),
      };
    })
    .filter((section) => Boolean(section.verse?.reference && section.verse?.translation && section.verse?.text));

  if (sections.length === 0) {
    return undefined;
  }

  return {
    ...(summary ? { analysis: { summary } } : {}),
    sections,
  };
}
