import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const BIBLE_INDEX_FILE = path.join(DATA_DIR, "bible-index.json");
const WEB_CSV_FILE = path.join(
  process.cwd(),
  "datasets",
  "Marvel.bible",
  "bibles",
  "WEB.csv",
);

const BOOKS = [
  "",
  "GEN",
  "EXO",
  "LEV",
  "NUM",
  "DEU",
  "JOS",
  "JDG",
  "RUT",
  "1SA",
  "2SA",
  "1KI",
  "2KI",
  "1CH",
  "2CH",
  "EZR",
  "NEH",
  "EST",
  "JOB",
  "PSA",
  "PRO",
  "ECC",
  "SNG",
  "ISA",
  "JER",
  "LAM",
  "EZK",
  "DAN",
  "HOS",
  "JOL",
  "AMO",
  "OBA",
  "JON",
  "MIC",
  "NAM",
  "HAB",
  "ZEP",
  "HAG",
  "ZEC",
  "MAL",
  "MAT",
  "MRK",
  "LUK",
  "JHN",
  "ACT",
  "ROM",
  "1CO",
  "2CO",
  "GAL",
  "EPH",
  "PHP",
  "COL",
  "1TH",
  "2TH",
  "1TI",
  "2TI",
  "TIT",
  "PHM",
  "HEB",
  "JAS",
  "1PE",
  "2PE",
  "1JN",
  "2JN",
  "3JN",
  "JUD",
  "REV",
];

function normalizeWebText(text: string): string {
  return text.replace(/\[[^\]]*?\]/g, "").replace(/\s+/g, " ").trim();
}

function loadWebCsv(): Map<string, string> {
  if (!fs.existsSync(WEB_CSV_FILE)) {
    throw new Error(`Missing WEB CSV file at ${WEB_CSV_FILE}`);
  }
  const map = new Map<string, string>();
  const raw = fs.readFileSync(WEB_CSV_FILE, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const bookNum = Number(parts[0]);
    const chapter = Number(parts[1]);
    const verse = Number(parts[2]);
    const text = normalizeWebText(parts.slice(3).join("\t"));
    const bookCode = BOOKS[bookNum];
    if (!bookCode || !chapter || !verse || !text) continue;
    const ref = `${bookCode} ${chapter}:${verse}`;
    map.set(ref, text);
  }
  return map;
}

function main() {
  if (!fs.existsSync(BIBLE_INDEX_FILE)) {
    throw new Error(`Missing bible-index.json at ${BIBLE_INDEX_FILE}`);
  }

  const bibleIndex: Record<string, any> = JSON.parse(
    fs.readFileSync(BIBLE_INDEX_FILE, "utf8"),
  );
  const webMap = loadWebCsv();

  let emptyBefore = 0;
  let filled = 0;
  let missing = 0;

  for (const [ref, entry] of Object.entries(bibleIndex)) {
    const text = String(entry?.text ?? "");
    if (!text.trim()) {
      emptyBefore++;
      const replacement = webMap.get(ref);
      if (replacement) {
        entry.text = replacement;
        filled++;
      } else {
        missing++;
      }
    }
  }

  const emptyAfter = Object.values(bibleIndex).filter(
    (entry: any) => !String(entry?.text ?? "").trim(),
  ).length;

  fs.writeFileSync(BIBLE_INDEX_FILE, JSON.stringify(bibleIndex));

  console.log(
    `Empty verses before: ${emptyBefore}, filled: ${filled}, missing: ${missing}, empty after: ${emptyAfter}`,
  );

  if (emptyAfter > 0) {
    throw new Error(`Still have ${emptyAfter} empty verses after repair.`);
  }
}

main();
