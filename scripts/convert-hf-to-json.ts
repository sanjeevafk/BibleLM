import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const STRONGS_FILE = path.join(DATA_DIR, "strongs-dict.json");
const BIBLE_INDEX_FILE = path.join(DATA_DIR, "bible-index.json");

// Helper to wait a bit to avoid aggressive rate limiting
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchStrongsDictionary() {
  console.log(
    "Fetching top Strongs from bolls.life (downloading BDBT.json directly)...",
  );

  // Note: bolls.life offers the full dictionary as a direct download which is much better
  // than hitting the API 5000 times as originally planned.
  try {
    const res = await fetch("https://bolls.life/static/dictionaries/BDBT.json");
    if (!res.ok)
      throw new Error(`Failed to fetch dictionary: ${res.statusText}`);

    const BDBT = await res.json();
    console.log(`Downloaded ${BDBT.length} Strong's definitions`);

    // We want to optimize this to only include essential fields
    const optimizedDict: Record<string, any> = {};
    for (const entry of BDBT) {
      if (entry.topic) {
        optimizedDict[entry.topic] = {
          lexeme: entry.lexeme || "",
          transliteration: entry.transliteration || "",
          pronunciation: entry.pronunciation || "",
          short_definition: entry.short_definition || "",
        };
      }
    }

    fs.writeFileSync(STRONGS_FILE, JSON.stringify(optimizedDict));
    console.log(
      `Saved optimized dictionary to ${STRONGS_FILE} (${Object.keys(optimizedDict).length} entries)`,
    );
    return optimizedDict;
  } catch (error) {
    console.error("Error fetching Strongs Dictionary:", error);
    // If we fail, write an empty dict so the app doesn't crash on startup
    fs.writeFileSync(STRONGS_FILE, JSON.stringify({}));
    return {};
  }
}

// We'll bundle key controversial and highly referenced chapters to save API calls
const CHAPTERS_TO_BUNDLE = [
  { book: "GEN", chapter: 1 },
  { book: "GEN", chapter: 2 },
  { book: "EXO", chapter: 20 },
  { book: "EXO", chapter: 21 },
  { book: "LEV", chapter: 18 },
  { book: "LEV", chapter: 20 },
  { book: "PSA", chapter: 139 },
  { book: "PSA", chapter: 23 },
  { book: "PRO", chapter: 3 },
  { book: "ISA", chapter: 53 },
  { book: "MAT", chapter: 5 },
  { book: "MAT", chapter: 6 },
  { book: "MAT", chapter: 7 },
  { book: "MAT", chapter: 19 },
  { book: "MRK", chapter: 10 },
  { book: "LUK", chapter: 15 },
  { book: "JHN", chapter: 1 },
  { book: "JHN", chapter: 3 },
  { book: "ROM", chapter: 1 },
  { book: "ROM", chapter: 8 },
  { book: "1CO", chapter: 6 },
  { book: "1CO", chapter: 11 },
  { book: "1CO", chapter: 14 },
  { book: "GAL", chapter: 3 },
  { book: "GAL", chapter: 5 },
  { book: "EPH", chapter: 2 },
  { book: "EPH", chapter: 5 },
  { book: "1TI", chapter: 2 },
  { book: "1TI", chapter: 3 },
  { book: "HEB", chapter: 11 },
  { book: "JAS", chapter: 1 },
  { book: "REV", chapter: 21 },
  { book: "REV", chapter: 22 },
];

