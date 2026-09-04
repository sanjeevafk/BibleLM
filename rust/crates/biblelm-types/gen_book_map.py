#!/usr/bin/env python3
"""Regenerate crates/biblelm-types/src/book_map.rs from the TS source of truth.

Usage (repo root):  python3 rust/crates/biblelm-types/gen_book_map.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TS = ROOT / "scripts" / "build-graph-index.ts"
OUT = Path(__file__).parent / "src" / "book_map.rs"

body = re.search(
    r"const BOOK_MAP: Record<string, string> = \{(.*?)\};", TS.read_text(), re.S
).group(1)
pairs = re.findall(r"'([^']+)'\s*:\s*'([^']+)'|(\w+)\s*:\s*'([^']+)'", body)
entries = sorted((q1 or u, v1 or v2) for q1, v1, u, v2 in pairs)

lines = [
    "// AUTO-GENERATED from scripts/build-graph-index.ts BOOK_MAP — do not hand-edit.",
    "// Regenerate: python3 rust/crates/biblelm-types/gen_book_map.py",
    "/// (alias, BOOK_CODE) sorted for binary search. Mirrors TS normalizeBook: strip",
    "/// non-alphanumeric, lowercase, then exact lookup.",
    "pub static BOOK_ALIASES: &[(&str, &str)] = &[",
    *(f'    ("{k}", "{v}"),' for k, v in entries),
    "];",
]
OUT.write_text("\n".join(lines) + "\n")
print(f"wrote {OUT} ({len(entries)} aliases)")
