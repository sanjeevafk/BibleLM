import { loadJsonDataset, resolveDatasetPath } from './base';

export type VerseGenre =
  | 'law'
  | 'historical'
  | 'poetic'
  | 'prophetic'
  | 'gospel'
  | 'epistle'
  | 'apocalyptic';

export type VerseMetadata = {
  verseId: string;
  testament: 'OT' | 'NT';
  genre: VerseGenre;
  themeTags: string[];
};

const VERSE_METADATA_PATH = resolveDatasetPath('data', 'verse-metadata.json');
let verseMetadataMapPromise: Promise<Map<string, VerseMetadata>> | null = null;

export async function loadElianwongVerseMetadata(): Promise<VerseMetadata[]> {
  const data = await loadJsonDataset<VerseMetadata[]>('elianwong:verse-metadata', [VERSE_METADATA_PATH]);
  return Array.isArray(data) ? data : [];
}

export async function getVerseMetadataMap(): Promise<Map<string, VerseMetadata>> {
  if (verseMetadataMapPromise) {
    return verseMetadataMapPromise;
  }

  verseMetadataMapPromise = (async () => {
    try {
      const data = await loadElianwongVerseMetadata();
      return new Map(data.filter((entry) => entry?.verseId).map((entry) => [entry.verseId, entry]));
    } catch (error) {
      verseMetadataMapPromise = null;
      throw error;
    }
  })();

  return verseMetadataMapPromise;
}

export async function getVerseMetadataEntry(verseId: string): Promise<VerseMetadata | null> {
  const metadata = await getVerseMetadataMap();
  return metadata.get(verseId) || null;
}