async function fetchBibleIndex() {
  console.log("Fetching core verses for bible-index.json...");

  const bibleIndex: Record<string, any> = {};
  let totalVerses = 0;

  for (const { book, chapter } of CHAPTERS_TO_BUNDLE) {
    try {
      console.log(`Fetching ${book} ${chapter}...`);

      // 1. Fetch translation (WEB)
      const webRes = await fetch(
        `https://bible.helloao.org/api/ENGWEBP/${book}/${chapter}.json`,
      );
      if (!webRes.ok) throw new Error(`WEB Error: ${webRes.statusText}`);
      const webData = await webRes.json();

      // 2. Fetch original language tagging from bolls (WLC for OT, TR for NT)
      const isOT = ["GEN", "EXO", "LEV", "PSA", "PRO", "ISA"].includes(book);
      const originalTrans = isOT ? "WLC" : "TR";

      const origRes = await fetch(
        `https://bolls.life/get-chapter/${originalTrans}/${bkbToBollsPath(book, chapter)}/`,
      );
      let origVerses: any[] = [];
      if (origRes.ok) {
        origVerses = await origRes.json();
      }

      // 3. Combine them
      if (webData.chapter && webData.chapter.content) {
        for (const item of webData.chapter.content) {
          if (item.type === "verse") {
            const verseText = item.content
              .map((c: any) => (typeof c === "string" ? c : ""))
              .join("")
              .trim();
            const ref = `${book} ${chapter}:${item.number}`;

            // Try to find matching original verse
            const origVerse = origVerses.find(
              (v: any) => v.verse === item.number,
            );
            const originalLangData = parseOriginalTags(origVerse?.text || "");

            bibleIndex[ref] = {
              text: verseText,
              translation: "WEB",
              reference: ref,
              original: originalLangData,
            };
            totalVerses++;
          }
        }
      }

      // polite delay
      await delay(1000);
    } catch (err) {
      console.error(`Failed to bundle ${book} ${chapter}`, err);
    }
  }

  fs.writeFileSync(BIBLE_INDEX_FILE, JSON.stringify(bibleIndex));
  console.log(
    `Saved bible index to ${BIBLE_INDEX_FILE} (${totalVerses} verses bundled)`,
  );
}

// Bolls uses different internal IDs/Paths for books
function bkbToBollsPath(bookCode: string, chapter: number): string {
  const map: Record<string, number> = {
    GEN: 1,
    EXO: 2,
    LEV: 3,
    NUM: 4,
    DEU: 5,
    JOS: 6,
    JDG: 7,
    RUT: 8,
    "1SA": 9,
    "2SA": 10,
    "1KI": 11,
    "2KI": 12,
    "1CH": 13,
    "2CH": 14,
    EZR: 15,
    NEH: 16,
    EST: 17,
    JOB: 18,
    PSA: 19,
    PRO: 20,
    ECC: 21,
    SNG: 22,
    ISA: 23,
    JER: 24,
    LAM: 25,
    EZK: 26,
    DAN: 27,
    HOS: 28,
    JOL: 29,
    AMO: 30,
    OBA: 31,
    JON: 32,
    MIC: 33,
    NAM: 34,
    HAB: 35,
    ZEP: 36,
    HAG: 37,
    ZEC: 38,
    MAL: 39,
    MAT: 40,
    MRK: 41,
    LUK: 42,
    JHN: 43,
    ACT: 44,
    ROM: 45,
    "1CO": 46,
    "2CO": 47,
    GAL: 48,
    EPH: 49,
    PHP: 50,
    COL: 51,
    "1TH": 52,
    "2TH": 53,
    "1TI": 54,
    "2TI": 55,
    TIT: 56,
    PHM: 57,
    HEB: 58,
    JAS: 59,
    "1PE": 60,
    "2PE": 61,
    "1JN": 62,
    "2JN": 63,
    "3JN": 64,
    JUD: 65,
    REV: 66,
  };
  return `${map[bookCode]}/${chapter}`;
}

// Extracts Strong's tags from text like "בְּרֵאשִׁ֖ית<S>H7225</S> בָּרָ֣א<S>H1254</S>"
function parseOriginalTags(text: string) {
  const words: Array<{ word: string; strongs: string }> = [];

  // Clean HTML/spans (bolls often wraps in <span>)
  const cleanLine = text.replace(/<span.*?>/g, "").replace(/<\/span>/g, "");

  // Split by <S> tags rough
  const parts = cleanLine.split("<S>");

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0) continue; // First part has no preceding word usually, or is just the first word

    // Part looks like: "H7225</S> בָּרָ֣א"
    const endStrongsIdx = part.indexOf("</S>");
    if (endStrongsIdx !== -1) {
      const strongs = part.substring(0, endStrongsIdx);
      // The word to which this applies is BEFORE the <S> tag, so it's at the end of parts[i-1]
      let wordPart = parts[i - 1].replace(/<\/S>/g, "").trim();
      const lastSpace = wordPart.lastIndexOf(" ");
      const word =
        lastSpace === -1 ? wordPart : wordPart.substring(lastSpace + 1);

      // Clean up punctuation from word
      const cleanWord = word.replace(/[,.;:!?]/g, "");
      if (cleanWord && strongs) {
        words.push({ word: cleanWord, strongs });
      }
    }
  }

  return words;
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }

  await fetchStrongsDictionary();
  await fetchBibleIndex();
  console.log("Conversion script complete!");
}

main().catch(console.error);
