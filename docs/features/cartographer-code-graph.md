# Cartographer Code Graph CLI

Cartographer v2 is a deterministic repo evidence compiler for coding agents. It gives an intelligent orchestrator a bounded structural map, freshness evidence, validation surfaces, removal/completeness ledgers, and reviewable notes.

It is not an autonomous planner, task manager, semantic truth database, or grep replacement. Agents still inspect source directly. Cartographer makes the first navigation pass faster and makes large cleanup/migration work easier to audit.

## Primary Commands

```bash
bun run cartographer:index -- --root . --out .cartographer
bun run cartographer:verify -- --out .cartographer --root . --fresh --json
bun run cartographer:brief -- --out .cartographer --path src/index.ts --json
bun run cartographer:brief -- --out .cartographer --package apps/web --mode planning
bun run cartographer:brief -- --out .cartographer --audit .cartographer/audits/supabase-removal.json --mode prd
bun run cartographer:audit -- removal --out .cartographer --target supabase --write .cartographer/audits/supabase-removal.json
bun run cartographer:audit -- verify --out .cartographer --ledger .cartographer/audits/supabase-removal.json --fail-on-leftovers --json
bun run cartographer:notes -- ingest subagent-report.json --out .cartographer --author codex-worker
bun run cartographer:notes -- audit --out .cartographer --json
bun run cartographer:notes -- accept <note-id> --out .cartographer --reviewer saint
bun run cartographer:export -- graph --from .cartographer --format debug-json --out .cartographer/exports/graph.debug.json
```

Legacy/debug commands still exist:

```bash
bun run cartographer:slice -- --out .cartographer --selector path:src/index.ts
bun run cartographer:impact -- --out .cartographer --path src/index.ts --depth 1
bun run cartographer:context -- --out .cartographer --path src/index.ts --depth 1 --json
bun run cartographer:preflight -- --out .cartographer --path src/index.ts
bun run cartographer:adoption -- --trace trace.json --require-graph-first --json
bun run cartographer:annotations -- --out .cartographer --json
```

`slice`, `impact`, `context`, `preflight`, `adoption`, and `annotations` are compatibility, debug, or harness surfaces. New agent workflows should prefer `brief`, `audit`, and `notes`.

## Artifact Layout

`index` writes a durable local graph store:

```text
.cartographer/
  manifest.json
  graph.sqlite
  schema/
    brief.schema.json
    audit-ledger.schema.json
    notes.schema.json
  CODEBASE_MAP.md
```

`graph.json` is no longer a default artifact. Full graph JSON and JSONL are explicit debug exports:

```bash
bun run cartographer:export -- graph --from .cartographer --format debug-json --out .cartographer/exports/graph.debug.json
bun run cartographer:export -- graph --from .cartographer --format jsonl --out .cartographer/exports
```

## What The Graph Stores

Core deterministic facts include:

- files, directories, docs, generated artifacts, and dirty artifacts
- packages, workspaces, package scripts, and external dependencies
- imports, type imports, exports, and symbols
- env var names only, never values
- SQL migrations, tables, functions, policies, and triggers
- Terraform resources/modules and dependency edges
- GitHub Actions workflow/job/run-step config nodes
- test relationships and package validation commands
- evidence paths, line anchors, file hashes, freshness, and provenance classes

SQLite is the durable query substrate. Prompt context is compiled from it; agents do not receive the full graph unless a debug export is explicitly requested.

## Briefs

`brief` is the normal agent-facing interface.

It emits a bounded packet around a path, package, env var, DB object, IaC object, audit ledger, or changed files:

```bash
bun run cartographer:brief -- --out .cartographer --path src/kernel/turn-executor.ts --mode implementation --budget 8000 --json
```

The packet includes:

- snapshot root, commit, dirty state, freshness, and totals
- resolved anchor
- read-first paths
- impact paths
- package ownership
- external dependencies
- env, DB, IaC, CI, and docs surfaces
- focused tests
- safe validation commands
- accepted notes and stale-note warnings
- findings, omissions, and continuation commands

Briefs are path- and reason-centric, not edge dumps. The selected path is ranked first for path briefs. Normal `brief`, `context`, `preflight`, `slice`, and `impact` outputs are bounded; full nested graph payloads require `--debug-graph` or `export graph`.

Brief caps can be tuned without making the packet unbounded:

```bash
bun run cartographer:brief -- --out .cartographer --path src/index.ts --budget 8000 --max-paths 15 --max-tests 20 --max-validation 12 --json
```

