# Troubleshooting Agent & Runtime Setup

## Quick Diagnostics

Run this to check your setup:

```bash
# 1. Check installations
uv pip show code-review-graph
npm list | grep -i graph
which code-review-graph

# 2. Check configurations
ls -la .mcp.json .cursor/mcp.json .claude/settings.json

# 3. Check graph database
ls -la .code-review-graph/graph.db
uv run code-review-graph status

# 4. Check git pre-commit hooks
cat .git/hooks/pre-commit | grep code-review
```

---

## Common Issues

### ❌ "npm run build:graph" fails

**Error:** `command not found: code-review-graph`

**Causes & Fixes:**

1. **Package not installed**
   ```bash
   uv pip install code-review-graph
   uv pip show code-review-graph  # verify
   ```

2. **Wrong Python environment**
   ```bash
   # Make sure uv is using the project .venv
   which uv
   uv venv  # create if missing
   source .venv/bin/activate  # activate
   uv pip install code-review-graph
   ```

3. **npm PATH issue**
   ```bash
   # Verify npm script finds uvx
   which uvx
   npm run build:graph --verbose
   ```

---

### ❌ "MCP tools not showing in Claude Code"

**Symptoms:** Graph queries unavailable, tool list incomplete

**Diagnosis:**
```bash
# 1. Check MCP config
cat .mcp.json
# Should show: "command": "uvx", "args": ["code-review-graph", "serve"]

# 2. Check graph exists
ls -la .code-review-graph/graph.db
# Should be 4.8 MB+

# 3. Test MCP server manually
uvx code-review-graph serve
# Should start without errors; press Ctrl+C to stop
```

**Fixes:**
1. Rebuild graph: `npm run build:graph`
2. Restart Claude Code (Cmd/Ctrl+K → "reload window")
3. Check MCP logs: View → Output → "MCP"
4. Verify `code-review-graph` is in `.venv`:
   ```bash
   ls -la .venv/bin/code-review-graph
   ```

---

### ❌ Cursor not finding graph

**Symptoms:** Cursor IDE doesn't show MCP tools

**Diagnosis:**
```bash
cat .cursor/mcp.json
# Should exist and match .mcp.json structure
```

**Fixes:**
1. Verify file exists: `ls -la .cursor/mcp.json`
2. Rebuild: `npm run build:graph`
3. Restart Cursor completely (close all windows)
4. Check Cursor extension logs:
   - Settings → Output → "Cursor"

---

### ❌ Watch mode crashes

**Error:** `FileNotFoundError` or graph corruption

**Fix:**
```bash
# 1. Stop watch
pkill -f "code-review-graph watch"

# 2. Rebuild from scratch
npm run build:graph

# 3. Start watch again
npm run watch:graph &
```

**If still broken:**
```bash
# Remove corrupted database
rm -rf .code-review-graph/

# Rebuild
npm run build:graph
```

---

### ❌ Graph queries are slow

**Symptoms:** `semantic_search_nodes` takes >1s, UI hangs

**Causes:**
- Database not optimized (missing indexes)
- Large codebase (rebuild indexed structure)
- Watch mode in conflict with queries

**Fixes:**
```bash
# 1. Stop watch mode
pkill -f "code-review-graph watch"

# 2. Rebuild and reindex
npm run build:graph

# 3. Verify health
uv run code-review-graph status

# 4. Restart watch if needed
npm run watch:graph
```

---

### ❌ Pre-commit hook interfering with git

**Symptoms:** `git commit -m "..."` hangs or fails

**Diagnosis:**
```bash
cat .git/hooks/pre-commit | head -20
```

**Fix:**
```bash
# If hook is outdated, regenerate it
npm run build:graph

# Or temporarily disable
chmod -x .git/hooks/pre-commit   # disable
git commit ...
chmod +x .git/hooks/pre-commit   # re-enable
```

---

### ❌ .gitignore not excluding graph

**Symptoms:** `.code-review-graph/` showing in `git status`

**Diagnosis:**
```bash
git check-ignore -v .code-review-graph/
# Should return: .gitignore:XX:	.code-review-graph/
```

**Fix:**
```bash
# Verify .gitignore has the entry
grep "code-review-graph" .gitignore

# If missing, add it
echo ".code-review-graph/" >> .gitignore

# Remove already-tracked entries
git rm --cached -r .code-review-graph/

# Commit
git add .gitignore
git commit -m "chore: exclude code-review-graph database"
```

---

### ❌ Onboarding: New developer setup fails

**Scenario:** Fresh clone, `npm run build:graph` doesn't work

**Fix - Complete Setup:**
```bash
# 1. Clone and install bibleLM
git clone https://github.com/...
cd bibleLM
npm install

# 2. Install code-review-graph
uv pip install code-review-graph

# 3. Verify installation
uv pip show code-review-graph

# 4. Build graph (one-time)
npm run build:graph

# 5. Verify success
uv run code-review-graph status

# 6. Done! Graph is ready for agents
```

**If `npm run build:graph` still fails:**
```bash
# Try running directly
uv run code-review-graph build

# If that works, the npm script binding is broken
# Check package.json: "build:graph": "uv run code-review-graph build"
```

---

## Recovery Procedures

### Full Reset

```bash
# Stop all background processes
pkill -f "code-review-graph"

# Remove database
rm -rf .code-review-graph/

# Rebuild from scratch
npm run build:graph

# Verify
uv run code-review-graph status
```

### Rollback to Last Known Good

```bash
# If graph corrupted after a commit
git checkout HEAD~1 -- .code-review-graph/

# Or rebuild (recommended)
npm run build:graph
```

### Clear All MCP Registrations (Nuclear Option)

If MCP servers are registered in multiple places and causing conflicts:

```bash
# Remove all derived MCP configs
rm -f .mcp.json .cursor/mcp.json CLAUDE.md AGENTS.md GEMINI.md

# Regenerate
npm run build:graph

# This re-runs the init which regenerates all configs
```

---

## Getting Help

### Check Status

```bash
uv run code-review-graph status
```

### Check Logs

- **Claude Code:** View → Output → "MCP"
- **Cursor:** Settings → Output → "Cursor"
- **Terminal:** Watch stdout when running watch mode

### Manual MCP Server Test

```bash
# Start MCP server in isolation
uvx code-review-graph serve

# In another terminal, test a query
# (requires MCP client; for manual verification only)
```

### Check Dependencies

```bash
uv pip list | grep -E "(code-review-graph|mcp|fastmcp|networkx)"
```

---

## Version Compatibility

| Tool | Version | Status |
|------|---------|--------|
| code-review-graph | 2.3.2 | ✅ Current |
| Python | 3.10+ | ✅ Required |
| uv | 0.4.0+ | ✅ Required |
| Node | 18+ | ✅ Required |
| npm | 9+ | ✅ Required |

**To upgrade code-review-graph:**
```bash
uv pip install --upgrade code-review-graph

# Rebuild graph with new version
npm run build:graph
```

---

## Performance Profiling

If graph operations are slow:

```bash
# Run benchmarks
uv run code-review-graph eval

# This tests:
# - Query latency (semantic_search_nodes, query_graph)
# - Database size efficiency
# - Index performance
```

---

## References

- `.agent/agent-setup/README.md` — Setup overview
- `.agent/agent-setup/code-review-graph.md` — Detailed documentation
- `CLAUDE.md` — Agent tool usage guidelines
- `CONTRIBUTING.md` — General development setup
- **Official:** https://github.com/tirth8205/code-review-graph
