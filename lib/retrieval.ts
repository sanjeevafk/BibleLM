import { generateText, Output } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod';
import { fetchVerseHelloAO, fetchVerseFallback, fetchStrongsDefinition, VerseContext } from './bible-fetch';
import bibleIndexData from '../data/bible-index.json';
import strongsDictData from '../data/strongs-dict.json';

const BIBLE_INDEX = bibleIndexData as Record<string, VerseContext>;
const STRONGS_DICT = strongsDictData as Record<string, Record<string, string>>;

export async function retrieveContextForQuery(
  query: string,
  translation: string,
  apiKey?: string
): Promise<VerseContext[]> {
  const verses: VerseContext[] = [];

  // 1. Direct Reference Parsing (e.g., "John 3:16")
  const directRefs = extractDirectReferences(query);
  
  if (directRefs.length > 0) {
    // Attempt rapid direct fetch for parsed references
    for (const ref of directRefs) {
      const dbMatch = BIBLE_INDEX[`${ref.book} ${ref.chapter}:${ref.verse}`];
      if (dbMatch) {
         verses.push(dbMatch);
         continue;
      }
      
      const vText = await fetchVerseHelloAO(translation, ref.book, ref.chapter, ref.verse, ref.endVerse) 
                    || await fetchVerseFallback(`${ref.book} ${ref.chapter}:${ref.verse}-${ref.endVerse || ref.verse}`, translation);
      
      if (vText) {
        verses.push({
          reference: `${ref.book} ${ref.chapter}:${ref.verse}${ref.endVerse ? '-' + ref.endVerse : ''}`,
          translation: translation,
          text: vText,
          original: [] // Filled in enrichment phase
        });
      }
    }
  }

  // 2. Semantic Hint via Groq (only if direct parsing yields few results)
  if (verses.length < 2) {
    const groqApiKey = apiKey || process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      console.warn('Semantic retrieval skipped: GROQ_API_KEY is missing.');
      return enrichOriginalLanguages(verses);
    }
    const groq = createGroq({
      apiKey: groqApiKey,
    });
    try {
      const { output } = await generateText({
        model: groq('llama-3.1-8b-instant'),
        output: Output.object({
          schema: z.object({
            verses: z.array(z.object({
              bookAbbreviation: z.string().describe('3-letter book code, e.g. GEN, EXO, MAT, JHN'),
              chapter: z.number(),
              startVerse: z.number(),
            }))
          })
        }),
        prompt: `Extract up to 3 most relevant Bible verse references for the following query. Focus on the most commonly quoted verses. If no clear verse applies, return an empty array.\nQuery: "${query}"`,
        temperature: 0.1,
      });

      for (const hint of output.verses) {
        const refStr = `${hint.bookAbbreviation} ${hint.chapter}:${hint.startVerse}`;
        
        // Skip if we already got it
        if (verses.some(v => v.reference.startsWith(refStr))) continue;

        // Try bundled index first
        if (BIBLE_INDEX[refStr]) {
          verses.push({...BIBLE_INDEX[refStr], translation: 'WEB'}); // Index text is WEB
          continue;
        }

        // Fallback to fetch
        const vText = await fetchVerseHelloAO(translation, hint.bookAbbreviation, hint.chapter, hint.startVerse)
                      || await fetchVerseFallback(refStr, translation);
                      
        if (vText) {
          verses.push({
            reference: refStr,
            translation,
            text: vText,
            original: []
          });
        }
      }
    } catch (error) {
      console.warn('Semantic retrieval failed', error);
    }
  }

  // 3. Enrichment Phase (add Strong's dictionary data)
  return enrichOriginalLanguages(verses);
}

// Enrich verses with Strongs info from the bundled dict or API
async function enrichOriginalLanguages(verses: VerseContext[]): Promise<VerseContext[]> {
  for (const verse of verses) {
    if (verse.original && verse.original.length > 0) {
      // It came from the static index so it has { word, strongs }. Need to add gloss.
      for (const orig of verse.original) {
        const dictEntry = STRONGS_DICT[orig.strongs];
        if (dictEntry) {
          orig.gloss = dictEntry.short_definition || dictEntry.definition;
          (orig as {transliteration?: string}).transliteration = dictEntry.transliteration;
        } else {
          // rare occurence, try API fetch
          const fetched = await fetchStrongsDefinition(orig.strongs);
          if (fetched) {
            orig.gloss = String(fetched.short_definition || fetched.definition || '');
            (orig as {transliteration?: string}).transliteration = String(fetched.transliteration || '');
          }
        }
      }
    } else {
      // We don't have the bolls tagged index for this verse. 
      // Because we didn't bundle it and it's fetched raw from HelloAO.
      // In this case, we would either hit bolls.life /get-chapter to get the tagged text
      // OR fallback gracefully. For MVP speed, we'll try to extract key english words and fuzzy match our dict.
      // However, that is extremely inaccurate. 
      // Correct approach: hit bolls.life for the tagged verse if missing!
      try {
        const isOT = ['GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA', '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO', 'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO', 'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL'].includes(verse.reference.split(' ')[0]);
        const trans = isOT ? 'WLC' : 'TR';
        const [book, cv] = verse.reference.split(' ');
        const [chapter, vNumStr] = cv.split(':');
        
        const bollsRef = bkbToBollsPath(book, parseInt(chapter, 10));
        const res = await fetch(`https://bolls.life/get-chapter/${trans}/${bollsRef}/`);
        
        if (res.ok) {
           const chapterData = await res.json();
           const matchV = chapterData.find((v: { verse: number, text: string }) => v.verse === parseInt(vNumStr, 10));
           if (matchV) {
             const tags = parseOriginalTags(matchV.text);
             for (const tag of tags) {
               const dictEntry = STRONGS_DICT[tag.strongs] || await fetchStrongsDefinition(tag.strongs);
               if (dictEntry) {
                 tag.gloss = String(dictEntry.short_definition || dictEntry.definition || '');
                 (tag as {transliteration?: string}).transliteration = String(dictEntry.transliteration || '');
               }
             }
             verse.original = tags;
           }
        }
      } catch (err) {
        console.warn('Failed to fetch tagged fallback for', verse.reference, err);
      }
    }
  }
  return verses;
}


