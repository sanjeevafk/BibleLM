import json
import os
import sys
import time
import multiprocessing as mp
from typing import Dict, Any, List
import numpy as np
from fastembed import TextEmbedding

MODEL_NAME = "BAAI/bge-large-en-v1.5"
EMBEDDING_DIM = 1024
BATCH_SIZE = 128
NUM_WORKERS = 3
THREADS_PER_WORKER = 4
TEMP_CHUNK_DIR = "/tmp/biblelm_bge_chunks"

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

def worker_task(worker_id: int, verses: List[Dict[str, Any]], out_path: str):
    print(f"[Worker {worker_id}] Started with {len(verses)} verses -> writing to {out_path}")
    
    # Check for existing completed verses in worker chunk
    done_refs = set()
    if os.path.exists(out_path):
        with open(out_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    done_refs.add(json.loads(line)["reference"])
                    
    pending = [v for v in verses if v["reference"] not in done_refs]
    print(f"[Worker {worker_id}] {len(done_refs)} already done, {len(pending)} pending.")
    
    if not pending:
        print(f"[Worker {worker_id}] All verses already completed!")
        return

    model = TextEmbedding(model_name=MODEL_NAME, threads=THREADS_PER_WORKER)
    t0 = time.time()
    completed = 0
    total = len(pending)
    
    with open(out_path, "a", encoding="utf-8") as out_f:
        for i in range(0, total, BATCH_SIZE):
            batch = pending[i : i + BATCH_SIZE]
            texts = [v["embeddingInput"] for v in batch]
            
            b_start = time.time()
            embeddings_gen = model.embed(texts)
            embeddings = list(embeddings_gen)
            b_dur = time.time() - b_start
            
            for v, emb in zip(batch, embeddings):
                rec = {
                    "reference": v["reference"],
                    "bookCode": v["bookCode"],
                    "book": v["book"],
                    "testament": v["testament"],
                    "chapter": v["chapter"],
                    "verse": v["verse"],
                    "text": v["text"],
                    "embeddingInput": v["embeddingInput"],
                    "embedding": emb.tolist() if hasattr(emb, "tolist") else list(emb),
                }
                out_f.write(json.dumps(rec) + "\n")
            out_f.flush()
            
            completed += len(batch)
            elapsed = time.time() - t0
            speed = completed / elapsed if elapsed > 0 else 0
            eta = (total - completed) / speed if speed > 0 else 0
            pct = (completed / total) * 100
            print(f"[Worker {worker_id}] [{pct:.1f}%] {completed}/{total} | {speed:.1f} v/s | ETA {int(eta//60)}m {int(eta%60):02d}s")

    print(f"[Worker {worker_id}] Finished all {total} verses in {int(time.time()-t0)}s!")

def main():
    root_dir = os.getcwd()
    input_path = os.path.join(root_dir, "data", "bible-full-index.json")
    out_dir = os.path.join(root_dir, "data", "embeddings")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(TEMP_CHUNK_DIR, exist_ok=True)

    master_jsonl = os.path.join(out_dir, "bge-large-en-v1.5-1024.jsonl")
    out_bin = os.path.join(out_dir, "bge-large-en-v1.5-1024.bin")
    out_order = os.path.join(out_dir, "bge-large-en-v1.5-1024-order.json")
    out_meta = os.path.join(out_dir, "bge-large-en-v1.5-1024-meta.json")

    print(f"[1/4] Loading canonical Bible corpus from {input_path}...")
    with open(input_path, "r", encoding="utf-8") as f:
        raw_index = json.load(f)

    all_verses = [parse_verse(ref, item["text"]) for ref, item in raw_index.items()]
    total_verses = len(all_verses)
    print(f"Loaded {total_verses} canonical verses.")

    # 1. Read existing master lines
    existing_records: Dict[str, Dict[str, Any]] = {}
    if os.path.exists(master_jsonl):
        print(f"[2/4] Reading existing progress from {master_jsonl}...")
        with open(master_jsonl, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rec = json.loads(line)
                    existing_records[rec["reference"]] = rec
        print(f"Found {len(existing_records)} / {total_verses} verses already embedded.")

    # 2. Check temp chunk dir for any already completed chunk verses
    chunk_paths = [os.path.join(TEMP_CHUNK_DIR, f"part_{i}.jsonl") for i in range(NUM_WORKERS)]
    for cp in chunk_paths:
        if os.path.exists(cp):
            with open(cp, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rec = json.loads(line)
                        existing_records[rec["reference"]] = rec

    pending = [v for v in all_verses if v["reference"] not in existing_records]
    print(f"Verses to embed across {NUM_WORKERS} workers: {len(pending)}")

    if pending:
        # Split pending into 3 chunks
        chunks = [[] for _ in range(NUM_WORKERS)]
        for idx, verse in enumerate(pending):
            chunks[idx % NUM_WORKERS].append(verse)

        print(f"[3/4] Spawning {NUM_WORKERS} parallel workers (threads={THREADS_PER_WORKER} each)...")
        processes = []
        for i in range(NUM_WORKERS):
            p = mp.Process(target=worker_task, args=(i, chunks[i], chunk_paths[i]))
            p.start()
            processes.append(p)

        for p in processes:
            p.join()
            if p.exitcode != 0:
                raise RuntimeError(f"A worker process failed with exit code {p.exitcode}")

    print("\n[4/4] Merging all parts into final consolidated dataset...")
    # Gather everything into existing_records
    for cp in chunk_paths:
        if os.path.exists(cp):
            with open(cp, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rec = json.loads(line)
                        existing_records[rec["reference"]] = rec

    if len(existing_records) != total_verses:
        raise ValueError(f"Incomplete dataset! Expected {total_verses}, got {len(existing_records)}")

    # Write atomic final jsonl in canonical verse order
    temp_final_jsonl = master_jsonl + ".tmp"
    verse_order = []
    print(f"Writing canonical order {total_verses} verses to {temp_final_jsonl}...")
    with open(temp_final_jsonl, "w", encoding="utf-8") as out_f:
        for v in all_verses:
            ref = v["reference"]
            rec = existing_records[ref]
            verse_order.append(ref)
            out_f.write(json.dumps(rec) + "\n")

    os.replace(temp_final_jsonl, master_jsonl)
    print(f"Master JSONL updated at {master_jsonl} ({os.path.getsize(master_jsonl)/(1024*1024):.1f} MB)")

    # Build binary float32 file
    print(f"Packing {len(verse_order)} vectors into contiguous float32 binary file...")
    bin_array = np.zeros((len(verse_order), EMBEDDING_DIM), dtype=np.float32)
    for idx, ref in enumerate(verse_order):
        bin_array[idx] = existing_records[ref]["embedding"]

    with open(out_bin, "wb") as f:
        f.write(bin_array.tobytes())

    with open(out_order, "w", encoding="utf-8") as f:
        json.dump(verse_order, f)

    meta = {
        "model": MODEL_NAME,
        "dimension": EMBEDDING_DIM,
        "totalVerses": len(verse_order),
        "binaryBytes": os.path.getsize(out_bin),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "valid": True,
    }
    with open(out_meta, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    # Clean up temp chunks
    for cp in chunk_paths:
        try:
            os.remove(cp)
        except OSError:
            pass

    print("\n" + "=" * 60)
    print(f"SUCCESS: ALL {total_verses} BIBLE VERSES EMBEDDED & COMPILED!")
    print(f"- JSONL:   {master_jsonl}")
    print(f"- Binary:  {out_bin} ({os.path.getsize(out_bin)/(1024*1024):.1f} MB)")
    print(f"- Order:   {out_order}")
    print(f"- Meta:    {out_meta}")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    main()
