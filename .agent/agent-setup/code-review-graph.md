# code-review-graph — Codebase Knowledge Graph Setup

## Overview

**code-review-graph** builds a persistent knowledge graph of your codebase and provides MCP tools for agents to navigate code relationships efficiently, reducing token spend by 60-70% on exploration tasks.

## Installation Status

✅ **Already installed** in bibleLM (v2.3.2 via `uv pip`)

```bash
uv pip show code-review-graph
# Name: code-review-graph
# Version: 2.3.2
# ...
```

## Initial Setup

### 1. Build the Graph (One-time)

```bash
npm run build:graph
```

**What happens:**
- Parses all 99 source files
- Builds dependency graph (673 nodes, 4824 edges)
- Stores in SQLite database: `.code-review-graph/graph.db`
- Creates FTS (full-text search) indexes for fast queries

**Outputs:**
```
✅ 99 files parsed
✅ 673 unique nodes (functions, classes, variables, types)
✅ 4824 edges (calls, imports, dependencies)
✅ .code-review-graph/graph.db created (4.8 MB)
```

### 2. Verify MCP Configuration

**Claude Code:**
```bash
cat .mcp.json
# {
#   "mcpServers": {
#     "code-review-graph": {
#       "command": "uvx",
#       "args": ["code-review-graph", "serve"],
#       "type": "stdio"
#     }
#   }
# }
```

**Cursor:**
```bash
cat .cursor/mcp.json
# (same structure as above)
```

### 3. Restart IDE

- **Claude Code:** Restart window (Cmd/Ctrl+K → "reload window")
- **Cursor:** Restart IDE

MCP tools should now be available.

---

## Usage Patterns

### Pattern 1: Find a Specific Function

Instead of:
```bash
grep -r "function parseVerse" lib/
```

Use graph:
```
Agent Query: "Find all functions named 'parseVerse' and their callers"
Tool: semantic_search_nodes(pattern="parseVerse")
Response: 3 matches with full call graph (token-efficient)
```

**Token savings:** ~200-300 tokens (vs. grep output bloat)

### Pattern 2: Understand Module Dependencies

Instead of:
```bash
# Manual tracing of imports across lib/retrieval/*.ts
```

Use graph:
```
Tool: query_graph(pattern="callees_of:retrieveVerses")
Response: All functions called by retrieveVerses + their signatures
```

**Token savings:** ~500-1000 tokens (vs. manual read/trace cycle)

### Pattern 3: Code Review with Risk Scoring

Instead of:
```bash
# Read entire changed files to understand impact
```

Use graph:
```
Tool: detect_changes(commit="HEAD")
Response: Risk scores + affected flows (high/medium/low impact)
```

**Token savings:** ~1000-2000 tokens (vs. reading full file diffs)

---

## Agent Skills

### 1. debug-issue.md

**When to use:** Bug investigation, root-cause analysis

**How it works:**
1. Query graph for functions involved in the error
2. Trace callers to find entry points
3. Get signatures and dependencies
4. Focused debugging without exploring unrelated code

**Example:**
```
User: "Why does `/api/chat` sometimes return stale verses?"
Agent: Uses graph to trace chat route → retrieval → cache layers
Result: Found mismatch in cache-key generation (10 min vs. 1 hour)
```

### 2. explore-codebase.md

**When to use:** Onboarding, architecture questions, feature planning

**How it works:**
1. Query high-level architecture (`get_architecture_overview`)
2. List community clusters (tightly-coupled modules)
3. Trace dependencies between clusters
4. Understand data flow end-to-end

**Example:**
```
User: "Show me how verses flow from database to frontend"
Agent: Traces db → retrieval → llm → response formatting
Result: Visual of entire flow with token efficiency
```

### 3. refactor-safely.md

**When to use:** Renaming, moving functions, major refactors

**How it works:**
1. Identify all callers and dependents
2. Risk-score the change
3. Suggest refactor order (atomic steps)
4. Verify no dangling references

