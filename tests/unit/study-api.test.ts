import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

import {
  clearStudyCache,
  fetchStrongsDetail,
  fetchStudyChapter,
} from '@/lib/study-api';
import { clearStudyDataCache, setStudyFetchImpl } from '@/lib/study-data';

const TRANSLATIONS_INDEX = {
  BSB: { LUK: 'bsb-LUK.json' },
  KJV: { LUK: 'kjv-LUK.json' },
};

const BSB_LUK = {
  '10': {
    '24': 'For I tell you that many prophets and kings desired to see what you see, and did not see it.',
    '25': 'One day an expert in the law stood up to test Him.',
  },
};

const KJV_LUK = {
  '10': {
    '25': 'And, behold, a certain lawyer stood up, and tempted him.',
  },
};

const INTERLINEAR_LUK_10 = {
  verses: {
    '25': [
      { w: 'Καὶ', s: 'G2532', tr: 'kaí', g: 'And' },
      { w: 'νομικός', s: 'G3544', tr: 'nomikós', g: 'a lawyer', m: 'A-NSM' },
    ],
  },
};

const STRONGS_DICT = {
  G4541: { lexeme: 'Σαμαρείτης', transliteration: 'Samareítēs', short_definition: 'Samaritan' },
};

function stubFetch(url: string) {
  const routes: Record<string, unknown> = {
    '/data/translations-index.json': TRANSLATIONS_INDEX,
    '/data/translations/bsb-LUK.json': BSB_LUK,
    '/data/translations/kjv-LUK.json': KJV_LUK,
    '/data/interlinear/LUK-10.json': INTERLINEAR_LUK_10,
    '/data/strongs-dict.json': STRONGS_DICT,
  };
  const payload = routes[url];
  if (payload === undefined) {
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) });
}

beforeEach(() => {
  clearStudyCache();
  clearStudyDataCache();
  setStudyFetchImpl(stubFetch);
});

afterEach(() => {
  setStudyFetchImpl(null);
});

describe('fetchStudyChapter (static assets)', () => {
  it('assembles primary, secondary, interlinear, and pericopes', async () => {
    const chapter = await fetchStudyChapter('LUK', 10, 'BSB', 'KJV');
    expect(chapter?.book).toBe('LUK');
    expect(chapter?.verseCount).toBe(42);
    expect(chapter?.verses).toHaveLength(42);
    expect(chapter?.verses[24].primary).toContain('expert in the law');
    expect(chapter?.verses[24].secondary).toContain('certain lawyer');
    expect(chapter?.verses[24].interlinear[1]).toMatchObject({ w: 'νομικός', strongs: 'G3544' });
    expect(chapter?.pericopes.map((p) => p.id)).toContain('parable-good-samaritan');
  });

  it('caches repeat calls without refetching', async () => {
    const spy = vi.fn(stubFetch);
    setStudyFetchImpl(spy);
    const first = await fetchStudyChapter('LUK', 10, 'BSB', 'KJV');
    const second = await fetchStudyChapter('LUK', 10, 'BSB', 'KJV');
    expect(second).toBe(first);
    // index + 2 translation books + interlinear file, each fetched once.
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('returns null when chapter text is unavailable', async () => {
    setStudyFetchImpl(() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })
    );
    await expect(fetchStudyChapter('LUK', 10)).resolves.toBeNull();
  });
});

describe('fetchStrongsDetail (static dict)', () => {
  it('normalizes ids and caches dictionary entries', async () => {
    const spy = vi.fn(stubFetch);
    setStudyFetchImpl(spy);
    const first = await fetchStrongsDetail('g4541');
    const second = await fetchStrongsDetail('G4541');
    expect(first?.short_definition).toBe('Samaritan');
    expect(second).toBe(first);
    expect(spy.mock.calls.filter(([url]) => String(url).includes('strongs'))).toHaveLength(1);
  });

  it('returns null for malformed ids without fetching', async () => {
    const spy = vi.fn(stubFetch);
    setStudyFetchImpl(spy);
    await expect(fetchStrongsDetail('nope')).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
