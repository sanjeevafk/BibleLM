#!/usr/bin/env python3
"""
Contextual prepending experiment for BibleLM.

Builds two BM25 indexes:
  - baseline: raw verse text only
  - enriched: verse text prepended with "[Book · Chapter · Topic label]" header

Then runs comparison queries on both and shows side-by-side results.
"""

import json
import math
import re
from collections import defaultdict
from pathlib import Path

DATA = Path("/home/sanjeev/Downloads/bibleLM/data")

# --- Load source data ---

with open(DATA / "bible-full-index.json") as f:
    full_index = json.load(f)

with open(DATA / "pericopes.json") as f:
    raw = json.load(f)
    pericopes = raw.get("items", raw) if isinstance(raw, dict) else raw

with open(DATA / "verse-topics.json") as f:
    raw = json.load(f)
    verse_topic_list = raw.get("items", raw) if isinstance(raw, dict) else raw

with open(DATA / "topics.json") as f:
    raw = json.load(f)
    topic_list = raw.get("items", raw) if isinstance(raw, dict) else raw

# --- Build lookup maps ---

topic_labels = {t["id"]: t["label"] for t in topic_list}

# verse -> list of topic labels (top 2 by confidence)
verse_topics: dict[str, list[str]] = defaultdict(list)
for entry in verse_topic_list:
    vid = entry["verseId"]
    sorted_topics = sorted(entry.get("topics", []), key=lambda x: x.get("confidence", 0), reverse=True)
    for t in sorted_topics[:2]:
        label = topic_labels.get(t["id"], t["id"])
        verse_topics[vid].append(label)

# verse -> pericope title
verse_pericope: dict[str, str] = {}
BOOK_CHAPTERS = {  # rough chapter count per book for canonical book name
}

def expand_pericope_refs(p):
    book, ch = p["book"], p["chapter"]
    for v in range(p["startVerse"], p["endVerse"] + 1):
        vid = f"{book} {ch}:{v}"
        verse_pericope[vid] = p["title"]

for p in pericopes:
    expand_pericope_refs(p)

# Canonical book name map (BSB codes -> readable names)
BOOK_NAMES = {
    "GEN": "Genesis", "EXO": "Exodus", "LEV": "Leviticus", "NUM": "Numbers",
    "DEU": "Deuteronomy", "JOS": "Joshua", "JDG": "Judges", "RUT": "Ruth",
    "1SA": "1 Samuel", "2SA": "2 Samuel", "1KI": "1 Kings", "2KI": "2 Kings",
    "1CH": "1 Chronicles", "2CH": "2 Chronicles", "EZR": "Ezra", "NEH": "Nehemiah",
    "EST": "Esther", "JOB": "Job", "PSA": "Psalms", "PRO": "Proverbs",
    "ECC": "Ecclesiastes", "SNG": "Song of Solomon", "ISA": "Isaiah", "JER": "Jeremiah",
    "LAM": "Lamentations", "EZK": "Ezekiel", "DAN": "Daniel", "HOS": "Hosea",
    "JOL": "Joel", "AMO": "Amos", "OBA": "Obadiah", "JON": "Jonah",
    "MIC": "Micah", "NAM": "Nahum", "HAB": "Habakkuk", "ZEP": "Zephaniah",
    "HAG": "Haggai", "ZEC": "Zechariah", "MAL": "Malachi",
    "MAT": "Matthew", "MRK": "Mark", "LUK": "Luke", "JHN": "John",
    "ACT": "Acts", "ROM": "Romans", "1CO": "1 Corinthians", "2CO": "2 Corinthians",
    "GAL": "Galatians", "EPH": "Ephesians", "PHP": "Philippians", "COL": "Colossians",
    "1TH": "1 Thessalonians", "2TH": "2 Thessalonians", "1TI": "1 Timothy",
    "2TI": "2 Timothy", "TIT": "Titus", "PHM": "Philemon", "HEB": "Hebrews",
    "JAS": "James", "1PE": "1 Peter", "2PE": "2 Peter", "1JN": "1 John",
    "2JN": "2 John", "3JN": "3 John", "JUD": "Jude", "REV": "Revelation",
}

