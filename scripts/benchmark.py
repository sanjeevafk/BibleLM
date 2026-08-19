#!/usr/bin/env python3
"""
BibleLM RAG Benchmark — RAGAS + DeepEval
=========================================
Runs the golden-eval-dataset against /api/evaluate and scores with both frameworks.

No OpenAI key required! Automatically uses your existing GROQ_API_KEY for judge evaluations,
or you can optionally use OpenAI, Ollama, or local models.

Usage:
    python3 scripts/benchmark.py [--base-url URL] [--secret SECRET] [--limit N]
                                  [--categories cat1,cat2] [--output results.json]
                                  [--framework ragas|deepeval|both]
                                  [--judge-provider groq|openai]
                                  [--judge-model MODEL]

Examples:
    # 100% Free with Groq (uses GROQ_API_KEY from .env.local):
    python3 scripts/benchmark.py --limit 5

    # Full benchmark with Groq judge:
    python3 scripts/benchmark.py --judge-provider groq

    # Run with OpenAI if you have a key:
    OPENAI_API_KEY=sk-... python3 scripts/benchmark.py --judge-provider openai

    # Only topical category:
    python3 scripts/benchmark.py --categories topical --limit 3
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

# Auto-load .env.local and .env
try:
    import dotenv
    env_local = Path(__file__).parent.parent / ".env.local"
    env_default = Path(__file__).parent.parent / ".env"
    if env_local.exists():
        dotenv.load_dotenv(env_local)
    elif env_default.exists():
        dotenv.load_dotenv(env_default)
except ImportError:
    pass

import requests

# ── Lazy imports helper ───────────────────────────────────────────────────────

def _require(package: str, install_hint: str = "") -> Any:
    try:
        return __import__(package)
    except ImportError:
        hint = f"  pip install {install_hint or package}"
        print(f"\n[ERROR] Missing package '{package}'.\n{hint}\n", file=sys.stderr)
        sys.exit(1)


# ── CLI Arguments ─────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="BibleLM RAGAS + DeepEval benchmark")
    p.add_argument("--base-url", default="http://localhost:3000", help="BibleLM server URL")
    p.add_argument("--secret", default=os.getenv("EVAL_SECRET", ""), help="EVAL_SECRET for /api/evaluate")
    p.add_argument("--limit", type=int, default=0, help="Max items to evaluate (0 = all)")
    p.add_argument(
        "--categories",
        default="",
        help="Comma-separated category filter (e.g. topical,theology). Empty = all.",
    )
    p.add_argument(
        "--framework",
        choices=["ragas", "deepeval", "both", "deterministic"],
        default="both",
        help="Which framework(s) to run (or 'deterministic' for no LLM judge)",
    )
    p.add_argument(
        "--judge-provider",
        choices=["groq", "openai", "nvidia", "orcarouter"],
        default="orcarouter" if os.getenv("ORCAROUTER_API_KEY") else ("nvidia" if os.getenv("NVIDIA_API_KEY") else "groq"),
        help="LLM Judge Provider (default: orcarouter using ORCAROUTER_API_KEY)",
    )
    p.add_argument(
        "--judge-model",
        default="",
        help="Model name for the judge (defaults: orcarouter/auto for orcarouter, meta/llama-3.1-8b-instruct for nvidia, openai/gpt-oss-20b for groq, gpt-4o-mini for openai)",
    )
    p.add_argument(
        "--output",
        default="benchmark_results.json",
        help="Path to save full JSON results",
    )
    p.add_argument(
        "--translation",
        default="BSB",
        choices=["BSB", "KJV", "WEB", "ASV", "NHEB"],
        help="Bible translation to use during evaluation",
    )
    return p.parse_args()


# ── Dataset loading ───────────────────────────────────────────────────────────

DATASET_PATH = Path(__file__).parent.parent / "data" / "golden-eval-dataset.json"


def load_dataset(args: argparse.Namespace) -> list[dict]:
    with open(DATASET_PATH) as f:
        items = json.load(f)

    if args.categories:
        cats = {c.strip().lower() for c in args.categories.split(",")}
        items = [i for i in items if i.get("category", "").lower() in cats]

    if args.limit:
        items = items[: args.limit]

    print(f"[dataset] Loaded {len(items)} items from golden-eval-dataset.json")
    return items


# ── API call ──────────────────────────────────────────────────────────────────

def call_evaluate(
    item: dict,
    base_url: str,
    secret: str,
    translation: str,
    retries: int = 3,
) -> dict | None:
    """Calls /api/evaluate and returns the JSON response."""
    messages = []

    # Inject conversation history for multi-turn items
    for msg in item.get("conversationHistory", []):
        messages.append({"role": msg["role"], "content": msg["content"]})

    messages.append({"role": "user", "content": item["query"]})

    payload = {"messages": messages, "translation": translation}
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["x-eval-secret"] = secret

    url = f"{base_url.rstrip('/')}/api/evaluate"

    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=60)
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 429:
                wait = 2 ** attempt
                print(f"  [rate-limit] {item['id']} — waiting {wait}s before retry {attempt}/{retries}")
                time.sleep(wait)
            else:
                print(f"  [error] {item['id']} — HTTP {resp.status_code}: {resp.text[:200]}")
                return None
        except Exception as e:
            print(f"  [error] {item['id']} attempt {attempt}/{retries} — {e}")
            if attempt < retries:
                time.sleep(2 ** attempt)

    return None


# ── Response collection ───────────────────────────────────────────────────────

def collect_responses(items: list[dict], args: argparse.Namespace) -> list[dict]:
    """Calls /api/evaluate for all items and returns enriched result dicts."""
    results = []
    total = len(items)

    for idx, item in enumerate(items, 1):
        print(f"[{idx}/{total}] Querying: {item['id']} — {item['query'][:60]}...")
        resp = call_evaluate(item, args.base_url, args.secret, args.translation)

        if resp is None:
            print(f"  [skip] {item['id']} — no response (is server running on {args.base_url}?)")
            continue

        results.append(
            {
                "id": item["id"],
                "category": item.get("category", ""),
                "intent": item.get("intent", ""),
                "query": item["query"],
                "answer": resp.get("answer", ""),
                "contexts": resp.get("contexts", []),
                "verses": resp.get("verses", []),
                "model": resp.get("model", ""),
                "translation": resp.get("translation", ""),
                "expected_verses": item.get("expectedVerses", []),
                "must_contain_verses": item.get("mustContainVerses", []),
                "expected_keywords": item.get("expectedKeywords", []),
                "negative_test_cases": item.get("negativeTestCases", []),
                "citation_grounding_threshold": item.get("citationGroundingThreshold", 0.85),
            }
        )

        # Light rate-limit courtesy delay
        time.sleep(0.4)

    print(f"\n[collect] {len(results)}/{total} items collected successfully.")
    return results


# ── Deterministic metrics (No LLM judge needed) ───────────────────────────────

def score_verse_recall(result: dict) -> float:
    must = result.get("must_contain_verses", [])
    if not must:
        return 1.0
    answer = result["answer"].lower()
    hits = sum(1 for ref in must if ref.lower().replace(":", " ").split()[0].lower() in answer or ref.lower() in answer)
    return hits / len(must)


def score_keyword_coverage(result: dict) -> float:
    keywords = result.get("expected_keywords", [])
    if not keywords:
        return 1.0
    answer = result["answer"].lower()
    hits = sum(1 for kw in keywords if kw.lower() in answer)
    return hits / len(keywords)


def score_negative_avoidance(result: dict) -> float:
    negatives = result.get("negative_test_cases", [])
    if not negatives:
        return 1.0
    answer = result["answer"].lower()
    for neg in negatives:
        if neg.lower() in answer:
            return 0.0
    return 1.0


def score_context_hit_rate(result: dict) -> float:
    must = result.get("must_contain_verses", [])
    if not must:
        return 1.0
    ctx_text = " ".join(result.get("contexts", [])).lower()
    hits = sum(1 for ref in must if ref.lower() in ctx_text)
    return hits / len(must)


def run_deterministic_metrics(results: list[dict]) -> dict:
    print("\n[deterministic] Computing structural metrics...")
    rows = []
    for r in results:
        rows.append(
            {
                "id": r["id"],
                "category": r["category"],
                "verse_recall": score_verse_recall(r),
                "keyword_coverage": score_keyword_coverage(r),
                "negative_avoidance": score_negative_avoidance(r),
                "context_hit_rate": score_context_hit_rate(r),
            }
        )

    avg = lambda key: sum(row[key] for row in rows) / len(rows) if rows else 0.0
    summary = {
        "verse_recall": avg("verse_recall"),
        "keyword_coverage": avg("keyword_coverage"),
        "negative_avoidance": avg("negative_avoidance"),
        "context_hit_rate": avg("context_hit_rate"),
    }

    print("\n  Deterministic metric averages:")
    for k, v in summary.items():
        bar = "█" * int(v * 20) + "░" * (20 - int(v * 20))
        print(f"  {k:<25} {bar} {v:.3f}")

    return {"per_item": rows, "averages": summary}


# ── RAGAS with Groq / OpenAI support ──────────────────────────────────────────

def get_ragas_judge(provider: str, model_name: str):
    """Initializes LLM and Embeddings for RAGAS without requiring OpenAI."""
    from ragas.llms import LangchainLLMWrapper
    from ragas.embeddings import LangchainEmbeddingsWrapper

    if provider == "orcarouter":
        from langchain_openai import ChatOpenAI
        orca_api_key = os.getenv("ORCAROUTER_API_KEY")
        if not orca_api_key:
            raise ValueError("ORCAROUTER_API_KEY environment variable is missing for OrcaRouter judge.")
        model = model_name or "orcarouter/auto"
        print(f"  [ragas] Using OrcaRouter Judge: {model}")
        chat_llm = ChatOpenAI(
            base_url="https://api.orcarouter.ai/v1",
            api_key=orca_api_key,
            model=model,
            temperature=0.0,
            max_tokens=4096,
            timeout=60
        )
        ragas_llm = LangchainLLMWrapper(chat_llm)
    elif provider == "nvidia":
        from langchain_openai import ChatOpenAI
        nvidia_api_key = os.getenv("NVIDIA_API_KEY")
        if not nvidia_api_key:
            raise ValueError("NVIDIA_API_KEY environment variable is missing for NVIDIA judge.")
        model = model_name or "meta/llama-3.1-8b-instruct"
        print(f"  [ragas] Using NVIDIA NIM Judge: {model}")
        chat_llm = ChatOpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=nvidia_api_key,
            model=model,
            temperature=0.0,
            max_tokens=4096,
            timeout=60
        )
        ragas_llm = LangchainLLMWrapper(chat_llm)
    elif provider == "groq":
        from langchain_openai import ChatOpenAI
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY environment variable is missing for Groq judge.")
        model = model_name or "openai/gpt-oss-20b"
        print(f"  [ragas] Using Groq Judge: {model}")
        chat_llm = ChatOpenAI(
            base_url="https://api.groq.com/openai/v1",
            api_key=groq_api_key,
            model=model,
            temperature=0.0,
            max_tokens=4096,
            timeout=60
        )
        ragas_llm = LangchainLLMWrapper(chat_llm)
    elif provider == "openai":
        from langchain_openai import ChatOpenAI
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is missing for OpenAI judge.")
        model = model_name or "gpt-4o-mini"
        print(f"  [ragas] Using OpenAI Judge: {model}")
        chat_llm = ChatOpenAI(model=model, api_key=openai_api_key, temperature=0.0)
        ragas_llm = LangchainLLMWrapper(chat_llm)
    else:
        raise ValueError(f"Unsupported provider: {provider}")

    # Local, free embeddings for RAGAS metrics that require embeddings (e.g. answer_relevancy)
    try:
        from langchain_community.embeddings import FastEmbedEmbeddings
        embeddings = LangchainEmbeddingsWrapper(FastEmbedEmbeddings())
    except Exception:
        try:
            from langchain_community.embeddings import HuggingFaceEmbeddings
            embeddings = LangchainEmbeddingsWrapper(HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2"))
        except Exception:
            embeddings = None

    return ragas_llm, embeddings


def run_ragas(results: list[dict], args: argparse.Namespace) -> dict:
    print("\n[ragas] Setting up RAGAS evaluation...")
    _require("ragas")

    from ragas import evaluate
    from ragas.metrics import (
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall,
    )
    from datasets import Dataset

    try:
        ragas_llm, ragas_embeddings = get_ragas_judge(args.judge_provider, args.judge_model)
    except Exception as e:
        print(f"  [ragas] Judge setup failed: {e}")
        return {"error": str(e)}

    ragas_data = {
        "question": [],
        "answer": [],
        "contexts": [],
        "ground_truth": [],
    }

    for r in results:
        if not r["answer"] or not r["contexts"]:
            continue
        ragas_data["question"].append(r["query"])
        ragas_data["answer"].append(r["answer"])
        ragas_data["contexts"].append(r["contexts"])
        gt_parts = r.get("expected_verses", []) + r.get("expected_keywords", [])
        ragas_data["ground_truth"].append(
            "This answer should reference: " + ", ".join(gt_parts) if gt_parts else r["query"]
        )

    if not ragas_data["question"]:
        print("  [ragas] No usable items — skipping.")
        return {}

    ds = Dataset.from_dict(ragas_data)

    metrics = [faithfulness, answer_relevancy, context_precision, context_recall]
    for m in metrics:
        m.llm = ragas_llm
        if ragas_embeddings and hasattr(m, "embeddings"):
            m.embeddings = ragas_embeddings

    try:
        print("  [ragas] Scoring evaluation dataset...")
        score = evaluate(ds, metrics=metrics, llm=ragas_llm, embeddings=ragas_embeddings)
        score_df = score.to_pandas()
        score_dict = score_df.mean(numeric_only=True).to_dict()

        print("\n  RAGAS metric averages:")
        for k, v in score_dict.items():
            bar = "█" * int(v * 20) + "░" * (20 - int(v * 20))
            print(f"  {k:<30} {bar} {v:.3f}")

        return {"averages": score_dict, "per_item": score_df.to_dict(orient="records")}
    except Exception as e:
        print(f"  [ragas] Error during evaluation: {e}")
        return {"error": str(e)}


# ── DeepEval with Groq / OpenAI support ───────────────────────────────────────

def get_deepeval_judge(provider: str, model_name: str):
    """Returns a DeepEvalBaseLLM instance powered by Groq or OpenAI."""
    from deepeval.models.base_model import DeepEvalBaseLLM

    if provider in ("orcarouter", "nvidia", "groq"):
        import re, json, asyncio, requests, time
        from langchain_openai import ChatOpenAI

        if provider == "orcarouter":
            api_key = os.getenv("ORCAROUTER_API_KEY")
            if not api_key:
                raise ValueError("ORCAROUTER_API_KEY environment variable is missing for OrcaRouter judge.")
            target_model = model_name or "orcarouter/auto"
            base_url = "https://api.orcarouter.ai/v1"
            print(f"  [deepeval] Using OrcaRouter Judge: {target_model}")
        elif provider == "nvidia":
            api_key = os.getenv("NVIDIA_API_KEY")
            if not api_key:
                raise ValueError("NVIDIA_API_KEY environment variable is missing for NVIDIA judge.")
            target_model = model_name or "meta/llama-3.1-8b-instruct"
            base_url = "https://integrate.api.nvidia.com/v1"
            print(f"  [deepeval] Using NVIDIA NIM Judge: {target_model}")
        else:
            api_key = os.getenv("GROQ_API_KEY")
            if not api_key:
                raise ValueError("GROQ_API_KEY environment variable is missing for Groq judge.")
            target_model = model_name or "openai/gpt-oss-20b"
            base_url = "https://api.groq.com/openai/v1"
            print(f"  [deepeval] Using Groq Judge: {target_model}")

        def extract_clean_json(text: str) -> str:
            text = text.strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"\s*```$", "", text).strip()
            match = re.search(r"\{[\s\S]*\}", text)
            if match:
                candidate = match.group(0)
                try:
                    json.loads(candidate)
                    return candidate
                except Exception:
                    pass
            return text

        class CustomLLMJudge(DeepEvalBaseLLM):
            def __init__(self):
                self.model_name = target_model
                self.base_url = base_url
                self.api_key = api_key
                super().__init__(target_model)

            def load_model(self):
                return None

            def generate(self, prompt: str) -> str:
                time.sleep(1.5)
                url = f"{self.base_url.rstrip('/')}/chat/completions"
                headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
                payload = {
                    "model": self.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.0,
                    "max_tokens": 4096
                }
                for attempt in range(1, 4):
                    try:
                        res = requests.post(url, headers=headers, json=payload, timeout=60)
                        if res.status_code == 200:
                            content = res.json()["choices"][0]["message"]["content"]
                            return extract_clean_json(str(content))
                        elif res.status_code == 429:
                            time.sleep(2 ** attempt)
                    except Exception as e:
                        if attempt == 3:
                            raise e
                        time.sleep(2 ** attempt)
                raise RuntimeError("Failed to generate response after retries")

            async def a_generate(self, prompt: str) -> str:
                return await asyncio.to_thread(self.generate, prompt)

            def generate_with_schema(self, prompt: str, schema: Any):
                prompt_with_instructions = prompt + "\nIMPORTANT: Respond ONLY with valid raw JSON format matching the schema."
                res = self.generate(prompt_with_instructions)
                clean = extract_clean_json(res)
                try:
                    return schema.model_validate_json(clean)
                except Exception as first_err:
                    # Repair trailing commas or unescaped newlines inside strings
                    repaired = re.sub(r',\s*([\]}])', r'\1', clean)
                    try:
                        return schema.model_validate_json(repaired)
                    except Exception:
                        raise first_err

            async def a_generate_with_schema(self, prompt: str, schema: Any):
                return await asyncio.to_thread(self.generate_with_schema, prompt, schema)

            def get_model_name(self) -> str:
                return self.model_name

        return CustomLLMJudge()

    elif provider == "openai":
        from langchain_openai import ChatOpenAI
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY environment variable is missing for OpenAI judge.")
        target_model = model_name or "gpt-4o-mini"
        print(f"  [deepeval] Using OpenAI Judge: {target_model}")

        class OpenAIJudge(DeepEvalBaseLLM):
            def __init__(self):
                self.model_name = target_model
                self.chat = ChatOpenAI(model=target_model, api_key=openai_api_key, temperature=0.0)
                super().__init__(target_model)

            def load_model(self):
                return self.chat

            def generate(self, prompt: str) -> str:
                res = self.chat.invoke(prompt)
                return str(res.content)

            async def a_generate(self, prompt: str) -> str:
                res = await self.chat.ainvoke(prompt)
                return str(res.content)

            def get_model_name(self) -> str:
                return self.model_name

        return OpenAIJudge()

    else:
        raise ValueError(f"Unsupported provider: {provider}")


def run_deepeval(results: list[dict], args: argparse.Namespace) -> dict:
    print("\n[deepeval] Setting up DeepEval evaluation...")
    _require("deepeval")

    from deepeval import evaluate as dv_evaluate
    from deepeval.test_case import LLMTestCase
    from deepeval.metrics import (
        FaithfulnessMetric,
        AnswerRelevancyMetric,
        ContextualPrecisionMetric,
        ContextualRecallMetric,
    )

    try:
        judge = get_deepeval_judge(args.judge_provider, args.judge_model)
    except Exception as e:
        print(f"  [deepeval] Judge setup failed: {e}")
        return {"error": str(e)}

    test_cases = []
    for r in results:
        if not r["answer"] or not r["contexts"]:
            continue

        gt_parts = r.get("must_contain_verses", []) + r.get("expected_keywords", [])
        expected_output = "The response should cover: " + ", ".join(gt_parts) if gt_parts else r["query"]

        trimmed_contexts = [ctx[:1200] for ctx in r["contexts"][:3]] if r.get("contexts") else []
        test_cases.append(
            LLMTestCase(
                input=r["query"],
                actual_output=r["answer"],
                expected_output=expected_output,
                retrieval_context=trimmed_contexts,
            )
        )

    if not test_cases:
        print("  [deepeval] No usable items — skipping.")
        return {}

    faith_m = FaithfulnessMetric(threshold=0.5, model=judge, verbose_mode=False)
    relev_m = AnswerRelevancyMetric(threshold=0.5, model=judge, verbose_mode=False)

    try:
        print("  [deepeval] Scoring evaluation dataset...", flush=True)
        per_item = []
        totals: dict[str, list[float]] = {"faithfulness": [], "answer_relevancy": []}

        for idx, tc in enumerate(test_cases, 1):
            f_score, r_score = None, None
            f_reason, r_reason = "", ""

            try:
                faith_m.measure(tc)
                f_score = faith_m.score
                if f_score is not None:
                    totals["faithfulness"].append(f_score)
                f_reason = faith_m.reason or ""
            except Exception as fe:
                f_reason = f"error: {fe}"

            try:
                relev_m.measure(tc)
                r_score = relev_m.score
                if r_score is not None:
                    totals["answer_relevancy"].append(r_score)
                r_reason = relev_m.reason or ""
            except Exception as re_err:
                r_reason = f"error: {re_err}"

            per_item.append({
                "input": tc.input,
                "faithfulness": f_score,
                "faithfulness_reason": f_reason,
                "answer_relevancy": r_score,
                "answer_relevancy_reason": r_reason,
            })
            f_str = f"{f_score:.2f}" if f_score is not None else "N/A"
            r_str = f"{r_score:.2f}" if r_score is not None else "N/A"
            print(f"  [deepeval {idx}/{len(test_cases)}] Faithfulness: {f_str} | Answer Relevancy: {r_str}", flush=True)

        averages = {k: sum(v) / len(v) for k, v in totals.items() if v}

        print("\n  DeepEval metric averages:")
        for k, v in averages.items():
            bar = "█" * int(v * 20) + "░" * (20 - int(v * 20))
            print(f"  {k:<35} {bar} {v:.3f}")

        return {"averages": averages, "per_item": per_item}
    except Exception as e:
        print(f"  [deepeval] Error during evaluation: {e}")
        return {"error": str(e)}


# ── Category breakdown ────────────────────────────────────────────────────────

def category_breakdown(results: list[dict], deterministic: dict) -> dict:
    by_cat: dict[str, list[dict]] = {}
    for row in deterministic.get("per_item", []):
        result = next((r for r in results if r["id"] == row["id"]), None)
        cat = result["category"] if result else "unknown"
        by_cat.setdefault(cat, []).append(row)

    summary = {}
    for cat, rows in by_cat.items():
        avg = lambda key: sum(r[key] for r in rows) / len(rows)
        summary[cat] = {
            "count": len(rows),
            "verse_recall": avg("verse_recall"),
            "keyword_coverage": avg("keyword_coverage"),
            "negative_avoidance": avg("negative_avoidance"),
            "context_hit_rate": avg("context_hit_rate"),
        }
    return summary


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()

    print("=" * 60)
    print("  BibleLM RAG Benchmark — RAGAS + DeepEval")
    print("=" * 60)
    print(f"  Server:         {args.base_url}")
    print(f"  Framework:      {args.framework}")
    print(f"  Judge Provider: {args.judge_provider}")
    print(f"  Judge Model:    {args.judge_model or ('openai/gpt-oss-20b' if args.judge_provider == 'groq' else 'gpt-4o-mini')}")
    print(f"  Translation:    {args.translation}")
    print(f"  Limit:          {args.limit or 'all'}")
    print(f"  Categories:     {args.categories or 'all'}")
    print("=" * 60 + "\n")

    # 1. Load dataset
    items = load_dataset(args)

    # 2. Collect responses from /api/evaluate
    results = collect_responses(items, args)
    if not results:
        print("\n[abort] No responses collected.")
        print(f"Make sure your Next.js server is running: npm run dev")
        sys.exit(1)

    # 3. Deterministic metrics (always run, no LLM judge needed)
    deterministic = run_deterministic_metrics(results)
    cat_summary = category_breakdown(results, deterministic)

    # 4. Framework-specific LLM-judged metrics
    ragas_results: dict = {}
    deepeval_results: dict = {}

    if args.framework in ("ragas", "both"):
        ragas_results = run_ragas(results, args)

    if args.framework in ("deepeval", "both"):
        deepeval_results = run_deepeval(results, args)

    # 5. Save full output
    output = {
        "meta": {
            "base_url": args.base_url,
            "translation": args.translation,
            "framework": args.framework,
            "judge_provider": args.judge_provider,
            "total_items": len(results),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "deterministic": deterministic,
        "category_breakdown": cat_summary,
        "ragas": ragas_results,
        "deepeval": deepeval_results,
        "raw_results": results,
    }

    output_path = Path(args.output)
    output_path.write_text(json.dumps(output, indent=2, default=str))
    print(f"\n[done] Full results saved to: {output_path.resolve()}")

    # 6. Final summary table
    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)

    det_avg = deterministic.get("averages", {})
    print("\n  Deterministic (structural, no LLM judge):")
    print(f"    Verse Recall:       {det_avg.get('verse_recall', 0):.3f}")
    print(f"    Keyword Coverage:   {det_avg.get('keyword_coverage', 0):.3f}")
    print(f"    Negative Avoidance: {det_avg.get('negative_avoidance', 0):.3f}")
    print(f"    Context Hit Rate:   {det_avg.get('context_hit_rate', 0):.3f}")

    if ragas_results.get("averages"):
        print(f"\n  RAGAS ({args.judge_provider} judge):")
        for k, v in ragas_results["averages"].items():
            print(f"    {k:<30} {v:.3f}")

    if deepeval_results.get("averages"):
        print(f"\n  DeepEval ({args.judge_provider} judge):")
        for k, v in deepeval_results["averages"].items():
            print(f"    {k:<35} {v:.3f}")

    print("\n  Category breakdown (verse_recall):")
    for cat, scores in sorted(cat_summary.items()):
        print(f"    {cat:<20} {scores['verse_recall']:.3f}  (n={scores['count']})")

    print("=" * 60)


if __name__ == "__main__":
    main()
