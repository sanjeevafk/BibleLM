export type VerseContext = {
  reference: string;
  translation: string;
  text: string;
  original: Array<{ word: string; strongs: string; gloss?: string }>;
};

// HelloAO gives us books by these long codes or short abbreviations usually matching.
export async function fetchTranslations() {
  try {
    const res = await fetch('https://bible.helloao.org/api/available_translations.json');
    if (!res.ok) throw new Error('Failed to fetch translations');
    const data = await res.json();
    return data.translations || [];
  } catch (error) {
    console.warn('Could not fetch helloao translations, falling back to defaults', error);
    return [
      { shortName: 'WEB', name: 'World English Bible' },
      { shortName: 'KJV', name: 'King James Version' },
    ];
  }
}

// Format: /api/{translation}/{book}/{chapter}.json
export async function fetchVerseHelloAO(
  translation: string,
  book: string,
  chapter: number,
  startVerse: number,
  endVerse?: number
): Promise<string | null> {
  try {
    const res = await fetch(`https://bible.helloao.org/api/${translation}/${book}/${chapter}.json`);
    if (!res.ok) return null;
    
    const data = await res.json();
    if (!data?.chapter?.content) return null;
    
    let text = '';
    const end = endVerse || startVerse;
    
    for (const item of data.chapter.content) {
      if (item.type === 'verse' && item.number >= startVerse && item.number <= end) {
        const verseText = item.content.map((c: unknown) => typeof c === 'string' ? c : '').join('').trim();
        text += verseText + ' ';
      }
    }
    
    return text.trim() || null;
  } catch (error) {
    console.error('HelloAO fetch error:', error);
    return null;
  }
}

// Fallback to fetch from bible-api.com
export async function fetchVerseFallback(reference: string, translation: string = 'web'): Promise<string | null> {
  try {
    // bible-api.com expects 'john 3:16'
    const res = await fetch(`https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation.toLowerCase()}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.text ? data.text.trim().replace(/\n/g, ' ') : null;
  } catch (error) {
    console.error('Fallback fetch error:', error);
    return null;
  }
}

export async function fetchStrongsDefinition(strongs: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://bolls.life/dictionary-definition/BDBT/${strongs}/`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Bolls diff fetch error:', error);
    return null;
  }
}