def make_header(ref: str, verse_id: str) -> str:
    """Build a context header like '[John · Chapter 3 · Salvation, Love of God]'"""
    parts = ref.split()
    book_code = parts[0]
    ch_v = parts[1] if len(parts) > 1 else ""
    ch = ch_v.split(":")[0] if ":" in ch_v else ""

    book_name = BOOK_NAMES.get(book_code, book_code)
    header_parts = [book_name]
    if ch:
        header_parts.append(f"Chapter {ch}")

    # Prefer pericope title, fall back to topic labels
    pericope_title = verse_pericope.get(verse_id)
    if pericope_title:
        header_parts.append(pericope_title)
    else:
        topics = verse_topics.get(verse_id, [])
        if topics:
            header_parts.append(", ".join(topics))

    return "[" + " · ".join(header_parts) + "]"

# --- Minimal BM25 implementation ---

def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z]{2,}", text.lower())

class BM25:
    def __init__(self, docs: dict[str, str], k1=1.2, b=0.65):
        self.ids = list(docs.keys())
        self.texts = list(docs.values())
        self.k1 = k1
        self.b = b
        corpus = [tokenize(t) for t in self.texts]
        self.avgdl = sum(len(d) for d in corpus) / max(len(corpus), 1)
        self.N = len(corpus)
        # Build inverted index
        self.inv: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for i, tokens in enumerate(corpus):
            freq: dict[str, int] = defaultdict(int)
            for tok in tokens:
                freq[tok] += 1
            for tok, f in freq.items():
                self.inv[tok].append((i, f))
        self.dl = [len(d) for d in corpus]

    def score(self, query: str, top_k=10) -> list[tuple[str, float, str]]:
        tokens = tokenize(query)
        scores: dict[int, float] = defaultdict(float)
        for tok in tokens:
            if tok not in self.inv:
                continue
            df = len(self.inv[tok])
            idf = math.log((self.N - df + 0.5) / (df + 0.5) + 1)
            for doc_i, tf in self.inv[tok]:
                dl = self.dl[doc_i]
                denom = tf + self.k1 * (1 - self.b + self.b * dl / self.avgdl)
                scores[doc_i] += idf * (tf * (self.k1 + 1)) / denom
        ranked = sorted(scores.items(), key=lambda x: -x[1])[:top_k]
        return [(self.ids[i], round(s, 4), self.texts[i][:100]) for i, s in ranked]

# --- Build baseline vs enriched index ---

print("Building baseline index (raw verse text)...")
baseline_docs = {ref: v["text"] for ref, v in full_index.items()}

print("Building enriched index (header + verse text)...")
enriched_docs = {}
for ref, v in full_index.items():
    header = make_header(ref, ref)
    enriched_docs[ref] = header + " " + v["text"]

bm25_baseline = BM25(baseline_docs)
bm25_enriched = BM25(enriched_docs)
print(f"Indexed {len(baseline_docs)} verses.\n")

# --- Run comparison queries ---

QUERIES = [
    "why did Jesus come to earth",
    "God's love for humanity",
    "what happens after death resurrection",
    "the cost of following Jesus discipleship",
    "prayer in secret not to be seen",
    "faith without works is dead",
    "Jesus calms the storm",
]

TOP_K = 5

print("=" * 70)
for query in QUERIES:
    print(f"\nQUERY: \"{query}\"")
    print("-" * 70)
    base = bm25_baseline.score(query, TOP_K)
    enr = bm25_enriched.score(query, TOP_K)

    # Find diffs
    base_refs = [r for r, _, _ in base]
    enr_refs = [r for r, _, _ in enr]
    new_hits = [r for r in enr_refs if r not in base_refs]
    dropped = [r for r in base_refs if r not in enr_refs]

    print(f"  {'Baseline':35s}  {'Enriched':35s}")
    for i in range(TOP_K):
        b_ref = f"{base[i][0]} ({base[i][1]})" if i < len(base) else "-"
        e_ref = f"{enr[i][0]} ({enr[i][1]})" if i < len(enr) else "-"
        changed = "<<" if (i < len(enr) and enr[i][0] not in base_refs[:i+1]) else "  "
        print(f"  {b_ref:35s}  {e_ref:35s} {changed}")

    if new_hits:
        print(f"  [+] New hits in enriched: {', '.join(new_hits)}")
    if dropped:
        print(f"  [-] Dropped from baseline: {', '.join(dropped)}")

print("\n" + "=" * 70)
print("Done.")
