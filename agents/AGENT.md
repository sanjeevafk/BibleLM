# BibleLM — Agent Instructions

**Stack:** Next.js 15 App Router, TypeScript, React, Tailwind, Supabase, Python  
**Core:** Full-stack biblical research LLM with RAG (semantic search + LLM chat)

---

## Project Layout

| Dir | Purpose |
|-----|---------|
| `app/` | Next.js routes + API handlers |
| `components/` | UI — Chat, Message, TranslationSelect |
| `lib/` | Retrieval, morphology, translations |
| `scripts/` | Build, security checks |
| `data/` | Indexes + morphology data |
| `local-docs/` | Sprint-specific context (check here first) |

---

## Before Shipping

```bash
./scripts/security/security-check.sh
./scripts/security/supply-chain-check.sh
npm run type-check          # strict: true required
```

---

## Knowledge Graph (code-review-graph MCP)

This project has a persistent codebase knowledge graph backed by SQLite.  
**ALWAYS use graph tools BEFORE Grep/Glob/Read** — the graph is faster, cheaper (60–70% fewer tokens), and gives structural context (callers, dependents, test coverage) that file-scanning cannot.

### When to use graph tools first

| Task | Use instead of |
|------|---------------|
| Exploring code | `semantic_search_nodes` or `query_graph` instead of Grep |
| Understanding impact | `get_impact_radius` instead of tracing imports manually |
| Code review | `detect_changes` + `get_review_context` instead of reading files |
| Finding relationships | `query_graph` with `callers_of`/`callees_of`/`imports_of`/`tests_for` |
| Architecture questions | `get_architecture_overview` + `list_communities` |

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Tool reference

| Tool | Use when |
|------|---------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `list_communities` | View community clusters (tightly-coupled modules) |
| `refactor_tool` | Planning renames, finding dead code |

### Graph workflow

1. The graph auto-updates on file changes (via PostToolUse hooks).
2. Start every session: `code-review-graph status`
3. Use `detect_changes` for code review.
4. Use `get_affected_flows` to understand impact.
5. Use `query_graph` pattern=`tests_for` to check coverage.

### Token efficiency rules

- **ALWAYS** start with `get_minimal_context(task="<your task>")` before any other graph tool.
- Use `detail_level="minimal"` on all calls. Only escalate to `"standard"` when minimal is insufficient.
- Target: complete any review/debug/refactor task in **≤5 tool calls** and **≤800 total output tokens**.

### Graph stats (last build)

| Metric | Value |
|--------|-------|
| Nodes | 673 (functions, classes, variables) |
| Edges | 4824 (dependencies, imports, calls) |
| Files analyzed | 99 |
| Languages | TypeScript, TSX, JavaScript, Bash |
| DB size | 4.8 MB (local-only, not deployed) |
| Query time | < 100 ms |

---

## Setup (new contributors)

```bash
npm install                     # install bibleLM deps
uv pip install code-review-graph
npm run build:graph             # build graph (one-time)
npm run watch:graph             # optional: keep graph in sync during dev
```

> The graph is excluded from git (`.gitignore`). Regenerate it locally after cloning.

### MCP config by IDE

| IDE | Config path |
|-----|-------------|
| Claude Code / Antigravity | `.mcp.json` (auto-loaded) |
| Cursor | `.cursor/mcp.json` (auto-loaded) |
| Codex | `~/.codex/config.toml` (platform-wide) |

```json
{
  "mcpServers": {
    "code-review-graph": {
      "command": "uvx",
      "args": ["code-review-graph", "serve"],
      "type": "stdio"
    }
  }
}
```

### Claude Code hooks (`.claude/settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [{ "type": "command", "command": "code-review-graph update --skip-flows", "timeout": 30 }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "code-review-graph status", "timeout": 10 }]
      }
    ]
  }
}
```

---

## Troubleshooting

**Graph not updating?**
```bash
npm run build:graph   # rebuild from scratch
```

**MCP tools not showing in Claude Code?**
- Restart Claude Code.
- Verify `.mcp.json` exists in project root.
- Check install: `uv pip show code-review-graph`

**Cursor not finding MCP config?**
- Verify `.cursor/mcp.json` exists, then restart Cursor.
- Check: View → Output → Cursor.

**Watch mode crashing?**
```bash
pkill -f "code-review-graph watch"
npm run build:graph && npm run watch:graph
```

---

## Skills

Four task playbooks — use these patterns when working in this repo.

### Explore Codebase

Navigate and understand structure using the knowledge graph.

1. `list_graph_stats` — see overall codebase metrics.
2. `get_architecture_overview` — high-level community structure.
3. `list_communities` → `get_community` — drill into major modules.
4. `semantic_search_nodes` — find specific functions or classes.
5. `query_graph` with `callers_of`, `callees_of`, `imports_of` — trace relationships.
6. `list_flows` + `get_flow` — understand execution paths.

> Tip: start broad (stats, architecture) then narrow. Use `children_of` on a file to list its functions. Use `find_large_functions` to spot complexity.

---

### Debug Issue

Systematically trace and debug issues using the graph.

1. `semantic_search_nodes` — find code related to the issue.
2. `query_graph` with `callers_of` + `callees_of` — trace call chains.
3. `get_flow` — see full execution paths through suspected areas.
4. `detect_changes` — check if recent changes caused the issue.
5. `get_impact_radius` — see what else is affected.

> Tip: check both callers and callees for full context. Recent changes are the most common source of new bugs.

---

### Review Changes

Perform a risk-aware code review using the graph.

1. `detect_changes` — get risk-scored change analysis.
2. `get_affected_flows` — find impacted execution paths.
3. `query_graph` pattern=`tests_for` — check test coverage on high-risk functions.
4. `get_impact_radius` — understand the blast radius.
5. For untested changes, suggest specific test cases.

**Output format:** group findings by risk level (high / medium / low) with:
- What changed and why it matters
- Test coverage status
- Suggested improvements
- Overall merge recommendation

---

### Refactor Safely

Plan and execute refactoring with confidence.

1. `refactor_tool` mode=`suggest` — get community-driven suggestions.
2. `refactor_tool` mode=`dead_code` — find unreferenced code.
3. `refactor_tool` mode=`rename` — preview all affected locations before applying.
4. `apply_refactor_tool` with `refactor_id` — apply renames.
5. `detect_changes` — verify the refactoring impact.

**Safety checks:**
- Always preview before applying (`rename` mode gives you an edit list).
- `get_impact_radius` before major refactors.
- `get_affected_flows` to confirm no critical paths are broken.
- `find_large_functions` to identify decomposition targets.
