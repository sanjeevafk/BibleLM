import json
import os
import sys
import time
from typing import Dict, Any, List
import numpy as np
from fastembed import TextEmbedding

MODEL_NAME = "BAAI/bge-large-en-v1.5"
EMBEDDING_DIM = 1024
BATCH_SIZE = 256

BOOK_CODE_TO_NAME: Dict[str, str] = {
    'GEN': 'Genesis', 'EXO': 'Exodus', 'LEV': 'Leviticus', 'NUM': 'Numbers', 'DEU': 'Deuteronomy',
    'JOS': 'Joshua', 'JDG': 'Judges', 'RUT': 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
    '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
    'EZR': 'Ezra', 'NEH': 'Nehemiah', 'EST': 'Esther', 'JOB': 'Job', 'PSA': 'Psalms',
    'PRO': 'Proverbs', 'ECC': 'Ecclesiastes', 'SNG': 'Song of Songs', 'ISA': 'Isaiah',
    'JER': 'Jeremiah', 'LAM': 'Lamentations', 'EZK': 'Ezekiel', 'DAN': 'Daniel', 'HOS': 'Hosea',
    'JOL': 'Joel', 'AMO': 'Amos', 'OBA': 'Obadiah', 'JON': 'Jonah', 'MIC': 'Micah',
    'NAM': 'Nahum', 'HAB': 'Habakkuk', 'ZEP': 'Zephaniah', 'HAG': 'Haggai', 'ZEC': 'Zechariah',
    'MAL': 'Malachi', 'MAT': 'Matthew', 'MRK': 'Mark', 'LUK': 'Luke', 'JHN': 'John',
    'ACT': 'Acts', 'ROM': 'Romans', '1CO': '1 Corinthians', '2CO': '2 Corinthians',
    'GAL': 'Galatians', 'EPH': 'Ephesians', 'PHP': 'Philippians', 'COL': 'Colossians',
    '1TH': '1 Thessalonians', '2TH': '2 Thessalonians', '1TI': '1 Timothy',
    '2TI': '2 Timothy', 'TIT': 'Titus', 'PHM': 'Philemon', 'HEB': 'Hebrews', 'JAS': 'James',
    '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John',
    '3JN': '3 John', 'JUD': 'Jude', 'REV': 'Revelation',
}

OT_BOOKS = {
    'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
    '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
    'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
    'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL',
}

def parse_verse(ref: str, text: str) -> Dict[str, Any]:
    parts = ref.strip().split()
    book_code = parts[0].upper()
    chapter_verse = parts[1].split(':')
    chapter = int(chapter_verse[0])
    verse = int(chapter_verse[1])
    book = BOOK_CODE_TO_NAME.get(book_code, book_code)
    testament = "Old Testament" if book_code in OT_BOOKS else "New Testament"
    clean_text = text.strip()
    
    embedding_input = (
        f"Testament: {testament}\n"
        f"Book: {book}\n"
        f"Chapter: {chapter}\n"
        f"Verse: {verse}\n"
        f"Text: {clean_text}"
    )
    return {
        "reference": ref,
        "bookCode": book_code,
        "book": book,
        "testament": testament,
        "chapter": chapter,
        "verse": verse,
        "text": clean_text,
        "embeddingInput": embedding_input,
    }

