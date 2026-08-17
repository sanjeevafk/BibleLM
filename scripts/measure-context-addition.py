#!/usr/bin/env python3
"""
Measurement script for BibleLM Contextual Header Prepending.
Evaluates:
  1. Thematic & Conceptual Queries (Topic Precision @ 5 & Top Hit Relevance)
  2. Direct Scripture Passages (Hit @ 1 & Non-regression)
"""

import json
import math
import re
from collections import defaultdict
from pathlib import Path

DATA = Path("/home/sanjeev/Downloads/bibleLM/data")

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

topic_labels = {t["id"]: t["label"] for t in topic_list}
verse_topics = defaultdict(list)
for entry in verse_topic_list:
    vid = entry["verseId"]
    sorted_topics = sorted(entry.get("topics", []), key=lambda x: x.get("confidence", 0), reverse=True)
    for t in sorted_topics[:2]:
        verse_topics[vid].append(topic_labels.get(t["id"], t["id"]))

verse_pericope = {}
for p in pericopes:
    for v in range(p["startVerse"], p["endVerse"] + 1):
        verse_pericope[f"{p['book']} {p['chapter']}:{v}"] = p["title"]

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
        self.inv: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for i, tokens in enumerate(corpus):
            freq: dict[str, int] = defaultdict(int)
            for tok in tokens:
                freq[tok] += 1
            for tok, f in freq.items():
                self.inv[tok].append((i, f))
        self.dl = [len(d) for d in corpus]

    def score(self, query: str, top_k=5) -> list[tuple[str, float]]:
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
        return [(self.ids[i], round(s, 4)) for i, s in ranked]

# Build Baseline & Enriched
baseline_docs = {ref: v["text"] for ref, v in full_index.items()}
enriched_docs = {ref: v.get("bm25Text", v["text"]) for ref, v in full_index.items()}

bm25_base = BM25(baseline_docs)
bm25_enr = BM25(enriched_docs)

# Test Cases
EXACT_TEXT_QUERIES = [
    ("For God so loved the world that He gave His one and only Son", "JHN 3:16"),
    ("In the beginning God created the heavens and the earth", "GEN 1:1"),
    ("Blessed are the poor in spirit for theirs is the kingdom of heaven", "MAT 5:3"),
    ("And we know that in all things God works for the good of those who love Him", "ROM 8:28"),
    ("The LORD is my shepherd I shall not want", "PSA 23:1"),
    ("I can do all things through Him who gives me strength", "PHP 4:13"),
]

THEMATIC_QUERIES = [
    ("the cost of following Jesus discipleship", ["MAT 4:19", "MRK 1:17", "MAT 8:22", "JHN 1:43", "JHN 21:22", "LUK 9:23", "LUK 14:27"]),
    ("what happens after death resurrection", ["1CO 15:21", "1CO 15:55", "1CO 15:26", "JHN 11:25", "1TH 4:16"]),
    ("why did Jesus come to earth", ["JHN 3:17", "JHN 10:10", "1TI 1:15", "JHN 18:37", "MRK 10:45", "JHN 12:46"]),
    ("prayer in secret not to be seen", ["MAT 6:4", "MAT 6:6", "MAT 6:18"]),
    ("Jesus calms the storm", ["MAT 8:24", "MAT 8:26", "MRK 4:39", "LUK 8:24", "PSA 107:29"]),
]

# 1. Exact Text Non-regression Test
def eval_exact(engine, queries):
    hits = 0
    for q, target in queries:
        res = engine.score(q, 1)
        if res and res[0][0] == target:
            hits += 1
    return hits / len(queries)

# 2. Thematic Recall Test
def eval_thematic(engine, queries):
    total_matches = 0
    total_retrieved = 0
    hit1_count = 0
    for q, targets in queries:
        res = [r for r, _ in engine.score(q, 5)]
        if res and res[0] in targets:
            hit1_count += 1
        matches = sum(1 for r in res if r in targets)
        total_matches += matches
        total_retrieved += len(res)
    precision = total_matches / total_retrieved
    hit1_rate = hit1_count / len(queries)
    return precision, hit1_rate

exact_base = eval_exact(bm25_base, EXACT_TEXT_QUERIES)
exact_enr = eval_exact(bm25_enr, EXACT_TEXT_QUERIES)

p_base, h1_base = eval_thematic(bm25_base, THEMATIC_QUERIES)
p_enr, h1_enr = eval_thematic(bm25_enr, THEMATIC_QUERIES)

results = {
    "exact_quote_hit1_baseline": exact_base,
    "exact_quote_hit1_enriched": exact_enr,
    "thematic_precision_at_5_baseline": round(p_base, 3),
    "thematic_precision_at_5_enriched": round(p_enr, 3),
    "thematic_hit1_baseline": round(h1_base, 3),
    "thematic_hit1_enriched": round(h1_enr, 3),
    "index_verses_total": len(full_index),
    "enriched_verses_count": sum(1 for v in full_index.values() if "bm25Text" in v and "[" in v["bm25Text"]),
}

print(json.dumps(results, indent=2))
