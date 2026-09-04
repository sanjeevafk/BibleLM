import { describe, it, expect } from 'vitest';
import { getTranslationVerse } from '@/lib/translations';
import { enrichOriginalLanguages } from '@/lib/retrieval/enrichment';
import { buildStructuredVerseResponse } from '@/lib/verse-response';

describe('Syriac Peshitta Aramaic NT Integration', () => {
  it('loads John 3:16 in Syriac Peshitta directly from local compressed datasets', async () => {
    const verse = await getTranslationVerse('JHN 3:16', 'PESHITTA');
    expect(verse).toBeTruthy();
    expect(typeof verse).toBe('string');
    // Syriac text contains the word for God (Alaha: ܐܠܗܐ)
    expect(verse).toContain('ܐܠܗܐ');
  });

  it('loads Matthew 1:1 in Syriac Peshitta', async () => {
    const verse = await getTranslationVerse('MAT 1:1', 'PESHITTA');
    expect(verse).toBeTruthy();
    expect(verse).toContain('ܝܫܘܥ'); // Yeshua
  });

  it('attaches Peshitta text to New Testament verses during enrichment', async () => {
    const verses = [
      {
        reference: 'JHN 3:16',
        translation: 'BSB',
        text: 'For God so loved the world...',
        original: [],
      },
    ];

    const enriched = await enrichOriginalLanguages(verses);
    expect(enriched[0].peshitta).toBeTruthy();
    expect(enriched[0].peshitta).toContain('ܐܠܗܐ');
  });

  it('leaves peshitta undefined for Old Testament verses', async () => {
    const verses = [
      {
        reference: 'DAN 2:4',
        translation: 'BSB',
        text: 'Then the astrologers answered the king in Aramaic...',
        original: [],
      },
    ];

    const enriched = await enrichOriginalLanguages(verses);
    expect(enriched[0].peshitta).toBeUndefined();
    // But original Aramaic words are present
    expect(enriched[0].original.length).toBeGreaterThan(0);
  });

  it('includes peshitta in structured verse response when present', () => {
    const verse = {
      reference: 'JHN 3:16',
      translation: 'BSB',
      text: 'For God so loved the world...',
      original: [],
      peshitta: 'ܗܟܢܐ ܓܝܪ ܐܚܒ ܐܠܗܐ',
    };

    const structured = buildStructuredVerseResponse(verse, 'BSB');
    expect(structured).toBeTruthy();
    expect(structured?.peshitta).toBe('ܗܟܢܐ ܓܝܪ ܐܚܒ ܐܠܗܐ');
  });
});
