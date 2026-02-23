type MorphWord = {
  t: string;
  s: string;
  m: string;
};

type BookData = Record<string, Record<string, MorphWord[]>>;

const morphCache = new Map<string, BookData>();

export async function getMorphForVerse(ref: string): Promise<MorphWord[] | null> {
  const cleaned = ref.trim();
  const rangeBase = cleaned.split('-')[0];
  let bookRaw = '';
  let chapterRaw = '';
  let verseRaw = '';

  const dotMatch = rangeBase.match(/^([A-Za-z0-9]{3})\.(\d+)\.(\d+)$/);
  if (dotMatch) {
    bookRaw = dotMatch[1];
    chapterRaw = dotMatch[2];
    verseRaw = dotMatch[3];
  } else {
    const spaceMatch = rangeBase.match(/^([A-Za-z0-9]{3})\s*(\d+):(\d+)$/);
    if (spaceMatch) {
      bookRaw = spaceMatch[1];
      chapterRaw = spaceMatch[2];
      verseRaw = spaceMatch[3];
    }
  }

  if (!bookRaw || !chapterRaw || !verseRaw) return null;

  const book = bookRaw.toUpperCase();
  if (!morphCache.has(book)) {
    const res = await fetch(`/api/morphhb/${book}.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as BookData;
    morphCache.set(book, data);
  }

  const data = morphCache.get(book);
  if (!data) return null;
  return data[chapterRaw]?.[verseRaw] || null;
}
