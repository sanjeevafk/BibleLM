import json
import time
import numpy as np
from fastembed import TextEmbedding

TEST_QUERIES = [
    {
        "query": "In the beginning God created the heavens and the earth",
        "expected": "GEN 1:1",
        "category": "Direct Quote / Creation"
    },
    {
        "query": "The Lord is my shepherd I shall not lack anything",
        "expected": "PSA 23:1",
        "category": "Direct Quote / Comfort"
    },
    {
        "query": "Behold the virgin shall conceive and give birth to a son Immanuel",
        "expected": "ISA 7:14",
        "category": "Prophecy / Direct"
    },
    {
        "query": "For unto us a child is born unto us a son is given",
        "expected": "ISA 9:6",
        "category": "Prophecy / Direct"
    },
    {
        "query": "Create in me a pure heart O God and renew a steadfast spirit within me",
        "expected": "PSA 51:10",
        "category": "Repentance / Psalm"
    },
    {
        "query": "Take your son your only son Isaac whom you love and offer him as a burnt offering",
        "expected": "GEN 22:2",
        "category": "Narrative / Akedah"
    },
    {
        "query": "Trust in the Lord with all your heart and lean not on your own understanding",
        "expected": "PRO 3:5",
        "category": "Wisdom / Proverbs"
    },
    {
        "query": "The Lord bless you and keep you the Lord make his face shine upon you",
        "expected": "NUM 6:24",
        "category": "Priestly Blessing"
    },
    {
        "query": "The grass withers the flower fades but the word of our God stands forever",
        "expected": "ISA 40:8",
        "category": "Thematic / Word of God"
    },
    {
        "query": "Holy holy holy is the Lord of hosts the whole earth is full of his glory",
        "expected": "ISA 6:3",
        "category": "Worship / Vision"
    }
]

def main():
    print("=" * 70)
    print("      BIBLELM BGE-LARGE-EN-V1.5 (1024-DIM) VECTOR RETRIEVAL BENCHMARK")
    print("=" * 70)

    jsonl_path = "data/embeddings/bge-large-en-v1.5-1024.jsonl"
    print(f"Loading precomputed verse vectors from {jsonl_path}...")
    t0 = time.time()
    
    refs = []
    texts = {}
    vectors = []
    
    with open(jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            ref = rec["reference"]
            if ref in texts:
                continue
            refs.append(ref)
            texts[ref] = rec.get("text", "")
            vectors.append(rec["embedding"])

    matrix = np.array(vectors, dtype=np.float32)
    # Normalize rows
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix = matrix / norms
    
    load_time = (time.time() - t0) * 1000
    print(f"Loaded {len(refs)} vectors in {load_time:.0f}ms (matrix shape: {matrix.shape})\n")

    print("Initializing query embedder (BAAI/bge-large-en-v1.5, 10 CPU threads)...")
    model = TextEmbedding(model_name="BAAI/bge-large-en-v1.5", threads=10)

    top1_correct = 0
    top3_correct = 0
    top5_correct = 0
    embed_latencies = []
    search_latencies = []
    top1_scores = []

    print("-" * 70)
    for idx, tc in enumerate(TEST_QUERIES, 1):
        q = tc["query"]
        expected = tc["expected"]
        
        # 1. Embed query
        t_start_embed = time.perf_counter()
        q_emb_gen = model.embed([q])
        q_emb = list(q_emb_gen)[0]
        embed_ms = (time.perf_counter() - t_start_embed) * 1000
        embed_latencies.append(embed_ms)

        # 2. Vector search (cosine similarity via dot product)
        t_start_search = time.perf_counter()
        q_vec = np.array(q_emb, dtype=np.float32)
        q_norm = np.linalg.norm(q_vec)
        if q_norm > 0:
            q_vec = q_vec / q_norm
        
        sims = np.dot(matrix, q_vec)
        top_indices = np.argsort(sims)[::-1][:5]
        search_ms = (time.perf_counter() - t_start_search) * 1000
        search_latencies.append(search_ms)

        top_refs = [refs[i] for i in top_indices]
        top_sims = [float(sims[i]) for i in top_indices]
        
        is_top1 = expected == top_refs[0]
        is_top3 = expected in top_refs[:3]
        is_top5 = expected in top_refs[:5]
        
        if is_top1:
            top1_correct += 1
        if is_top3:
            top3_correct += 1
        if is_top5:
            top5_correct += 1
            
        top1_scores.append(top_sims[0])
        status = "HIT (Top-1)" if is_top1 else ("HIT (Top-5)" if is_top5 else "MISS")
        
        print(f"[{idx}/{len(TEST_QUERIES)}] [{tc['category']}] -> {status}")
        print(f"  Query:    \"{q}\"")
        print(f"  Expected: {expected}")
        print(f"  Top 1:    {top_refs[0]} (score: {top_sims[0]:.4f}) -> {texts.get(top_refs[0], '')[:65]}...")
        if not is_top1:
            print(f"  Top 2:    {top_refs[1]} (score: {top_sims[1]:.4f})")
            print(f"  Top 3:    {top_refs[2]} (score: {top_sims[2]:.4f})")
        print(f"  Timing:   Embed {embed_ms:.1f}ms | Search {search_ms:.2f}ms | Total {embed_ms+search_ms:.1f}ms\n")

    n = len(TEST_QUERIES)
    print("=" * 70)
    print("                      BENCHMARK RESULTS SUMMARY                        ")
    print("=" * 70)
    print(f"Total Corpus Evaluated:      {len(refs)} verses (Genesis through Isaiah)")
    print(f"Top-1 Accuracy:             {top1_correct}/{n} ({top1_correct/n*100:.1f}%)")
    print(f"Top-3 Accuracy:             {top3_correct}/{n} ({top3_correct/n*100:.1f}%)")
    print(f"Top-5 Accuracy:             {top5_correct}/{n} ({top5_correct/n*100:.1f}%)")
    print(f"Average Top-1 Cosine Sim:   {np.mean(top1_scores):.4f}")
    print(f"Avg Query Embed Latency:    {np.mean(embed_latencies):.1f} ms")
    print(f"Avg Vector Search Latency:  {np.mean(search_latencies):.2f} ms")
    print(f"Total Retrieval Latency:    {np.mean(embed_latencies) + np.mean(search_latencies):.1f} ms")
    print("=" * 70)

if __name__ == "__main__":
    main()
