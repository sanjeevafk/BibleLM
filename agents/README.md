# Agent Instructions

Centralized instruction and skill files for all agents/tools in this repository.

## Structure

- `instructions/graph-rules.md` - Shared MCP graph workflow rules (canonical source).
- `instructions/project-context.md` - BibleLM project context for assistant tools.
- `skills/` - Reusable task playbooks (debug/review/refactor/explore).

## Compatibility

Legacy root files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`) now symlink to `instructions/graph-rules.md`.
`.agent.md` now symlinks to `instructions/project-context.md`.
`.claude/skills/*` now symlink to `agents/skills/*`.