**Example:**
```
User: "Refactor the retrieval layer"
Agent: Traces all 47 dependents, suggests 3-phase refactor
Result: Safe change plan with commit boundaries
```

### 4. review-changes.md

**When to use:** Code review, pre-merge quality checks

**How it works:**
1. Detect changed nodes in current branch
2. Risk-score each change
3. Show affected flows and downstream impact
4. Suggest test coverage gaps

**Example:**
```
User: "Review this PR"
Agent: Detects 12 functions changed, high-risk in retrieval layer
Result: "Suggest adding cache invalidation test + E2E for stale data"
```

---

## Watch Mode (Development)

Keep the graph in sync during active development:

```bash
npm run watch:graph
```

**What it does:**
- Monitors all source files for changes
- Incremental updates (fast, not full rebuild)
- Maintains graph consistency in real-time
- Automatically runs on git commits (via pre-commit hook)

**When to use:**
- During feature development (long sessions)
- When pair-programming with agents
- During debugging sessions

**To stop:**
```bash
pkill -f "code-review-graph watch"
```

---

## Graph Statistics

Current state:

```
Files Analyzed: 99
  app/: 3 files
  components/: 6 files
  lib/: 20 files
  scripts/: 12 files
  tests/: 18 files
  (+ config, data, datasets)

Nodes: 673
  - Functions: ~400
  - Classes: ~80
  - Interfaces/Types: ~120
  - Variables/Constants: ~73

Edges: 4824
  - Imports: ~1200
  - Calls: ~2500
  - Extends/Implements: ~300
  - Type references: ~824

Languages: TypeScript (73%), TSX (15%), JavaScript (10%), Bash (2%)

Database Size: 4.8 MB
Build Time: ~2-3 seconds
```

---

## Gitignore & Deployment

The graph database is **not committed** to git:

```gitignore
.code-review-graph/
```

**Why:**
- Database is local-only (not needed on Vercel)
- Regenerated from source on dev machines
- Keeps repo size small
- No Vercel bundle bloat

**For Vercel deployment:**
- Only `.mcp.json` and `.cursor/mcp.json` are deployed (negligible size)
- Graph generation happens client-side during development
- Zero impact on production bundle

---

## Troubleshooting

### Issue: "code-review-graph not found" in npm run

**Fix:**
```bash
which code-review-graph  # Should point to .venv
uv pip install code-review-graph  # Reinstall if missing
```

### Issue: MCP tools not showing in Claude Code

**Fix:**
1. Verify `.mcp.json` exists: `ls -la .mcp.json`
2. Verify graph is built: `ls -la .code-review-graph/graph.db`
3. Restart Claude Code
4. Check MCP server logs: View → Output → MCP

### Issue: Graph queries are slow

**Fix:**
```bash
# Rebuild graph
npm run build:graph

# Check database integrity
uv run code-review-graph status
```

### Issue: Watch mode not updating on file change

**Fix:**
```bash
# Stop current watch
pkill -f "code-review-graph watch"

# Rebuild and restart
npm run build:graph
npm run watch:graph
```

---

## Advanced Commands

### Generate Interactive HTML Visualization

```bash
uv run code-review-graph visualize
# Opens graph.html in browser
```

### Generate Markdown Wiki

```bash
uv run code-review-graph wiki
# Creates docs/codebase-wiki/ with architecture overview
```

### Run Benchmarks

```bash
uv run code-review-graph eval
# Performance metrics on graph queries
```

### Detect Change Impact (On Current Branch)

```bash
uv run code-review-graph detect-changes
# Shows which nodes changed vs main
```

---

## References

- **CLAUDE.md** — Agent tool usage guidelines
- **AGENTS.md** — Available agent skills
- **CONTRIBUTING.md** — Development setup
- **Official Docs:** https://github.com/tirth8205/code-review-graph
