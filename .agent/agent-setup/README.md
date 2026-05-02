# Agent & Runtime Optimization Setup

This directory contains documentation for Claude agents and runtime performance optimization tools integrated into bibleLM.

## Quick Start

```bash
# Build the codebase knowledge graph (one-time)
npm run build:graph

# Optional: Watch for changes during development
npm run watch:graph
```

## Available Tools

### code-review-graph (Installed ✅)

**Purpose:** Generate a persistent codebase knowledge graph for token-efficient agent navigation.

**What it does:**
- Parses all source code files (99 files, 673 nodes, 4824 edges)
- Stores dependency graph in SQLite (`.code-review-graph/`)
- Provides MCP tools for agents to query code relationships without expensive grep/read cycles

**Token savings:** 60-70% fewer tokens on code exploration tasks.

**Setup:**
```bash
npm run build:graph    # Build graph (one-time after npm install)
npm run watch:graph    # Watch for changes during development
```

**IDE Configuration:**
- Claude Code: `.mcp.json` (auto-loaded)
- Cursor: `.cursor/mcp.json` (auto-loaded)
- Codex: `~/.codex/config.toml` (platform-wide)
- Antigravity: `.gemini/antigravity/mcp_config.json`

See [code-review-graph.md](./code-review-graph.md) for detailed usage.

---

## MCP Tools Available

Once configured, agents can use:

| Tool | Purpose |
|------|---------|
| `semantic_search_nodes` | Find functions/classes by name or keyword |
| `query_graph` | Trace callers, callees, imports, tests, dependencies |
| `detect_changes` | Risk-score code changes |
| `get_review_context` | Get token-efficient code snippets for review |
| `get_impact_radius` | Understand blast radius of a change |
| `get_affected_flows` | Find which execution paths are impacted |
| `get_architecture_overview` | High-level codebase structure |
| `list_communities` | View community clusters (tightly-coupled modules) |

---

## Agent Skills

Four agent skills are generated automatically:

1. **debug-issue.md** — Use graph to diagnose bugs faster
2. **explore-codebase.md** — Navigate via graph queries
3. **refactor-safely.md** — Trace impact before refactoring
4. **review-changes.md** — Efficient code review with risk scoring

All skills are in `.claude/skills/` and auto-discovered by Claude Code.

---

## For New Contributors

When cloning bibleLM:

```bash
# Install bibleLM dependencies
npm install

# Install code-review-graph
uv pip install code-review-graph

# Regenerate the graph
npm run build:graph

# Start developing (optional: keep watch running)
npm run watch:graph &
```

The graph is **not committed to git** (excluded in `.gitignore`). It's regenerated locally, ensuring consistency with your local codebase.

---

## Troubleshooting

**Graph not updating?**
```bash
# Rebuild from scratch
npm run build:graph
```

**MCP tools not showing in Claude Code?**
- Restart Claude Code
- Verify `.mcp.json` exists in project root
- Check that `code-review-graph` is installed: `uv pip show code-review-graph`

**Cursor not finding MCP config?**
- Verify `.cursor/mcp.json` exists
- Restart Cursor
- Check extension logs: View → Output → Cursor

**Watch mode crashing?**
```bash
# Stop watch
pkill -f "code-review-graph watch"

# Rebuild and restart
npm run build:graph
npm run watch:graph
```

---

## Performance Metrics

Current graph state (as of last build):

- **Nodes:** 673 (functions, classes, variables)
- **Edges:** 4824 (dependencies, imports, calls)
- **Files analyzed:** 99
- **Languages:** TypeScript, TSX, JavaScript, Bash
- **Database size:** 4.8 MB (local-only, not deployed)
- **Query time:** <100ms (average)

---

## Next Steps

- See [code-review-graph.md](./code-review-graph.md) for detailed documentation
- See [CLAUDE.md](../CLAUDE.md) for agent tool usage guidelines
- See [CONTRIBUTING.md](../../CONTRIBUTING.md) for setup context
