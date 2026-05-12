# Cartographer

<img width="640" height="360" alt="claudecartographer" src="https://github.com/user-attachments/assets/542818c6-fc2b-41a6-915d-cf196447f346" />


A standalone Cartographer CLI plus Claude Code plugin for mapping and navigating codebases.

Cartographer v2 adds a graph CLI for intelligent coding agents: index a repo into a local SQLite graph, compile bounded briefs, run removal/completeness audits, manage evidence-backed notes, and score whether agents used graph context before editing.

## CLI

Install dependencies:

```bash
bun install
```

Run the CLI:

```bash
bun run cartographer -- --help
bun run cartographer:mcp
bun run cartographer:index -- --root . --out .cartographer
bun run cartographer:verify -- --out .cartographer --root . --fresh
bun run cartographer:view -- --out .cartographer
bun run cartographer:brief -- --out .cartographer --path src/index.ts --mode implementation --json
bun run cartographer:audit -- removal --out .cartographer --target supabase --write .cartographer/audits/supabase-removal.json
bun run cartographer:notes -- audit --out .cartographer --json
bun run cartographer:export -- graph --from .cartographer --format debug-json --out .cartographer/exports/graph.debug.json
```

Run the deterministic Cartographer eval smoke profile:

```bash
bun run eval:cartographer:smoke
bun run eval:cartographer:codex
bun run eval:cartographer:codex:live
```

The smoke, recorded Codex-trace, and explicit live Codex profiles index this repo and use `/Users/saint/dev/agent-runtime-kernel` as a read-only external target. They write graph artifacts under `/tmp/cartographer-code-graph-evals` and append-only JSON reports under `docs/reports`.

Core commands:

- `mcp` - run a thin newline-delimited MCP stdio wrapper over Cartographer graph operations.
- `index` - build `.cartographer/manifest.json`, `.cartographer/graph.sqlite`, JSON schemas, and `CODEBASE_MAP.md`.
- `verify` - check graph artifact compatibility and, with `--fresh`, fail when persisted artifacts drift from the live repo.
- `view` - summarize an existing graph.
- `brief` - emit bounded agent-facing context around a path, package, env var, DB/IaC object, audit ledger, or changed files.
- `audit removal` / `audit verify` - create and verify task-specific removal ledgers.
- `notes ingest` / `notes audit` / `notes accept` / `notes retire` - manage evidence-backed semantic notes.
- `export graph` - explicitly export full debug JSON or JSONL graph data.
- `diff` - compare two graph artifact directories.
- `slice`, `impact`, `context`, `preflight` - compatibility/debug graph surfaces. Broad selectors require `--allow-broad` or `--debug-graph`.
- `adoption` - score graph-first behavior from runtime traces.
- `annotate` / `annotations` - legacy OpenRouter annotation workflow, superseded for daily use by `notes`.

The MCP wrapper exposes `cartographer_index`, `cartographer_view`, `cartographer_brief`, `cartographer_context`, `cartographer_preflight`, `cartographer_verify`, `cartographer_audit_removal`, `cartographer_audit_verify`, `cartographer_notes_audit`, and `cartographer_diff` as tools. It wraps the same library functions as the CLI; it does not become a long-lived graph brain or agent manager.

## Installation

The section below documents the legacy Claude Code plugin workflow that produces `docs/CODEBASE_MAP.md` by orchestrating subagents. It is separate from the Cartographer v2 graph CLI above. For new agent/orchestrator workflows, prefer the v2 `brief`, `audit`, and `notes` commands.

**Step 1:** Add the marketplace to Claude Code:

```
/plugin marketplace add kingbootoshi/cartographer
```

**Step 2:** Install the plugin:

```
/plugin install cartographer
```

**Step 3:** Restart Claude Code (may be required for the skill to load)

**Step 4:** Use it:

```
/cartographer
```

Or just say "map this codebase" and it will trigger automatically.

## What it Does

Cartographer orchestrates multiple Sonnet subagents to analyze your entire codebase in parallel, then synthesizes their findings into:

- `docs/CODEBASE_MAP.md` - Detailed architecture map with file purposes, dependencies, data flows, and navigation guides
- Updates `CLAUDE.md` with a summary pointing to the map

## How it Works

1. Runs a scanner script to get file tree with token counts (respects .gitignore)
2. Plans how to split work across subagents based on token budgets
3. Spawns Sonnet subagents in parallel - each analyzes a portion of the codebase
4. Synthesizes all subagent reports into comprehensive documentation

## Update Mode

If `docs/CODEBASE_MAP.md` already exists, Cartographer will:

1. Check git history for changes since last mapping
2. Only re-analyze changed modules
3. Merge updates with existing documentation

Just run `/cartographer` again to update.

## Token Usage

⚠️ **NOTE:** This skill spawns Sonnet subagents for accurate, reliable analysis. Depending on codebase size, this can use significant tokens. Be mindful of your usage.

You can ask Claude to use Haiku subagents instead for a cheaper run, but accuracy may suffer on complex codebases.

## Requirements

- tiktoken (for token counting): `pip install tiktoken` or `uv pip install tiktoken`

## Full Documentation

See [plugins/cartographer/README.md](plugins/cartographer/README.md) for detailed documentation.

## License

MIT