Broad graph selectors are guarded. Use exact selectors such as `path:`, `package:`, `env:`, `dbtable:`, or `iacresource:` for normal workflows. Debug-wide selectors such as `all` require `--allow-broad` or `--debug-graph`.

Every brief is orientation only. Agents must verify implementation-sensitive claims with direct source reads before editing or making final claims.

## Removal Audits

`audit removal` creates a task-specific completion ledger. This is the main workflow for migrations and removals such as Supabase replacement:

```bash
bun run cartographer:audit -- removal \
  --out .cartographer \
  --target supabase \
  --write .cartographer/audits/supabase-removal.json \
  --format json
```

The ledger checks evidence classes such as:

- package dependencies and lockfiles
- SDK imports and client wrappers
- env var names and CI/deploy secret names
- SQL migrations, RLS policies, functions, triggers, storage, and edge functions
- generated DB types
- auth/user model surfaces
- tests, mocks, fixtures, active docs, historical docs, and unknown literal hits
- replacement auth/database requirements
- validation receipts

`audit verify` reruns checks against current source:

```bash
bun run cartographer:audit -- verify \
  --out .cartographer \
  --ledger .cartographer/audits/supabase-removal.json \
  --fail-on-leftovers \
  --json
```

Verification fails closed when active leftovers remain. Retained references need explicit evidence and a reason.

Audit ledgers can also feed PRD or subagent briefing packets:

```bash
bun run cartographer:brief -- --out .cartographer --audit .cartographer/audits/supabase-removal.json --mode prd --json
```

## Notes

Notes are reviewable semantic overlays, not graph facts. They are useful when an agent or human finds workflow meaning that static extraction cannot safely infer.

Subagent reports can be ingested:

```json
{
  "target": "supabase-removal",
  "claims": [
    {
      "kind": "test-guidance",
      "summary": "Use the colocated auth tests when changing this client.",
      "evidence": [{ "path": "apps/web/src/auth/client.ts" }]
    }
  ]
}
```

```bash
bun run cartographer:notes -- ingest subagent-report.json --out .cartographer --author codex-worker
bun run cartographer:notes -- audit --out .cartographer --json
bun run cartographer:notes -- accept <note-id> --out .cartographer --reviewer saint
bun run cartographer:notes -- retire <note-id> --out .cartographer --reviewer saint
```

Notes live at:

```text
.cartographer/notes.jsonl
```

Candidates do not enter normal briefs. Accepted notes appear in briefs only while grounded. If cited evidence changes, accepted notes are downgraded to stale warnings.

The legacy `annotations` command remains as a compatibility alias for the older overlay workflow.

## Monorepo Use

For large repos, use Cartographer as a map plus audit layer around normal grep/source reads:

1. Build or refresh `.cartographer`.
2. Run `brief` for the package, file, env var, DB object, IaC resource, or changed files.
3. Read the returned source files directly.
4. Use package ownership and validation commands to scope subagent prompts.
5. For removals/migrations, create an audit ledger before implementation.
6. Have subagents return evidence-backed notes or ledger updates.
7. Run `audit verify --fail-on-leftovers` before claiming cleanup is complete.

For ARK-style repos with infra, backend, frontend, runtime code, tests, and docs, Cartographer’s leverage is not “show every edge.” The leverage is:

- package/surface partitioning
- cross-surface evidence classes
- focused validation discovery
- stale graph and stale note detection
- explicit omissions under token budgets
- completion ledgers for hard migrations

## Agent Runtime Hooks

`preflight` still exists for harnesses that inject graph context before an agent turn. Runtime wrappers can emit adoption-compatible `tool_use` and `tool_result` events so:

```bash
bun run cartographer:adoption -- --trace runtime-events.json --require-graph-first --json
```

can measure whether graph context appeared before direct source reads. Adoption is a guardrail, not proof that the outcome is correct.

## Security

- Env var names are indexed. Secret values are not.
- `.env` handling is conservative.
- CI/deploy secrets are surfaced by name only.
- No cloud/runtime drift calls run by default.
- Notes and audit ledgers cite evidence paths and hashes instead of storing sensitive payloads.

## Verification

Current local checks:

```bash
bun run typecheck
bun test src/code-graph
bun run eval:cartographer:smoke
```

The smoke eval builds graph contracts for this repo and read-only ARK, then verifies ARK preflight navigation against `src/kernel/turn-executor.ts`.