function extractDirectReferences(query: string) {
  const results: Array<{book: string, chapter: number, verse: number, endVerse?: number}> = [];
  
  // Very simplistic parser for Genesis 1:1 or Gen 1:1-3
  // Covers top few books. In a real app we'd use a massive RegExp or a library.
  const regex = /\b(Gen|Exo|Lev|Num|Deu|Jos|Jdg|Rut|Sa|Ki|Ch|Ezr|Neh|Est|Job|Ps|Pro|Ecc|Song|Isa|Jer|Lam|Ezk|Dan|Hos|Joel|Amos|Obad|Jonah|Mic|Nahum|Hab|Zeph|Hag|Zech|Mal|Matt|Mark|Luke|John|Rom|Cor|Gal|Eph|Phil|Col|Thess|Tim|Titus|Philemon|Heb|James|Pet|John|Jude|Rev)[a-z]*\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\b/gi;
  
  let match;
  while ((match = regex.exec(query)) !== null) {
      const bookRaw = match[1].substring(0, 3).toUpperCase();
      // Translate to 3-letter codes used by HelloAO
      const bookMap: Record<string, string> = {
        'GEN':'GEN', 'EXO':'EXO', 'LEV':'LEV', 'NUM':'NUM', 'DEU':'DEU',
        'JOS':'JOS', 'JDG':'JDG', 'RUT':'RUT', 'SA':'1SA', 'KI':'1KI', 'CH':'1CH',
        'Psa':'PSA', 'PSA':'PSA', 'PRO':'PRO', 'ISA':'ISA', 'MAT':'MAT', 'MAR':'MRK',
        'LUK':'LUK', 'JOH':'JHN', 'ROM':'ROM', 'COR':'1CO', 'GAL':'GAL', 'EPH':'EPH',
        'PHI':'PHP', 'COL':'COL', 'THE':'1TH', 'TIM':'1TI', 'HEB':'HEB', 'JAM':'JAS',
        'PET':'1PE', 'REV':'REV'
      };
      const bookCode = bookMap[bookRaw] || bookRaw;
      
      results.push({
        book: bookCode,
        chapter: parseInt(match[2], 10),
        verse: parseInt(match[3], 10),
        endVerse: match[4] ? parseInt(match[4], 10) : undefined
      });
  }
  
  return results;
}

// Utility copied over from script
function bkbToBollsPath(bookCode: string, chapter: number): string {
  const map: Record<string, number> = {
    'GEN': 1, 'EXO': 2, 'LEV': 3, 'NUM': 4, 'DEU': 5,
    'JOS': 6, 'JDG': 7, 'RUT': 8, '1SA': 9, '2SA': 10,
    '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14, 'EZR': 15,
    'NEH': 16, 'EST': 17, 'JOB': 18, 'PSA': 19, 'PRO': 20,
    'ECC': 21, 'SNG': 22, 'ISA': 23, 'JER': 24, 'LAM': 25,
    'EZK': 26, 'DAN': 27, 'HOS': 28, 'JOL': 29, 'AMO': 30,
    'OBA': 31, 'JON': 32, 'MIC': 33, 'NAM': 34, 'HAB': 35,
    'ZEP': 36, 'HAG': 37, 'ZEC': 38, 'MAL': 39,
    'MAT': 40, 'MRK': 41, 'LUK': 42, 'JHN': 43, 'ACT': 44,
    'ROM': 45, '1CO': 46, '2CO': 47, 'GAL': 48, 'EPH': 49,
    'PHP': 50, 'COL': 51, '1TH': 52, '2TH': 53, '1TI': 54,
    '2TI': 55, 'TIT': 56, 'PHM': 57, 'HEB': 58, 'JAS': 59,
    '1PE': 60, '2PE': 61, '1JN': 62, '2JN': 63, '3JN': 64,
    'JUD': 65, 'REV': 66
  };
  return `${map[bookCode]}/${chapter}`;
}

function parseOriginalTags(text: string) {
  const words: Array<{word: string, strongs: string, gloss?: string}> = [];
  const cleanLine = text.replace(/<span.*?>/g, '').replace(/<\/\span>/g, '');
  const parts = cleanLine.split('<S>');
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) continue; 
    
    const endStrongsIdx = part.indexOf('</S>');
    if (endStrongsIdx !== -1) {
      const strongs = part.substring(0, endStrongsIdx);
      const wordPart = parts[i-1].replace(/<\/\S>/g, '').trim();
      const lastSpace = wordPart.lastIndexOf(' ');
      const word = lastSpace === -1 ? wordPart : wordPart.substring(lastSpace + 1);
      
      const cleanWord = word.replace(/[,.;:!?]/g, '');
      if (cleanWord && strongs) {
        words.push({ word: cleanWord, strongs });
      }
    }
  }
  return words;
}