def format_duration(sec: float) -> str:
    m = int(sec // 60)
    s = int(sec % 60)
    return f"{m}m {s:02d}s"

def main():
    root_dir = os.getcwd()
    input_path = os.path.join(root_dir, "data", "bible-full-index.json")
    out_dir = os.path.join(root_dir, "data", "embeddings")
    os.makedirs(out_dir, exist_ok=True)

    out_jsonl = os.path.join(out_dir, "bge-large-en-v1.5-1024.jsonl")
    out_bin = os.path.join(out_dir, "bge-large-en-v1.5-1024.bin")
    out_order = os.path.join(out_dir, "bge-large-en-v1.5-1024-order.json")
    out_meta = os.path.join(out_dir, "bge-large-en-v1.5-1024-meta.json")

    print(f"[1/4] Loading canonical Bible corpus from {input_path}...")
    with open(input_path, "r", encoding="utf-8") as f:
        raw_index = json.load(f)

    all_verses = [parse_verse(ref, item["text"]) for ref, item in raw_index.items()]
    total_verses = len(all_verses)
    print(f"Loaded {total_verses} canonical verses.")

    # Resumability check
    existing_refs = set()
    if os.path.exists(out_jsonl):
        print(f"[2/4] Reading existing progress from {out_jsonl}...")
        with open(out_jsonl, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rec = json.loads(line)
                    existing_refs.add(rec["reference"])
        print(f"Resumable check: {len(existing_refs)} / {total_verses} verses already embedded.")

    pending = [v for v in all_verses if v["reference"] not in existing_refs]
    print(f"Remaining verses to embed: {len(pending)}")

    print(f"[3/4] Initializing FastEmbed model '{MODEL_NAME}' (1024 dimensions, 10 CPU threads)...")
    model = TextEmbedding(model_name=MODEL_NAME, threads=10)

    if pending:
        start_time = time.time()
        completed = 0
        with open(out_jsonl, "a", encoding="utf-8") as out_f:
            for i in range(0, len(pending), BATCH_SIZE):
                batch = pending[i : i + BATCH_SIZE]
                texts = [v["embeddingInput"] for v in batch]
                
                batch_start = time.time()
                embeddings_gen = model.embed(texts)
                embeddings = list(embeddings_gen)
                batch_time = time.time() - batch_start

                for v, emb in zip(batch, embeddings):
                    emb_list = emb.tolist() if hasattr(emb, "tolist") else list(emb)
                    if len(emb_list) != EMBEDDING_DIM:
                        raise ValueError(f"Dimension mismatch for {v['reference']}: {len(emb_list)} != {EMBEDDING_DIM}")
                    rec = {
                        "reference": v["reference"],
                        "bookCode": v["bookCode"],
                        "book": v["book"],
                        "testament": v["testament"],
                        "chapter": v["chapter"],
                        "verse": v["verse"],
                        "text": v["text"],
                        "embeddingInput": v["embeddingInput"],
                        "embedding": emb_list,
                    }
                    out_f.write(json.dumps(rec) + "\n")
                out_f.flush()

                completed += len(batch)
                total_done = len(existing_refs) + completed
                pct = (total_done / total_verses) * 100
                elapsed = time.time() - start_time
                speed = completed / elapsed if elapsed > 0 else 0
                eta = (len(pending) - completed) / speed if speed > 0 else 0

                batch_num = (i // BATCH_SIZE) + 1
                total_batches = (len(pending) + BATCH_SIZE - 1) // BATCH_SIZE
                print(
                    f"[{pct:.1f}%] {total_done}/{total_verses} | "
                    f"Batch {batch_num}/{total_batches} ({len(batch)} v in {batch_time*1000:.0f}ms) | "
                    f"{speed:.1f} v/s | ETA {format_duration(eta)}"
                )

    print("[4/4] Validating resulting dataset and generating binary indices...")
    validated_map: Dict[str, List[float]] = {}
    verse_order: List[str] = []

    with open(out_jsonl, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            ref = rec["reference"]
            emb = rec["embedding"]
            if len(emb) != EMBEDDING_DIM:
                raise ValueError(f"Dimension mismatch at line {idx+1} ({ref}): {len(emb)} != {EMBEDDING_DIM}")
            if ref in validated_map:
                continue
            validated_map[ref] = emb
            verse_order.append(ref)

    if len(validated_map) != total_verses:
        raise ValueError(f"Dataset incomplete! Expected {total_verses}, got {len(validated_map)}")

    print(f"Packing {len(verse_order)} vectors into contiguous float32 binary file...")
    bin_array = np.zeros((len(verse_order), EMBEDDING_DIM), dtype=np.float32)
    for idx, ref in enumerate(verse_order):
        bin_array[idx] = validated_map[ref]

    with open(out_bin, "wb") as f:
        f.write(bin_array.tobytes())

    with open(out_order, "w", encoding="utf-8") as f:
        json.dump(verse_order, f)

    meta = {
        "model": MODEL_NAME,
        "dimension": EMBEDDING_DIM,
        "totalVerses": len(validated_map),
        "binaryBytes": os.path.getsize(out_bin),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "valid": True,
    }
    with open(out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print("\n======================================================")
    print(f"SUCCESS: All {len(validated_map)} Bible verses embedded locally with BGE!")
    print(f"- Model:      {MODEL_NAME}")
    print(f"- Dimension:  {EMBEDDING_DIM}")
    print(f"- JSONL:      {out_jsonl} ({os.path.getsize(out_jsonl) / (1024*1024):.1f} MB)")
    print(f"- Binary:     {out_bin} ({os.path.getsize(out_bin) / (1024*1024):.1f} MB)")
    print(f"- Order Map:  {out_order}")
    print(f"- Metadata:   {out_meta}")
    print("======================================================\n")

if __name__ == "__main__":
    main()
