# Oracle Prompt - Cartographer v2 Graph Storage and Agent Context Optimization
Generated: 2026-05-12T20:25:02.548671+00:00
This is a single copy-paste packet for Oracle. It includes the strategic question, current measurements, constraints, and full relevant files separated by XML-style tags.
## Prompt To Oracle
Oracle, please review the Cartographer v2 code graph design and implementation context below. I need a senior architecture review focused specifically on optimizing graph storage, graph query outputs, and agent-facing context packets so the tool scales to large monorepos without blowing up agent context windows.

### Product Context

We are building Cartographer v2 as a standalone CLI/tooling layer for highly capable coding agents. The agent using the tool is the intelligence layer - usually a principal-engineer/orchestrator agent like Codex. That orchestrator researches first, discusses with the user, writes PRDs/plans, then delegates scoped implementation/research work to subagents. Subagents are also intelligent and already use grep, ripgrep, direct source reads, tests, and docs very well.

Cartographer is not meant to replace that. It should amplify it. The intended boundary is:

- Cartographer is a deterministic repo evidence compiler.
- Cartographer builds a graph/index of repo structure and relationships.
- Cartographer gives bounded, evidence-backed graph context to agents.
- Cartographer should help with monorepos containing frontend, backend services, shared packages, SQL/db migrations, IaC/Terraform, CI, docs, generated artifacts, and environment surfaces.
- Cartographer should help with hard workflows like clean service removal/migration, e.g. removing Supabase from a monorepo and replacing DB/auth surfaces with local Postgres + Clerk.
- Cartographer should not become an autonomous planner, task manager, memory brain, PRD writer, or grep replacement.
- Agents should use Cartographer for orientation, then verify with direct source reads before making implementation-sensitive claims.

The practical UX target is:

1. The full graph/index lives on disk.
2. The orchestrator asks for small slices, preflight briefs, impact views, freshness checks, and audit ledgers.
3. The agent context receives only bounded summaries, not the full graph.
4. Subagents receive scoped briefs created by the orchestrator using Cartographer evidence plus the orchestrator's own judgment.

### Current Measurement Problem

I ran the current prototype against `/Users/saint/Dev/agent-runtime-kernel` as a realistic ARK test repo. ARK was dirty at commit `9ff50df2c300` with 2 modified files and 1 untracked file. The graph was written to `/tmp/cartographer-ark-token-test-20260512a`.

Measured with OpenAI `tiktoken` using `o200k_base`:

```text
ARK graph totals:
- 671 files
- 4,664 nodes
- 10,802 edges
- 0 findings

Token counts:
- Raw tracked ARK repo text:        1,118,417 tokens
- Full graph.json pretty JSON:      2,357,195 tokens
- Full graph.json minified:         1,666,255 tokens
- Persisted graph+manifest+schema:  2,359,776 tokens
- CODEBASE_MAP.md summary:              2,056 tokens
- cartographer view:                      283 tokens
- verify --fresh --json:                  505 tokens
- context for src/kernel/turn-executor.ts depth 1:   4,162 tokens
- preflight for src/kernel/turn-executor.ts:          4,356 tokens
- impact for src/kernel/turn-executor.ts depth 1:    41,082 tokens
```

The graph is larger than the raw repo text because the current `graph.json` is a verbose, lossless JSON database dump. Every node and edge repeats IDs, labels, metadata, and provenance blocks. Edges dominate the token count.

A breakdown of the minified graph showed approximately:

```text
Top-level sections:
- nodes: ~509K tokens
- edges: ~1.16M tokens

Biggest node buckets:
- Symbol nodes: ~383K tokens
- File nodes: ~86K tokens

Biggest edge buckets:
- DEFINES: ~406K tokens
- IMPORTS: ~204K tokens
- EXPORTS: ~140K tokens
- TYPE_IMPORTS: ~122K tokens
- DOCUMENTS: ~97K tokens
- TESTS: ~90K tokens
```

A typical current edge looks like this:

```json
{
  "id": "edge:CONTAINS:repo:root:dir:.:contains",
  "kind": "CONTAINS",
  "from": "repo:root",
  "to": "dir:.",
  "label": "contains",
  "metadata": {},
  "provenance": {
    "source": "syntax",
    "evidence": [],
    "confidence": "deterministic",
    "freshness": "fresh",
    "scannerVersion": "0.1.0"
  }
}
```

That shape is easy to debug, but it is not efficient as a durable store or prompt artifact.

### Current Hypothesis

The graph concept is important, but the current verbose JSON representation should not be the normal agent-facing artifact. Cartographer should likely split into:

1. Efficient graph store/index on disk.
2. Query engine over that store.
3. Small prompt/brief outputs with hard budgets.
4. Optional verbose JSON export only for debugging/evals/interchange.

Potential optimizations we are considering:

- Store default provenance at graph/manifest level and only attach per-node/per-edge provenance when it differs.
- Normalize repeated strings and paths.
- Store edges as compact tuples internally.
- Use SQLite or another queryable local store instead of one giant JSON document.
- Keep JSONL or chunked artifacts for portability if SQLite is too heavy.
- Add hard output budgets: max tokens, max paths, max nodes, max edges.
- Make `brief/preflight/context` the primary agent interface and never expose full `graph.json` by default.
- Add omission counts and confidence/freshness indicators so bounded output is honest.
- Add task-specific audit ledgers for migrations/removals instead of dumping broader graph context.

### What I Need From You

Please give a rigorous architecture review and concrete recommendation. Focus on simplification and long-term scale. Assume agents are very good at grep/search/source reads and can chain tools well. Cartographer should provide structural leverage, not duplicate agent intelligence.

Please answer these questions:

1. What parts of the current graph model are genuinely necessary for Cartographer's purpose, and what parts are over-modeled?
2. Should durable storage be verbose JSON, minified JSON, JSONL chunks, SQLite, DuckDB, LMDB, a custom binary format, or something else? Recommend the simplest practical v2 design.
3. How should provenance/evidence be modeled so it remains trustworthy without multiplying token/storage size?
4. How should the CLI prevent agents from accidentally requesting huge outputs? What defaults, hard limits, warnings, and output budgets should exist?
5. What should the agent-facing packet schema look like for `brief/preflight/context`? What exact sections should be included?
6. How should monorepo scale change the model? Consider frontend/backend/services/shared packages/DB/IaC/CI/docs/generated files.
7. For workflows like Supabase removal, should the tool use generic graph queries, dedicated audit ledgers, or both? What shape should that have?
8. What optimization path should we take from the current implementation without over-engineering? Please provide a phased plan.
9. What evals should prove the optimization is working? Include token efficiency, recall, precision, completeness, drift/freshness, and agent outcome metrics.
10. What are the failure modes where Cartographer could hurt agents instead of help them, and how should the product guard against those?

Please be opinionated. If you think a proposed feature should be deleted or postponed, say so. If you think the current schema should be normalized, compressed, split, or replaced, give the exact shape you would use.

## Files Included

Token check for these files: 53,751 tokens, leaving about 167K tokens spare inside the Oracle 256K budget after reserving 35K for prompt/response.

<files>

<file path="/Users/saint/Dev/cartographer-plugin/docs/prds/cartographer-v2-master-prd.md" language="md">
<![CDATA[
# Cartographer v2 Master PRD

Status: master PRD
Owner: Cartographer
Date: 2026-05-12
Supersedes: `docs/prds/cartographer-v2-code-graph.md` as the product source of truth

## Summary

Cartographer v2 is a deterministic repo evidence compiler for highly capable coding agents.

It is not an agent manager, planner, PRD writer, semantic memory brain, or grep replacement. The orchestrator agent remains the intelligence layer. Cartographer gives that orchestrator and its subagents bounded structural context, evidence-backed ledgers, graph freshness, drift checks, and completion audits that make large codebase work cleaner and easier to verify.

The v2 product spine is:

```bash
cartographer index
cartographer brief
cartographer audit
cartographer notes
```

Everything else is internal, advanced, debug, legacy, or future integration.

## Problem

Modern coding agents are strong at grep, source reads, tool chaining, and local reasoning. They can often navigate well without a graph. The remaining failure mode is not "agents cannot search." The failure mode is that large monorepo work requires many evidence classes to be checked, remembered, and rechecked across code, packages, tests, docs, migrations, IaC, env vars, generated artifacts, and deployment config.

Examples:

- A Supabase removal is not complete just because `rg supabase` has fewer hits.
- A risky auth change is not scoped just because the first relevant file was found.
- A stale module note is dangerous if its source evidence changed.
- A subagent prompt is weaker when it lacks package ownership, tests, validation commands, and known omissions.
- A principal engineer cannot safely call a migration clean without a ledger of checked surfaces and retained exceptions.

Cartographer v2 solves the evidence organization problem around intelligent agents. It helps the orchestrator know what to inspect, what was checked, what remains unknown, and what must be verified before declaring work complete.

## Product Boundary

### Cartographer Should Do

- Build and refresh deterministic repo graph artifacts.
- Produce bounded briefs around paths, packages, symbols, env vars, DB resources, IaC resources, audits, or changed files.
- Rank likely relevant files, packages, tests, validation commands, and impact paths.
- Track graph freshness, git commit, dirty state, evidence hashes, and omitted context.
- Create and verify task-specific audit ledgers, starting with service/dependency removals.
- Store evidence-backed notes from humans or agents as reviewable claims, not canonical facts.
- Detect stale notes when cited evidence changes.
- Emit prompt-sized context packets for orchestrator and subagent use.
- Provide machine-readable JSON and human-readable Markdown.
- Work without any model call.

### Cartographer Should Not Do

- Manage subagents.
- Decide task plans.
- Write PRDs.
- Own approvals.
- Replace grep or source reads.
- Become a generic vector memory system.
- Treat agent observations as truth without evidence.
- Use cloud credentials or runtime provider APIs by default.
- Claim deep call/reference precision unless backed by a real provider.
- Hide uncertainty, omissions, stale state, or low-confidence extraction.

## Users

### Principal Engineer Orchestrator

The orchestrator is the main intelligent layer. It discusses with Saint, researches first, writes PRDs, decides implementation strategy, prompts subagents, reviews findings, and owns judgment.

Cartographer helps the orchestrator by providing:

- repo atlas context
- focused briefs
- evidence classes to check
- risk and blast-radius surfaces
- validation command candidates
- subagent prompt context
- completion ledgers
- stale note warnings

### Subagents

Subagents are capable workers or scouts. They grep, inspect source, implement, and verify scoped work.

Cartographer helps subagents by providing:

- bounded context for their area
- likely files to open first
- tests and validation commands
- known warnings and stale notes
- structured evidence report expectations

### Humans

Humans use Cartographer output to inspect codebase shape, approve PRDs, review cleanup completeness, and audit retained references.

## Operating Model

Cartographer v2 assumes the intelligence layer is outside the tool.

The normal workflow is:

1. A principal-engineer orchestrator discusses the problem with Saint.
2. The orchestrator uses Cartographer during research to understand repo structure, evidence classes, impact surfaces, stale notes, and validation paths.
3. The orchestrator decides whether to keep researching, write a PRD, split work across subagents, or implement directly.
4. Subagents receive bounded Cartographer briefs as extra context alongside normal grep, source reads, docs, tests, and direct reasoning.
5. Subagents return evidence-backed reports.
6. Cartographer records or verifies those reports only as notes, ledgers, and receipts.
7. The orchestrator remains responsible for judgment, review, plan changes, and final claims.

Cartographer should not require a natural-language task to be useful. The orchestrator may ask for a brief around a path, package, env var, DB object, audit ledger, changed files, or repo area before it has decided on a plan. That makes Cartographer useful during research and discussion, not only after a task is already scoped.

### Initialization And Refresh

Cartographer has two setup modes:

- Initial repo setup: build the deterministic graph, produce a first repo overview, identify major packages and evidence classes, and optionally ingest reviewed notes from human or agent research.
- Refresh after changes: rebuild graph artifacts, diff against the prior graph, mark stale notes, verify affected ledgers, and expose drift before new work begins.

Initialization may be helped by a separate skill or external agent workflow, but that workflow sits above Cartographer. The v2 CLI remains deterministic and does not manage subagents itself.

### Prompting Subagents

When the orchestrator delegates work, Cartographer should help compile compact, evidence-backed context packets.

A good subagent packet contains:

- the relevant anchor and graph freshness
- primary files to inspect
- related packages and dependencies
- likely tests and validation commands
- audit classes in scope
- known omissions and stale notes
- explicit reporting expectations

The packet should never tell the subagent that source inspection is optional. It should orient the subagent before grep and file reads.

## Core Concepts

### Deterministic Graph Facts

Facts extracted from source evidence:

- repo snapshot
- directories, files, docs, generated artifacts, dirty artifacts
- workspaces and packages
- package scripts
- external dependencies
- imports, type imports, exports, symbols
- tests and conservative test-target edges
- env var names, never values
- SQL migrations, tables, functions, policies, triggers
- IaC modules and resources
- CI/deploy references where deterministic

Every fact must carry provenance: source path, optional line range, extractor, confidence, freshness, and graph snapshot.

### Brief

A brief is the primary agent-facing context compiler.

It answers:

- What should the agent read first?
- What package or subsystem owns this anchor?
- What depends on or is affected by this anchor?
- What tests and validation commands are likely relevant?
- What notes are accepted or stale?
- What findings or omissions should the agent know?
- How fresh is this graph?

Briefs are not plans. The orchestrator decides the plan.

### Audit Ledger

An audit ledger is a task-specific completeness record. The first major ledger type is `removal`.

It tracks:

- target
- evidence classes
- findings
- statuses
- retained exceptions
- validation receipts
- graph snapshot
- live verification results

This is the main feature that clearly beats grep.

### Notes

Notes are evidence-backed semantic claims written by humans or agents.

Notes may explain:

- module purpose
- false friends
- generated-file ownership
- runtime coupling
- migration gotchas
- validation advice
- edit warnings

Notes are never deterministic graph facts. They must be anchored to evidence and may be `candidate`, `accepted`, `stale`, or `retired`.

## Command Surface

### `cartographer index`

Build or refresh deterministic graph artifacts.

Example:

```bash
cartographer index --root . --out .cartographer
```

Requirements:

- Must not mutate the target repo except the chosen output directory.
- Must record root, git commit, dirty state, generated time, scanner version, file count, node count, edge count, and findings.
- Must ignore default generated/vendor paths.
- Must store env var names only.
- Must be safe to run repeatedly after branch changes.

Alias:

```bash
cartographer update
```

`update` is only an alias for `index`; it is not a separate product concept.

### `cartographer brief`

Compile bounded context around an anchor.

Examples:

```bash
cartographer brief --path src/auth/client.ts --format prompt --budget 12000
cartographer brief --package apps/web --format json
cartographer brief --env SUPABASE_URL --mode planning
cartographer brief --audit supabase-removal --mode prd
cartographer brief --changed --mode review
```

Supported anchors for v2:

- `--path <path>`
- `--package <package-id>`
- `--symbol <symbol-id>`
- `--env <ENV_NAME>`
- `--db <db-node-id>`
- `--iac <iac-node-id>`
- `--audit <ledger-id-or-path>`
- `--changed`

Supported modes:

- `planning`
- `implementation`
- `review`
- `prd`

Modes are render profiles over the same underlying context object. They must not become separate commands like `dossier`, `scout-kit`, `prompt-pack`, or `prd-context`.

Brief output must include:

- graph snapshot and freshness
- selected anchor
- primary paths
- impact paths
- test paths
- affected packages
- validation commands
- accepted notes
- stale notes
- findings
- omitted context counts
- confidence and provenance metadata

### `cartographer audit removal`

Create a removal/completeness ledger for a dependency, service, platform, env prefix, package, DB resource, or provider.

Example:

```bash
cartographer audit removal --target supabase \
  --write .cartographer/audits/supabase-removal.json \
  --format markdown
```

The command should produce:

- direct references
- dependency and package references
- lockfile references
- generated artifact references
- env var references
- SQL, migration, function, policy, trigger, and storage references
- edge function references
- CI, deploy, and secret-name references
- docs, tests, mocks, and fixtures
- unknown or unclassified hits
- intentional-retention placeholders
- suggested validation commands
- explicit omissions and confidence notes

### `cartographer audit verify`

Re-run checks against a ledger after implementation.

Example:

```bash
cartographer audit verify \
  --ledger .cartographer/audits/supabase-removal.json \
  --live \
  --fail-on-leftovers
```

Requirements:

- Must default to live graph/search checks for final verification.
- Must fail when active leftovers exist and `--fail-on-leftovers` is set.
- Must distinguish removed, replaced, retained, unknown, and needs-review states.
- Must never claim completion without listing evidence classes checked.
- Must record validation receipts when supplied.

### `cartographer notes ingest`

Ingest structured evidence-backed notes from agents or humans.

Example:

```bash
cartographer notes ingest subagent-report.json
```

Ingested notes default to `candidate`.

Required note shape:

```json
{
  "target": "supabase-removal",
  "claims": [
    {
      "kind": "removed-reference",
      "summary": "Removed Supabase client wrapper from web auth.",
      "evidence": [
        { "path": "apps/web/package.json" },
        { "path": "apps/web/src/auth/client.ts" }
      ]
    }
  ]
}
```

### `cartographer notes audit`

Check notes for evidence quality and staleness.

Example:

```bash
cartographer notes audit
```

Checks:

- valid JSON
- stable IDs
- duplicate IDs
- known target nodes or ledger IDs
- evidence paths exist
- evidence hashes still match
- accepted notes still grounded
- candidate notes are review-ready or blocked

### `cartographer notes accept`

Promote an audit-clean candidate note.

Example:

```bash
cartographer notes accept <note-id> --reviewer saint
```

### `cartographer notes retire`

Retire a stale, unsafe, obsolete, or unhelpful note.

Example:

```bash
cartographer notes retire <note-id> --reviewer saint
```

## Advanced And Legacy Commands

These may remain available for debugging, evals, or compatibility, but they are not the main v2 product story:

- `slice`
- `impact`
- `context`
- `preflight`
- `adoption`
- `annotate`
- `annotations`

Recommended mapping:

| Existing command | v2 treatment |
| --- | --- |
| `slice` | advanced/debug graph primitive |
| `impact` | advanced/debug graph primitive |
| `context` | implementation behind `brief` |
| `preflight` | alias or machine-mode variant of `brief` |
| `adoption` | eval/harness tool, not daily user command |
| `annotate` | experimental only |
| `annotations` | migrate to `notes` |

Do not ship these as separate core concepts:

- `dossier`
- `scout-kit`
- `prompt-pack`
- `prd-context`

Those are `brief --mode ...` renderings.

## Supabase Removal Anchor Workflow

The Supabase removal use case is the primary v2 wedge because it requires completeness across many surfaces.

### Step 1: Index

```bash
cartographer index --root . --out .cartographer
```

### Step 2: Create Removal Ledger

```bash
cartographer audit removal --target supabase \
  --write .cartographer/audits/supabase-removal.json \
  --format markdown
```

### Step 3: PRD Context

```bash
cartographer brief --audit .cartographer/audits/supabase-removal.json --mode prd
```

The orchestrator writes the PRD. Cartographer only supplies evidence.

### Step 4: Scoped Subagent Context

```bash
cartographer brief --package apps/web --audit supabase-removal --mode implementation
cartographer brief --env SUPABASE_URL --audit supabase-removal --mode implementation
cartographer brief --db public.users --audit supabase-removal --mode implementation
```

### Step 5: Ingest Findings

```bash
cartographer notes ingest subagent-report.json
cartographer notes audit
```

### Step 6: Verify Completion

```bash
cartographer audit verify \
  --ledger .cartographer/audits/supabase-removal.json \
  --live \
  --fail-on-leftovers
```

### Supabase Evidence Classes

The removal ledger must track:

| Evidence class | Completion standard |
| --- | --- |
| Package dependencies | No active `@supabase/*`, `supabase`, or Supabase CLI packages in manifests or lockfiles unless retained with reason. |
| Imports and SDK clients | No active imports, client factories, wrappers, mocks, or generated client helpers. |
| Env vars | No active `SUPABASE_*` runtime env names in app, CI, deploy config, or active docs unless retained with reason. |
| SQL migrations | Supabase-specific migrations, functions, triggers, grants, and policies reviewed and migrated or retained. |
| RLS policies | RLS policy objects accounted for; no orphaned Supabase auth assumptions. |
| Edge functions | Function directories, deploy config, callers, tests, and docs removed or retained with reason. |
| Storage buckets | Bucket policy, upload, signed URL, mocks, and docs accounted for. |
| Generated DB types | Supabase-generated types removed or replaced with local Postgres generation. |
| Auth/user model | Replacement auth and user model surfaces connected and tested. |
| CI/deploy secrets | Secret names checked; no raw secret values stored. |
| Tests/mocks/fixtures | Supabase-specific tests and mocks removed or rewritten. |
| Docs | Active docs updated; historical retained references explicitly listed. |
| Validation | Typecheck, tests, migration checks, generated-type checks, and relevant integration checks recorded. |

### Ledger Statuses

Supported statuses:

- `not-found`
- `found`
- `removed`
- `replaced`
- `intentional-retention`
- `needs-human-review`
- `unknown`
- `passed`
- `failed`

Avoid binary pass/fail until final verification.

### Clean Removal Definition

A clean Supabase removal means:

- No active Supabase dependency edges.
- No active Supabase imports, SDK client factories, or wrappers.
- No active Supabase env vars or CI/deploy secret names.
- No unaccounted Supabase migrations, policies, functions, triggers, storage buckets, or edge functions.
- No active generated Supabase types.
- No active docs, tests, mocks, or fixtures that assume Supabase.
- Replacement DB/auth surfaces are validated.
- Intentional retained references are documented with evidence and reason.
- Verification commands are recorded.

## Data Model

### Core Node Kinds

- `RepoSnapshot`
- `Directory`
- `File`
- `Doc`
- `GeneratedArtifact`
- `DirtyArtifact`
- `Workspace`
- `Package`
- `PackageScript`
- `ExternalDependency`
- `Symbol`
- `EnvVar`
- `Migration`
- `DbTable`
- `DbFunction`
- `DbPolicy`
- `DbTrigger`
- `IaCModule`
- `IaCResource`

### Postpone Or Move Out Of Core

| Kind | Treatment |
| --- | --- |
| `AgentAnnotation` | overlay record, not graph node |
| `Finding` | finding record, not graph node |
| `BoundaryPolicy` | postpone until deterministic extractor exists |
| `Route` | postpone unless extractor is reliable |
| `Entrypoint` | metadata until stronger extraction exists |
| `Config` | only if deterministic and well-scoped |

### Core Edge Kinds

Keep edge kinds conservative:

- `CONTAINS`
- `DEFINES`
- `EXPORTS`
- `IMPORTS`
- `TYPE_IMPORTS`
- `TESTS`
- `DEPENDS_ON`
- `USES_ENV`
- `MIGRATION_CREATES`
- `MIGRATION_ALTERS`
- `MIGRATION_DROPS`
- `TABLE_REFERENCES_TABLE`
- `RESOURCE_DEPENDS_ON`
- `AFFECTS`

Avoid edge kinds like `CALLS`, `REFERENCES`, `GUARDED_BY`, `OWNED_BY`, and `TASK_DEPENDS_ON` unless backed by a precise provider or explicit evidence.

### Ledger Record

```json
{
  "id": "supabase-removal",
  "kind": "removal",
  "target": "supabase",
  "createdAt": "2026-05-12T00:00:00.000Z",
  "updatedAt": "2026-05-12T00:00:00.000Z",
  "graphSnapshot": {
    "root": ".",
    "commit": "abc123",
    "dirty": true,
    "hash": "..."
  },
  "classes": [
    {
      "class": "package-dependency",
      "status": "found",
      "evidence": [],
      "exceptions": []
    }
  ],
  "validation": []
}
```

### Note Record

```json
{
  "id": "note_...",
  "target": "path:src/auth/client.ts",
  "kind": "edit-warning",
  "summary": "This client wrapper is generated from provider config.",
  "status": "candidate",
  "evidence": [
    {
      "path": "src/auth/client.ts",
      "lineStart": 1,
      "lineEnd": 40,
      "hash": "..."
    }
  ],
  "author": "codex-agent",
  "createdAt": "2026-05-12T00:00:00.000Z"
}
```

## Artifacts

Default output directory:

```text
.cartographer
```

Required artifacts:

```text
.cartographer/manifest.json
.cartographer/graph.json
.cartographer/schema.json
.cartographer/briefs/
.cartographer/audits/
.cartographer/notes.jsonl
.cartographer/reports/
```

Optional human map:

```text
docs/codegraph/CODEBASE_MAP.md
```

The committed human map is optional. The deterministic graph and ledgers are the core product.

## Requirements

### Functional Requirements

- `index` builds a valid graph for this repo and selected external repos by path.
- `brief` can compile context around path, package, env var, DB node, IaC node, audit, and changed-file anchors.
- `brief` respects a prompt budget and records omissions.
- `audit removal` creates a ledger with evidence classes and findings.
- `audit verify` rechecks a ledger in live mode and can fail closed.
- `notes ingest` accepts structured reports and stores candidate notes only.
- `notes audit` reports stale, unsupported, duplicate, and invalid notes.
- Accepted notes appear in briefs only when still grounded.
- Stale notes appear as warnings, not trusted context.
- JSON output is stable enough for eval runners.
- Markdown output is readable enough for humans and orchestrators.

### Non-Functional Requirements

- The graph must work with zero LLM calls.
- The CLI must be fast enough to run before normal coding turns.
- The CLI must be safe on dirty worktrees.
- The tool must not leak secret values.
- Graph extraction must prefer omission or low confidence over false precision.
- Large generated/vendor output must be ignored by default.
- Every user-facing completion claim must show evidence classes checked.

## Evals

### Suite 1: Graph Contract

Purpose: prove graph artifacts are structurally safe.

Targets:

- schema validation: 100%
- duplicate node IDs: 0
- duplicate edge IDs: 0
- dangling edges: 0
- ignored-path contamination: 0
- raw secret values: 0
- non-root nodes without evidence: 0

### Suite 2: Brief Context Precision

Purpose: prove `brief` gives compact, useful context.

Metrics:

- top-10 gold-file recall
- top-20 gold-file recall
- slice precision
- omitted relevant files
- irrelevant files included
- prompt size
- hallucinated paths
- validation command recall

Targets:

- hallucinated paths: 0
- top-10 gold-file recall: at least 90%
- top-20 gold-file recall: at least 95%
- context stays under configured budget
- broad repo dumps fail the eval

### Suite 3: Removal Audit Fixture

Purpose: prove Cartographer beats grep for completeness.

Fixture should include Supabase-style references across:

- dependencies
- lockfiles
- imports
- env vars
- SQL migrations
- RLS policies
- functions and triggers
- storage
- edge functions
- generated types
- CI/deploy config
- docs
- tests
- mocks
- intentional retained historical references

Metrics:

- evidence-class recall
- path recall
- false-positive rate
- unknown/unclassified count
- intentional-retention handling
- leftover detection after partial removal
- ledger completeness

Targets:

- evidence-class recall: at least 95%
- seeded leftover detection: 100%
- no raw secrets in reports
- retained references require evidence and reason

### Suite 4: Agent Baseline Comparison

Purpose: prove intelligent agents perform better with Cartographer than grep alone.

Profiles:

- `baseline-direct`: normal agent tools, no Cartographer instruction
- `graph-prompted`: agent is told to run Cartographer
- `graph-mandated`: harness injects or requires brief before source reads

Metrics:

- gold-file recall
- gold evidence-class recall
- first correct file
- irrelevant file reads
- tool-call count
- context size
- missed validation commands
- hallucinated paths
- leftover references after implementation
- final explanation accuracy

Graph adoption is a guardrail, not the final success metric.

### Suite 5: Drift And Staleness

Purpose: prove notes and ledgers do not rot silently.

Checks:

- accepted notes become stale when evidence hashes change
- stale notes appear as warnings in `brief`
- audit verification does not trust stale notes
- ledger verification reports changed evidence
- branch changes force freshness warnings when graph is stale

### Suite 6: Security And Privacy

Purpose: ensure safe indexing and reporting.

Checks:

- env var names allowed
- secret values redacted
- `.env` files handled conservatively
- CI/deploy secret names only
- no credentialed cloud/runtime drift checks by default
- destructive commands excluded from validation suggestions

## Implementation Plan

### Phase 0: Product Surface Reset

- [ ] Mark this PRD as the v2 source of truth.
- [ ] Update feature docs to describe `index`, `brief`, `audit`, and `notes`.
- [ ] Demote `slice`, `impact`, `context`, `preflight`, `adoption`, `annotate`, and `annotations` in docs.
- [ ] Rename overlay language from annotations to notes in product docs.
- [ ] Keep existing commands as compatibility shims while new surface lands.

### Phase 1: Graph Plus Brief MVP

- [ ] Stabilize graph schema around conservative node and edge kinds.
- [ ] Add `brief` command as the primary context compiler.
- [ ] Support anchors for path, package, env var, DB node, IaC node, audit, and changed files.
- [ ] Add `--mode planning|implementation|review|prd`.
- [ ] Add `--budget` and omission metadata.
- [ ] Include graph freshness, git commit, dirty state, and live/persisted mode in every brief.
- [ ] Render compact JSON and prompt Markdown.
- [ ] Preserve `preflight` as an alias or machine-mode rendering of `brief`.

Acceptance criteria:

- `bun run typecheck` passes.
- Existing graph tests pass.
- New brief tests cover every anchor kind supported in Phase 1.
- Brief fixture top-10 gold-file recall is at least 90%.
- Brief output includes zero hallucinated paths.

### Phase 2: Removal Audit Plus Ledger

- [ ] Add `audit removal --target <thing>`.
- [ ] Add removal ledger schema.
- [ ] Add evidence classes for dependencies, imports, env vars, SQL, RLS, functions, triggers, storage, edge functions, generated types, CI/deploy, docs, tests, mocks, and unknown hits.
- [ ] Add intentional-retention records.
- [ ] Add `audit verify --ledger <file> --live`.
- [ ] Add `--fail-on-leftovers`.
- [ ] Add Supabase removal fixture.
- [ ] Add Markdown and JSON reports.

Acceptance criteria:

- Supabase fixture evidence-class recall is at least 95%.
- Seeded leftovers are detected.
- Unknown/unclassified hits are reported.
- Reports contain no secret values.
- Final verification cannot pass with active unaccounted leftovers.

### Phase 3: Notes

- [ ] Add `notes ingest`.
- [ ] Add `notes audit`.
- [ ] Add `notes accept`.
- [ ] Add `notes retire`.
- [ ] Store evidence hashes for note evidence.
- [ ] Mark accepted notes stale when evidence changes.
- [ ] Inject accepted notes into `brief`.
- [ ] Inject stale notes as warnings only.
- [ ] Migrate or alias existing `annotations` behavior to `notes`.

Acceptance criteria:

- Candidate notes with missing evidence are rejected or blocked from acceptance.
- Accepted notes become stale after source evidence changes.
- Stale notes cannot silently appear as trusted facts.
- Notes improve brief usefulness without increasing hallucinated claims in agent trace evals.

### Phase 4: Agent Harness And Outcome Evals

- [ ] Update eval runner around `brief`, `audit removal`, and `notes`.
- [ ] Add baseline-direct, graph-prompted, and graph-mandated profiles.
- [ ] Score outcomes, not just adoption.
- [ ] Track irrelevant reads, gold-file recall, validation command execution, leftover references, and final explanation accuracy.
- [ ] Keep live Codex profiles opt-in.

Acceptance criteria:

- Cartographer-assisted profiles outperform baseline on evidence-class recall.
- Cartographer-assisted profiles do not increase hallucinated paths.
- Cartographer-assisted profiles reduce missed validation commands.
- Reports label all live/non-comparable conditions.

## Open Questions

- Should `.cartographer` be committed, ignored, or project-configurable by default?
- Should `docs/codegraph/CODEBASE_MAP.md` remain generated by default or become opt-in?
- What is the minimum useful SQL/RLS/storage extractor for Supabase-style apps?
- Should `brief --changed` compare against merge base, last graph snapshot, or both?
- How should validation receipts be attached to ledgers without becoming a task runner?
- What is the review policy for accepting notes: human only, orchestrator only, or configurable?

## Non-Goals For v2

- Autonomous Cartographer agent layer.
- Task queues.
- Subagent spawning.
- PRD generation.
- Cloud runtime drift platform.
- Vector memory.
- MCP server as a required runtime.
- LLM-generated annotations as the default workflow.
- Deep call graph precision without compiler/LSP/SCIP provider receipts.

## Launch Criteria

Cartographer v2 is ready for dogfood when:

- `index`, `brief`, `audit removal`, `audit verify`, and `notes audit` work in this repo.
- The same commands run read-only against ARK and Axia-style monorepo targets.
- Supabase removal fixture eval passes.
- Brief context precision eval passes.
- Drift/staleness eval passes.
- Security/privacy eval passes.
- Existing smoke and Codex trace evals still pass or are intentionally migrated.
- Product docs describe the simplified surface without presenting Cartographer as an orchestrator.

## Final Product Statement

Before an agent changes a large repo, Cartographer gives it bounded structural context and the validation surface. For removals and migrations, Cartographer gives the orchestrator a completion ledger so important evidence classes are not missed.

Cartographer is the deterministic map, audit ledger, and evidence compiler. The orchestrator agent is the intelligence layer. Subagents are scouts and workers that consume briefs and return evidence.
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/docs/features/cartographer-code-graph.md" language="md">
<![CDATA[
# Cartographer Code Graph CLI

The Cartographer code graph CLI gives agents a deterministic repo map plus a provider-backed semantic overlay for Codex-style annotation workflows. OpenRouter is the current annotation backend, not the architecture boundary.

The important split is:

- deterministic graph facts: files, imports, symbols, packages, scripts, SQL/IaC resources, Terraform resource/module dependencies, GitHub Actions workflow tasks, env vars, and git freshness
- agent overlay notes: purpose, edit warnings, generated ownership, workflow guidance, validation advice, and risk notes

Tree-sitter-style parsing belongs in the first bucket. Codex/OpenRouter annotations belong in the second bucket and must stay evidence-linked, reviewable, and stale-markable. The graph must be useful without annotations; overlay notes add workflow meaning, edit warnings, ownership guidance, and validation recipes after the structural graph has already found the relevant code and IaC surfaces.

## Commands

```bash
bun run cartographer:mcp
bun run cartographer:index -- --root . --out docs/codegraph
bun run cartographer:update -- --root . --out docs/codegraph
bun run cartographer:verify -- --out docs/codegraph --root . --fresh
bun run cartographer:view -- --out docs/codegraph
bun run cartographer:diff -- --base /tmp/codegraph-before --head docs/codegraph
bun run cartographer:slice -- --out docs/codegraph --selector path:src/index.ts
bun run cartographer:slice -- --out docs/codegraph --selector path:src/index.ts --json
bun run cartographer:impact -- --out docs/codegraph --path src/index.ts
bun run cartographer:impact -- --out docs/codegraph --path dbtable:public.accounts --depth 1 --json
bun run cartographer:preflight -- --out docs/codegraph --path src/index.ts
bun run cartographer:context -- --out docs/codegraph --path src/index.ts --depth 1 --json
bun run cartographer:context -- --out docs/codegraph --path src/index.ts --depth 1 --compact --json
bun run cartographer:adoption -- --trace trace.json --json
bun run cartographer:adoption -- --trace trace.json --require-graph-first
bun run cartographer:adoption -- --trace trace.json --expect-path src/index.ts --expect-command "bun test" --expect-executed-command "bun test"
bun run cartographer:annotate -- --out docs/codegraph --selector path:src/index.ts
bun run cartographer:annotations -- --out docs/codegraph --json
bun run cartographer:annotations -- --out docs/codegraph --accept <annotation-id> --reviewer <name>
bun run cartographer:annotations -- --out docs/codegraph --retire <annotation-id> --reviewer <name>
```

The direct binary form is:

```bash
bun run src/cli/index.ts cartographer index --root . --out docs/codegraph
```

`verify` is the deterministic artifact compatibility gate. It checks that required artifacts exist, `graph.json` validates against the current schema, `manifest.json` matches the graph manifest, manifest totals match the graph payload, node and edge IDs are unique, and every edge endpoint points at an existing node. Add `--fresh --root <repo>` in CI or scheduled jobs to rebuild the graph in memory and fail when persisted artifacts drift from the live repository.

`diff` compares two graph artifact directories and reports added, removed, and changed nodes, edges, findings, and annotations. Use it for branch-update reviews, scheduled graph freshness jobs, and CI receipts that need to prove what changed between snapshots.

`mcp` runs a thin newline-delimited stdio JSON-RPC wrapper for MCP clients. The wrapper exposes `cartographer_index`, `cartographer_view`, `cartographer_context`, `cartographer_preflight`, `cartographer_verify`, and `cartographer_diff` tools. It calls the same graph library as the CLI and does not move planning, agent management, or graph truth into an MCP server.

Codex and Claude-style runtimes can use the exported `buildCartographerPreflightAdapterPayload` helper when they want preflight to run before an agent turn without asking the model to call the CLI manually. The helper returns the prompt text plus adoption-compatible `tool_use` and `tool_result` runtime events for `cartographer adoption`.

## Outputs

`index` and `update` write:

```text
docs/codegraph/schema.json
docs/codegraph/manifest.json
docs/codegraph/graph.json
docs/codegraph/CODEBASE_MAP.md
```

The existing top-level `docs/CODEBASE_MAP.md` is not rewritten unless a caller explicitly passes `--map docs/CODEBASE_MAP.md`.

## Agent Flow

1. Run `cartographer preflight --path <file-or-node-id>` as the default pre-edit command. It is the agent-facing alias for `cartographer context --path <target> --depth 1 --compact --json`, returning the graph manifest, preflight summary, package ranking, validation commands, and slice/impact totals without shipping full nested graph payloads.
2. Run `cartographer view` when you need graph freshness and totals without task context.
3. Run `cartographer slice --selector path:<file>` when you only need local neighbors.
4. Run `cartographer impact --path <file-or-node-id>` when you only need blast radius. Use `--depth 1` first for broad graph nodes such as database tables, then expand deliberately.
5. Run relevant tests from the package script and graph context.
6. For raw agent traces, run `cartographer adoption --trace <runtime-events.json> --json` to summarize whether the agent used graph context before direct source reads. Add `--require-graph-first` when the workflow should fail on no graph command, graph preflight failure, or repo source reads before graph context. Add repeatable `--expect-text`, `--expect-path`, or `--expect-command` flags for manual final-response checks, and `--expect-executed-command` when the trace must show that a tool command actually ran validation.
7. Use `cartographer annotate` only to create candidate semantic overlay notes.
8. Run `cartographer annotations --json` before trusting overlay notes. It audits `docs/codegraph/overlays/agent-notes.jsonl` against the current graph, reports parse/schema issues, duplicate annotation IDs, missing target nodes, evidence that does not anchor to the target node, missing evidence paths, and evidence hash drift, and separates review-ready candidates from accepted notes that are still usable.

Preflight/context output is the first source of truth for navigation. Accepted overlay notes are additive guidance, and stale notes are warnings. Candidate notes do not enter normal task context until review accepts them.

Use persisted graph mode when you need the committed/indexed snapshot. Use `--live --root <repo>` when the working tree has uncommitted source, tests, or docs that should be included in the current task context. Live mode does not prove committed graph artifacts are current; it is a current-work preflight. Deleted files appear as dirty/deleted manifest metadata and stale-evidence findings rather than normal file nodes unless a future historical diff mode requests them.

Use `--json` for harnesses, eval runners, and other automated consumers. The markdown output is for humans. `cartographer preflight` always emits compact JSON and is the default graph-first agent preflight; it exposes `manifest`, `summary.primaryPaths`, `summary.impactPaths`, `summary.testPaths`, `summary.affectedPackages`, focused `summary.validationCommands`, `summary.annotationNotes`, `summary.findings`, slice/impact totals, compact-output `omissions`, compact-output `limits`, and a `preflight` metadata block with command, timestamps, total duration, and phase timings. Full `context --json` is the scoring mode when a harness needs nested `slice` and `impact` payloads with `selector`, `title`, `nodes`, `edges`, `annotations`, `findings`, and `summary` fields for recall, precision, slice size, package context, semantic-note coverage, and validation-command coverage. Top-level `summary.testPaths` is derived from `TESTS` edges and gives agents directly relevant test files without forcing them to parse nested edge payloads. `TESTS` edges come from explicit test imports and a conservative `__tests__` naming convention, so a facade-style test can still point agents at the source file it covers when that source file exists. Top-level `summary.annotationNotes` is derived from accepted or stale overlay annotations whose target nodes appear in the selected slice or impact view; candidate and retired notes stay out of normal preflight context. Nested `summary.affectedPackages` ranks owning packages by direct and ancestor coverage, while `summary.validationCommands` lists the package script id, package id, command name, raw package-script body as `command`, root-executable command as `runCommand`, and source `package.json` path. In compact preflight, validation commands are capped and focused for agent navigation; `limits.validationCommands` records the active cap, and `omissions.validationCommands` records how many broader commands were left out. The human preflight brief prefers `runCommand`, so package scripts appear as pasteable Bun invocations such as `bun run typecheck` or `cd apps/web && bun run typecheck` while preserving raw script metadata for tooling. `adoption --json` consumes raw runtime traces shaped as an event array or objects with `events`/`runtimeEvents` and emits the deterministic graph-adoption summary used by future live-agent scoring, including trace duration, first graph command offset, successful preflight result count and timings, shell-wrapped source-read detection, skill-instruction read exclusions, structured graph preflight failures, and first source-read-before-graph offset when timestamps are present. `--require-graph-first` turns that summary into a manual strict gate and includes `graphFirstAdoption` in JSON output. Repeatable `--expect-text`, `--expect-path`, and `--expect-command` flags check the final trace response for expected text, file paths, or validation-command mentions. Repeatable `--expect-executed-command` checks actual tool-command execution. The combined `finalResponseExpectation.metrics` object includes aggregate final-response hits, path tool/source-read hits, command mention hits, and executed-command hits. Expected-path checks also report whether each path appeared in the final response, any tool command, and any direct source-read command, which helps separate "the agent named the file" from "the agent actually navigated to it." Expected-command checks report whether each command appeared in the final response or an actual tool command; executed-command checks fail unless the command appears in tool execution history. These are manual gates, not generated eval reports.

Agent runtimes can opt into the same preflight without asking the model to run the command manually. A runtime wrapper should build compact Cartographer context against the active workspace before adapter execution, inject it into the prompt as a `cartographer-preflight` system reminder, and emit `tool_use`/`tool_result` runtime events shaped so `cartographer adoption --trace` can measure graph use. This is a harness workflow hook, not an eval report.

Slices and impact views include owning and ancestor packages plus focused validation scripts such as `build`, `lint`, `typecheck`, and `test:*`. Database slices also include safe schema/type/status scripts such as `db:types` and `db:status`; runtime-only or destructive scripts such as `dev`, `start`, `preview`, `postinstall`, `db:reset`, and `db:seed` are intentionally omitted. SQL files under migration paths become `Migration` nodes that connect to tables, functions, policies, and triggers through `MIGRATION_*` edges. Terraform `RESOURCE_DEPENDS_ON` edges connect resource and module nodes to referenced resources/modules, so `impact --path iacresource:<type>:<name>` can show downstream infrastructure that depends on that resource. GitHub Actions workflow files under `.github/workflows/*.yml` and `.github/workflows/*.yaml` become `Config` nodes for workflows, jobs, and `run` steps, with `CONFIGURES` and `TASK_DEPENDS_ON` edges. Run steps are classified as `validation`, `deployment`, or `other` metadata so agents can inspect CI/deploy evidence without Cartographer claiming a full CI task graph. Markdown links and backticked repo paths become `DOCUMENTS` edges when they point at indexed files.

Node-id selectors such as `env:DATABASE_URL`, `dbtable:public.accounts`, `script:.:test`, `symbol:src/index.ts:main`, and `iacresource:aws_s3_bucket:assets` are exact selectors. `config:ci:.github/workflows/ci.yml` selects the workflow config and its job/run descendants. `path:src/index.ts` is accepted in `context --path` and drives both the selected slice and impact view. Use plain text only when broad search is intentional.

Candidate overlay notes are not source-of-truth graph facts. A later review step should accept, reject, retire, or mark them stale based on cited evidence. Accepted and stale overlay notes are merged into slice/context/preflight output as `annotations` plus compact `summary.annotationNotes`; candidates remain visible only through `cartographer annotations` until reviewed. If an accepted note has missing evidence or a changed evidence hash, the normal graph context downgrades it to `stale` and emits an overlay finding so agents see the risk without running a separate audit first.

## OpenRouter Annotation Backend

`annotate` reads `OPENROUTER_API_KEY` from the environment and defaults to `openai/gpt-5.5`.

The key must not be committed to repo files. The CLI sends a tool-calling request to OpenRouter with a forced `record_annotations` function call, then writes grounded candidate notes to:

```text
docs/codegraph/overlays/agent-notes.jsonl
```

Use `--dry-run` to render the graph slice without calling OpenRouter.

This backend should only create candidate semantic notes. It must not promote model output into deterministic graph facts, and it should not be the only future path for annotations. A Codex harness, another model provider, or a human reviewer can write the same reviewable overlay shape.

A Codex harness should follow the same graph-first contract as normal task execution: inject or run preflight, read the returned slice before raw source exploration, inspect cited source evidence directly, write candidate-only notes, then run `cartographer annotations --json` for a deterministic receipt. OpenRouter-generated notes that do not cite at least one evidence path for their target node are dropped before writing candidates; the audit applies the same rule to hand-written or other-agent overlays. That keeps graph navigation, semantic writeback, and review decisions separately measurable in traces.

## Annotation Audit And Review

`annotations --json` without review flags is read-only. It does not call a model and does not change notes. It gives agents and reviewers a deterministic receipt for whether candidate or accepted notes are still grounded in the current graph:

- `reviewReadyCandidateCount`: candidate notes with known targets and current evidence.
- `usableAcceptedCount`: accepted notes with known targets and current evidence.
- `staleRecommendedCount`: candidate or accepted notes that should be refreshed, marked stale, or retired.
- `issues`: duplicate annotation IDs, target-node misses, evidence-path misses, and evidence hash mismatches.
- `parseIssues`: invalid JSONL or schema-invalid annotation lines.

Review mode is explicit and mutating:

- `annotations --accept <id> --reviewer <name>` promotes an audit-clean candidate to an accepted human-reviewed note.
- `annotations --retire <id> --reviewer <name>` marks a note retired when it is stale, unsafe, or no longer useful.

Use audit mode first, then review mode only when the receipt shows the target and evidence are current. Every reviewable note must cite at least one evidence path that belongs to the node it annotates; cross-file workflow notes should cite both the target and the related file/resource. Candidate notes are not normal graph facts, and accepted notes still become stale when cited evidence changes.
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/types.ts" language="ts">
<![CDATA[
export const CODE_GRAPH_SCHEMA_VERSION = "cartographer.code-graph.v1";

export type CodeGraphNodeKind =
	| "RepoSnapshot"
	| "Workspace"
	| "Package"
	| "PackageScript"
	| "File"
	| "Directory"
	| "Symbol"
	| "Entrypoint"
	| "Route"
	| "Test"
	| "Doc"
	| "GeneratedArtifact"
	| "Config"
	| "EnvVar"
	| "BoundaryPolicy"
	| "Finding"
	| "AgentAnnotation"
	| "ExternalDependency"
	| "Migration"
	| "DbTable"
	| "DbFunction"
	| "DbPolicy"
	| "DbTrigger"
	| "IaCModule"
	| "IaCResource"
	| "DirtyArtifact";

export type CodeGraphEdgeKind =
	| "CONTAINS"
	| "DEFINES"
	| "IMPORTS"
	| "TYPE_IMPORTS"
	| "EXPORTS"
	| "REFERENCES"
	| "CALLS"
	| "ROUTES_TO"
	| "TESTS"
	| "DOCUMENTS"
	| "GENERATED_BY"
	| "USES_ENV"
	| "CONFIGURES"
	| "SERVICE_QUERIES_TABLE"
	| "SERVICE_CALLS_RPC"
	| "TABLE_REFERENCES_TABLE"
	| "DEPENDS_ON"
	| "TASK_DEPENDS_ON"
	| "AFFECTS"
	| "OWNED_BY"
	| "GUARDED_BY"
	| "STALE_BECAUSE"
	| "ANNOTATES"
	| "MIGRATION_CREATES"
	| "MIGRATION_ALTERS"
	| "MIGRATION_DROPS"
	| "MIGRATION_SUPERSEDES"
	| "RESOURCE_DEPENDS_ON";

export type CodeGraphSource =
	| "filesystem"
	| "git"
	| "package-manager"
	| "syntax"
	| "typescript"
	| "fallow"
	| "iac-parser"
	| "sql-parser"
	| "ci-parser"
	| "doc-parser"
	| "agent-annotation"
	| "human-review";

export type CodeGraphConfidence = "deterministic" | "compiler-backed" | "agent-inferred" | "human-reviewed";
export type CodeGraphFreshness = "fresh" | "dirty" | "stale" | "unknown";

export interface CodeGraphEvidence {
	readonly path: string;
	readonly startLine?: number | undefined;
	readonly endLine?: number | undefined;
	readonly hash?: string | undefined;
}

export interface CodeGraphProvenance {
	readonly source: CodeGraphSource;
	readonly evidence: readonly CodeGraphEvidence[];
	readonly confidence: CodeGraphConfidence;
	readonly freshness: CodeGraphFreshness;
	readonly snapshotCommit?: string | undefined;
	readonly scannerVersion?: string | undefined;
}

export interface CodeGraphNode {
	readonly id: string;
	readonly kind: CodeGraphNodeKind;
	readonly label: string;
	readonly path?: string | undefined;
	readonly metadata: Record<string, unknown>;
	readonly provenance: CodeGraphProvenance;
}

export interface CodeGraphEdge {
	readonly id: string;
	readonly kind: CodeGraphEdgeKind;
	readonly from: string;
	readonly to: string;
	readonly label?: string | undefined;
	readonly metadata: Record<string, unknown>;
	readonly provenance: CodeGraphProvenance;
}

export interface CodeGraphFinding {
	readonly id: string;
	readonly severity: "info" | "warn" | "error";
	readonly message: string;
	readonly nodeId?: string | undefined;
	readonly evidence: readonly CodeGraphEvidence[];
}

export interface AgentAnnotation {
	readonly id: string;
	readonly targetNodeId: string;
	readonly kind:
		| "purpose"
		| "invariant"
		| "edit-warning"
		| "workflow"
		| "test-guidance"
		| "generated-ownership"
		| "iac-link"
		| "risk";
	readonly summary: string;
	readonly evidence: readonly CodeGraphEvidence[];
	readonly author: {
		readonly type: "agent" | "human";
		readonly name?: string | undefined;
		readonly runId?: string | undefined;
	};
	readonly confidence: "agent-inferred" | "human-reviewed";
	readonly status: "candidate" | "accepted" | "stale" | "retired";
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface CodeGraphManifest {
	readonly schemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION;
	readonly root: string;
	readonly generatedAt: string;
	readonly scanner: {
		readonly name: "cartographer";
		readonly version: string;
	};
	readonly git: {
		readonly commit?: string | undefined;
		readonly dirty: boolean;
		readonly trackedFiles: number;
		readonly untrackedFiles: number;
		readonly modifiedFiles: number;
		readonly deletedFiles: number;
	};
	readonly totals: {
		readonly files: number;
		readonly packages: number;
		readonly nodes: number;
		readonly edges: number;
		readonly findings: number;
	};
	readonly ignorePatterns: readonly string[];
}

export interface CodeGraphSnapshot {
	readonly schemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION;
	readonly manifest: CodeGraphManifest;
	readonly nodes: readonly CodeGraphNode[];
	readonly edges: readonly CodeGraphEdge[];
	readonly findings: readonly CodeGraphFinding[];
	readonly annotations: readonly AgentAnnotation[];
}

export interface BuildCodeGraphOptions {
	readonly root: string;
	readonly maxFileBytes?: number | undefined;
	readonly now?: Date | undefined;
}

export interface GraphSlice {
	readonly selector: string;
	readonly title: string;
	readonly nodes: readonly CodeGraphNode[];
	readonly edges: readonly CodeGraphEdge[];
	readonly findings: readonly CodeGraphFinding[];
	readonly annotations: readonly AgentAnnotation[];
	readonly summary?: GraphSliceSummary | undefined;
}

export interface GraphSliceSummary {
	readonly affectedPackages: readonly AffectedPackageSummary[];
	readonly validationCommands: readonly ValidationCommandSummary[];
	readonly annotationNotes: readonly AnnotationNoteSummary[];
}

export interface GraphContext {
	readonly path: string;
	readonly selector: string;
	readonly depth?: number | undefined;
	readonly manifest: CodeGraphManifest;
	readonly summary: GraphContextSummary;
	readonly slice: GraphSlice;
	readonly impact: GraphSlice;
}

export interface GraphContextCompact {
	readonly path: string;
	readonly selector: string;
	readonly depth?: number | undefined;
	readonly manifest: CodeGraphManifest;
	readonly summary: GraphContextSummary;
	readonly totals: GraphContextTotals;
	readonly omissions: GraphContextOmissions;
	readonly limits: GraphContextLimits;
}

export interface GraphContextOmissions {
	readonly validationCommands: number;
}

export interface GraphContextLimits {
	readonly validationCommands: number;
}

export interface GraphContextTotals {
	readonly slice: GraphContextGraphTotals;
	readonly impact: GraphContextGraphTotals;
}

export interface GraphContextGraphTotals {
	readonly nodes: number;
	readonly edges: number;
	readonly findings: number;
}

export interface GraphContextSummary {
	readonly primaryPaths: readonly string[];
	readonly impactPaths: readonly string[];
	readonly testPaths: readonly string[];
	readonly affectedPackages: readonly AffectedPackageSummary[];
	readonly validationCommands: readonly ValidationCommandSummary[];
	readonly annotationNotes: readonly AnnotationNoteSummary[];
	readonly findings: readonly CodeGraphFinding[];
}

export interface AnnotationNoteSummary {
	readonly id: string;
	readonly targetNodeId: string;
	readonly kind: AgentAnnotation["kind"];
	readonly status: AgentAnnotation["status"];
	readonly confidence: AgentAnnotation["confidence"];
	readonly summary: string;
	readonly evidencePaths: readonly string[];
}

export interface AffectedPackageSummary {
	readonly packageId: string;
	readonly label: string;
	readonly directory: string;
	readonly path?: string | undefined;
	readonly rank: number;
	readonly directNodeCount: number;
	readonly ancestorNodeCount: number;
	readonly scriptIds: readonly string[];
}

export interface ValidationCommandSummary {
	readonly packageId: string;
	readonly scriptId: string;
	readonly name: string;
	readonly command?: string | undefined;
	readonly runCommand?: string | undefined;
	readonly path?: string | undefined;
}

export interface WriteCodeGraphOptions {
	readonly outDir: string;
	readonly mapPath?: string | undefined;
}
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/schema.ts" language="ts">
<![CDATA[
import { z } from "zod";
import { CODE_GRAPH_SCHEMA_VERSION, type CodeGraphSnapshot } from "./types.ts";

const nodeKindSchema = z.enum([
	"RepoSnapshot",
	"Workspace",
	"Package",
	"PackageScript",
	"File",
	"Directory",
	"Symbol",
	"Entrypoint",
	"Route",
	"Test",
	"Doc",
	"GeneratedArtifact",
	"Config",
	"EnvVar",
	"BoundaryPolicy",
	"Finding",
	"AgentAnnotation",
	"ExternalDependency",
	"Migration",
	"DbTable",
	"DbFunction",
	"DbPolicy",
	"DbTrigger",
	"IaCModule",
	"IaCResource",
	"DirtyArtifact",
]);

const edgeKindSchema = z.enum([
	"CONTAINS",
	"DEFINES",
	"IMPORTS",
	"TYPE_IMPORTS",
	"EXPORTS",
	"REFERENCES",
	"CALLS",
	"ROUTES_TO",
	"TESTS",
	"DOCUMENTS",
	"GENERATED_BY",
	"USES_ENV",
	"CONFIGURES",
	"SERVICE_QUERIES_TABLE",
	"SERVICE_CALLS_RPC",
	"TABLE_REFERENCES_TABLE",
	"DEPENDS_ON",
	"TASK_DEPENDS_ON",
	"AFFECTS",
	"OWNED_BY",
	"GUARDED_BY",
	"STALE_BECAUSE",
	"ANNOTATES",
	"MIGRATION_CREATES",
	"MIGRATION_ALTERS",
	"MIGRATION_DROPS",
	"MIGRATION_SUPERSEDES",
	"RESOURCE_DEPENDS_ON",
]);

export const codeGraphEvidenceSchema = z.object({
	path: z.string(),
	startLine: z.number().int().positive().optional(),
	endLine: z.number().int().positive().optional(),
	hash: z.string().optional(),
});

const provenanceSchema = z.object({
	source: z.enum([
		"filesystem",
		"git",
		"package-manager",
		"syntax",
		"typescript",
		"fallow",
		"iac-parser",
		"sql-parser",
		"ci-parser",
		"doc-parser",
		"agent-annotation",
		"human-review",
	]),
	evidence: z.array(codeGraphEvidenceSchema),
	confidence: z.enum(["deterministic", "compiler-backed", "agent-inferred", "human-reviewed"]),
	freshness: z.enum(["fresh", "dirty", "stale", "unknown"]),
	snapshotCommit: z.string().optional(),
	scannerVersion: z.string().optional(),
});

export const agentAnnotationSchema = z.object({
	id: z.string(),
	targetNodeId: z.string(),
	kind: z.enum([
		"purpose",
		"invariant",
		"edit-warning",
		"workflow",
		"test-guidance",
		"generated-ownership",
		"iac-link",
		"risk",
	]),
	summary: z.string(),
	evidence: z.array(codeGraphEvidenceSchema),
	author: z.object({
		type: z.enum(["agent", "human"]),
		name: z.string().optional(),
		runId: z.string().optional(),
	}),
	confidence: z.enum(["agent-inferred", "human-reviewed"]),
	status: z.enum(["candidate", "accepted", "stale", "retired"]),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const codeGraphSnapshotSchema = z.object({
	schemaVersion: z.literal(CODE_GRAPH_SCHEMA_VERSION),
	manifest: z.object({
		schemaVersion: z.literal(CODE_GRAPH_SCHEMA_VERSION),
		root: z.string(),
		generatedAt: z.string(),
		scanner: z.object({
			name: z.literal("cartographer"),
			version: z.string(),
		}),
		git: z.object({
			commit: z.string().optional(),
			dirty: z.boolean(),
			trackedFiles: z.number().int().nonnegative(),
			untrackedFiles: z.number().int().nonnegative(),
			modifiedFiles: z.number().int().nonnegative(),
			deletedFiles: z.number().int().nonnegative(),
		}),
		totals: z.object({
			files: z.number().int().nonnegative(),
			packages: z.number().int().nonnegative(),
			nodes: z.number().int().nonnegative(),
			edges: z.number().int().nonnegative(),
			findings: z.number().int().nonnegative(),
		}),
		ignorePatterns: z.array(z.string()),
	}),
	nodes: z.array(
		z.object({
			id: z.string(),
			kind: nodeKindSchema,
			label: z.string(),
			path: z.string().optional(),
			metadata: z.record(z.string(), z.unknown()),
			provenance: provenanceSchema,
		}),
	),
	edges: z.array(
		z.object({
			id: z.string(),
			kind: edgeKindSchema,
			from: z.string(),
			to: z.string(),
			label: z.string().optional(),
			metadata: z.record(z.string(), z.unknown()),
			provenance: provenanceSchema,
		}),
	),
	findings: z.array(
		z.object({
			id: z.string(),
			severity: z.enum(["info", "warn", "error"]),
			message: z.string(),
			nodeId: z.string().optional(),
			evidence: z.array(codeGraphEvidenceSchema),
		}),
	),
	annotations: z.array(agentAnnotationSchema),
}) satisfies z.ZodType<CodeGraphSnapshot>;

export function codeGraphJsonSchema(): Record<string, unknown> {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: "Cartographer Code Graph Snapshot",
		type: "object",
		required: ["schemaVersion", "manifest", "nodes", "edges", "findings", "annotations"],
		properties: {
			schemaVersion: { const: CODE_GRAPH_SCHEMA_VERSION },
			manifest: { type: "object" },
			nodes: { type: "array" },
			edges: { type: "array" },
			findings: { type: "array" },
			annotations: { type: "array" },
		},
		additionalProperties: false,
	};
}
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/artifacts.ts" language="ts">
<![CDATA[
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { countBy } from "./collections.ts";
import { CODE_GRAPH_SCHEMA_VERSION } from "./types.ts";
import { codeGraphJsonSchema, codeGraphSnapshotSchema } from "./schema.ts";
import { summarizeGraph } from "./query.ts";
import type { CodeGraphSnapshot, WriteCodeGraphOptions } from "./types.ts";

export async function writeCodeGraphArtifacts(graph: CodeGraphSnapshot, options: WriteCodeGraphOptions): Promise<void> {
	const parsed = codeGraphSnapshotSchema.parse(graph);
	await mkdir(options.outDir, { recursive: true });
	await Bun.write(join(options.outDir, "schema.json"), `${JSON.stringify(codeGraphJsonSchema(), null, 2)}\n`);
	await Bun.write(join(options.outDir, "manifest.json"), `${JSON.stringify(parsed.manifest, null, 2)}\n`);
	await Bun.write(join(options.outDir, "graph.json"), `${JSON.stringify(parsed, null, 2)}\n`);
	const mapPath = options.mapPath ?? join(options.outDir, "CODEBASE_MAP.md");
	await mkdir(dirname(mapPath), { recursive: true });
	await Bun.write(mapPath, renderMap(parsed));
}

export async function readCodeGraph(outDir: string): Promise<CodeGraphSnapshot> {
	const graphPath = join(outDir, "graph.json");
	const raw = await Bun.file(graphPath).json();
	return codeGraphSnapshotSchema.parse(raw);
}

export interface CodeGraphArtifactCompatibility {
	readonly outDir: string;
	readonly ok: boolean;
	readonly schemaVersion?: string | undefined;
	readonly generatedAt?: string | undefined;
	readonly issues: readonly CodeGraphArtifactCompatibilityIssue[];
	readonly totals?: {
		readonly files: number;
		readonly packages: number;
		readonly nodes: number;
		readonly edges: number;
		readonly findings: number;
	} | undefined;
}

export interface CodeGraphArtifactCompatibilityIssue {
	readonly code:
		| "missing-artifact"
		| "invalid-json"
		| "schema-version-mismatch"
		| "schema-validation-failed"
		| "manifest-mismatch"
		| "duplicate-node-id"
		| "duplicate-edge-id"
		| "dangling-edge";
	readonly severity: "error" | "warn";
	readonly message: string;
	readonly path?: string | undefined;
}

export async function checkCodeGraphArtifacts(outDir: string): Promise<CodeGraphArtifactCompatibility> {
	const issues: CodeGraphArtifactCompatibilityIssue[] = [];
	await checkRequiredArtifacts(outDir, issues);
	const graphPath = join(outDir, "graph.json");
	if (!(await Bun.file(graphPath).exists())) return compatibilityResult(outDir, issues);
	const raw = await readJsonArtifact(graphPath, issues);
	if (raw === undefined) return compatibilityResult(outDir, issues);
	const parsed = codeGraphSnapshotSchema.safeParse(raw);
	if (!parsed.success) {
		issues.push({
			code: "schema-validation-failed",
			severity: "error",
			message: parsed.error.issues.map((issue) => issue.message).join("; "),
			path: join(outDir, "graph.json"),
		});
		return compatibilityResult(outDir, issues, schemaVersionFrom(raw));
	}
	await checkManifestArtifact(outDir, parsed.data, issues);
	checkManifestConsistency(parsed.data, issues);
	checkGraphIds(parsed.data, issues);
	return compatibilityResult(outDir, issues, parsed.data.schemaVersion, parsed.data.manifest.generatedAt, parsed.data.manifest.totals);
}

export function renderMap(graph: CodeGraphSnapshot): string {
	const filesByKind = countBy(
		graph.nodes.filter((node) => node.kind === "File" || node.kind === "Doc" || node.kind === "GeneratedArtifact"),
		(node) => String(node.metadata["fileKind"] ?? node.kind),
	);
	const packages = graph.nodes.filter((node) => node.kind === "Package");
	const scripts = graph.nodes.filter((node) => node.kind === "PackageScript");
	const envVars = graph.nodes.filter((node) => node.kind === "EnvVar");
	const iacNodes = graph.nodes.filter((node) => node.kind === "IaCResource" || node.kind === "IaCModule");
	const dbNodes = graph.nodes.filter((node) => node.kind.startsWith("Db"));
	return [
		"# Codebase Map",
		"",
		"Generated by Cartographer code graph.",
		"",
		"## Summary",
		"",
		`\`\`\`text\n${summarizeGraph(graph).trim()}\n\`\`\``,
		"",
		"## File Mix",
		...Object.entries(filesByKind).map(([kind, count]) => `- ${kind}: ${count}`),
		"",
		"## Packages",
		...renderNodeList(packages, (node) => `- ${node.label} - \`${node.path ?? node.id}\``),
		"",
		"## Package Scripts",
		...renderNodeList(scripts, (node) => `- ${node.label}: \`${String(node.metadata["command"] ?? "")}\``),
		"",
		"## Environment Variables",
		...renderNodeList(envVars, (node) => `- ${node.label}`),
		"",
		"## Database And IaC",
		...renderNodeList(
			[...dbNodes, ...iacNodes],
			(node) => `- ${node.kind}: ${node.label} - \`${node.path ?? node.id}\``,
		),
		"",
		"## Findings",
		...(graph.findings.length === 0
			? ["- None"]
			: graph.findings.map((finding) => `- ${finding.severity}: ${finding.message}`)),
		"",
		"## Agent Notes",
		"",
		"Use `cartographer annotate` to generate candidate semantic overlay notes. Agent annotations are not canonical graph facts until reviewed.",
		"",
	].join("\n");
}

function renderNodeList<T>(nodes: readonly T[], renderNode: (node: T) => string): readonly string[] {
	return nodes.length === 0 ? ["- None detected"] : nodes.map(renderNode);
}

async function checkRequiredArtifacts(outDir: string, issues: CodeGraphArtifactCompatibilityIssue[]): Promise<void> {
	for (const name of ["schema.json", "manifest.json", "graph.json"] as const) {
		const path = join(outDir, name);
		if (!(await Bun.file(path).exists())) {
			issues.push({
				code: "missing-artifact",
				severity: "error",
				message: `missing ${name}`,
				path,
			});
		}
	}
}

async function readJsonArtifact(
	path: string,
	issues: CodeGraphArtifactCompatibilityIssue[],
): Promise<unknown | undefined> {
	try {
		return await Bun.file(path).json();
	} catch (cause) {
		issues.push({
			code: "invalid-json",
			severity: "error",
			message: `${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
			path,
		});
		return undefined;
	}
}

async function checkManifestArtifact(
	outDir: string,
	graph: CodeGraphSnapshot,
	issues: CodeGraphArtifactCompatibilityIssue[],
): Promise<void> {
	const manifestPath = join(outDir, "manifest.json");
	if (!(await Bun.file(manifestPath).exists())) return;
	const raw = await readJsonArtifact(manifestPath, issues);
	if (raw === undefined) return;
	if (stableJson(raw) !== stableJson(graph.manifest)) {
		issues.push({
			code: "manifest-mismatch",
			severity: "error",
			message: "manifest.json does not match graph.json manifest",
			path: manifestPath,
		});
	}
}

function checkManifestConsistency(
	graph: CodeGraphSnapshot,
	issues: CodeGraphArtifactCompatibilityIssue[],
): void {
	if (graph.schemaVersion !== CODE_GRAPH_SCHEMA_VERSION || graph.manifest.schemaVersion !== CODE_GRAPH_SCHEMA_VERSION) {
		issues.push({
			code: "schema-version-mismatch",
			severity: "error",
			message: `expected schema version ${CODE_GRAPH_SCHEMA_VERSION}`,
			path: "graph.json",
		});
	}
	const packageCount = graph.nodes.filter((node) => node.kind === "Package").length;
	const fileCount = graph.nodes.filter(
		(node) => node.kind === "File" || node.kind === "Doc" || node.kind === "GeneratedArtifact",
	).length;
	const expectedTotals = {
		files: fileCount,
		packages: packageCount,
		nodes: graph.nodes.length,
		edges: graph.edges.length,
		findings: graph.findings.length,
	};
	for (const [key, expected] of Object.entries(expectedTotals)) {
		const actual = graph.manifest.totals[key as keyof typeof graph.manifest.totals];
		if (actual !== expected) {
			issues.push({
				code: "manifest-mismatch",
				severity: "error",
				message: `manifest total ${key} is ${actual}, expected ${expected}`,
				path: "manifest.json",
			});
		}
	}
}

function checkGraphIds(graph: CodeGraphSnapshot, issues: CodeGraphArtifactCompatibilityIssue[]): void {
	const nodeIds = new Set<string>();
	for (const node of graph.nodes) {
		if (nodeIds.has(node.id)) {
			issues.push({
				code: "duplicate-node-id",
				severity: "error",
				message: `duplicate node id: ${node.id}`,
				path: node.path,
			});
		}
		nodeIds.add(node.id);
	}
	const edgeIds = new Set<string>();
	for (const edge of graph.edges) {
		if (edgeIds.has(edge.id)) {
			issues.push({
				code: "duplicate-edge-id",
				severity: "error",
				message: `duplicate edge id: ${edge.id}`,
			});
		}
		edgeIds.add(edge.id);
		if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
			issues.push({
				code: "dangling-edge",
				severity: "error",
				message: `dangling edge ${edge.id}: ${edge.from} -> ${edge.to}`,
			});
		}
	}
}

function compatibilityResult(
	outDir: string,
	issues: readonly CodeGraphArtifactCompatibilityIssue[],
	schemaVersion?: string | undefined,
	generatedAt?: string | undefined,
	totals?: CodeGraphArtifactCompatibility["totals"],
): CodeGraphArtifactCompatibility {
	return {
		outDir,
		ok: !issues.some((issue) => issue.severity === "error"),
		schemaVersion,
		generatedAt,
		issues,
		totals,
	};
}

function schemaVersionFrom(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	const schemaVersion = value["schemaVersion"];
	return typeof schemaVersion === "string" ? schemaVersion : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
	return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, sortJsonValue(entry)]),
	);
}
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/builder.ts" language="ts">
<![CDATA[
import { basename } from "node:path";
import { DEFAULT_MAX_FILE_BYTES } from "./defaults.ts";
import {
	extractDataAccessFacts,
	extractDocReferenceFacts,
	extractEnvVars,
	extractIacDependencyFacts,
	extractIacFacts,
	extractImports,
	extractSqlReferenceFacts,
	extractSqlFacts,
	extractSymbols,
	extractWorkflowFacts,
	readText,
} from "./extractors.ts";
import { createRepoInventory, type GitInventory, type InventoryFile } from "./inventory.ts";
import { addPackageFacts } from "./package-facts.ts";
import { defaultIgnorePatterns } from "./path-utils.ts";
import {
	addEdge,
	addNode,
	addProvenanceEdge,
	createMutableGraph,
	fileNodeId,
	provenance,
	SCANNER_VERSION,
	type MutableGraph,
} from "./graph-store.ts";
import {
	directoryNodeId,
	freshnessFor,
	parentDirectory,
	parentDirectoryNodeId,
	uniqueDirectories,
} from "./graph-paths.ts";
import {
	CODE_GRAPH_SCHEMA_VERSION,
	type BuildCodeGraphOptions,
	type CodeGraphEdgeKind,
	type CodeGraphManifest,
	type CodeGraphNode,
	type CodeGraphSnapshot,
} from "./types.ts";

const sqlNodeKinds = {
	table: "DbTable",
	function: "DbFunction",
	policy: "DbPolicy",
	trigger: "DbTrigger",
} as const satisfies Record<ReturnType<typeof extractSqlFacts>[number]["kind"], CodeGraphNode["kind"]>;

const sqlEdgeKinds = {
	creates: "MIGRATION_CREATES",
	alters: "MIGRATION_ALTERS",
	drops: "MIGRATION_DROPS",
} as const satisfies Record<ReturnType<typeof extractSqlFacts>[number]["action"], CodeGraphEdgeKind>;

export async function buildCodeGraph(options: BuildCodeGraphOptions): Promise<CodeGraphSnapshot> {
	const context = await createBuildContext(options);
	addInventoryNodes(context.graph, context.inventory);
	await addInventoryFacts(context.graph, context.inventory);

	return snapshotFor(context);
}

interface BuildContext {
	readonly now: Date;
	readonly inventory: Awaited<ReturnType<typeof createRepoInventory>>;
	readonly graph: MutableGraph;
}

async function createBuildContext(options: BuildCodeGraphOptions): Promise<BuildContext> {
	const inventory = await createRepoInventory(options.root, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
	const graph = createMutableGraph();
	return { now: options.now ?? new Date(), inventory, graph };
}

function addInventoryNodes(graph: MutableGraph, inventory: BuildContext["inventory"]): void {
	addRootNode(graph, inventory.root);
	addDirectoryNodes(graph, inventory.files);
	for (const file of inventory.files) addFileNode(graph, file);
}

async function addInventoryFacts(graph: MutableGraph, inventory: BuildContext["inventory"]): Promise<void> {
	const allPaths = new Set(inventory.files.map((file) => file.path));
	await addPackageFacts(graph, inventory.files);
	addGeneratedOwnershipFacts(graph, inventory.files);
	for (const file of inventory.files) await addFileFacts(graph, file, allPaths);
	addInferredTestCoverageFacts(graph, inventory.files, allPaths);
	await addSqlReferenceEdges(graph, inventory.files);
	await addDataAccessEdges(graph, inventory.files);
	await addIacDependencyEdges(graph, inventory.files);
}

function snapshotFor(context: BuildContext): CodeGraphSnapshot {
	const { graph, inventory, now } = context;
	const manifest = manifestFor(inventory.root, now, inventory.git, graph, inventory.files);
	return {
		schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
		manifest,
		nodes: [...graph.nodes.values()],
		edges: [...graph.edges.values()],
		findings: graph.findings,
		annotations: [],
	};
}

function addRootNode(graph: MutableGraph, root: string): void {
	addNode(graph, {
		id: "repo:root",
		kind: "RepoSnapshot",
		label: basename(root),
		metadata: { root },
		provenance: provenance("filesystem", []),
	});
}

function addDirectoryNodes(graph: MutableGraph, files: readonly InventoryFile[]): void {
	for (const directory of uniqueDirectories(files)) addDirectoryNode(graph, directory);
}

function addDirectoryNode(graph: MutableGraph, directory: string): void {
	const id = directoryNodeId(directory);
	addNode(graph, {
		id,
		kind: "Directory",
		label: directory,
		path: directory,
		metadata: {},
		provenance: provenance("filesystem", [{ path: directory }]),
	});
	addEdge(graph, "CONTAINS", parentDirectoryNodeId(directory), id, "contains");
}

function addFileNode(graph: MutableGraph, file: InventoryFile): void {
	addNode(graph, {
		id: fileNodeId(file.path),
		kind: fileNodeKind(file),
		label: basename(file.path),
		path: file.path,
		metadata: {
			sizeBytes: file.sizeBytes,
			lineCount: file.lineCount,
			fileKind: file.kind,
			gitStatus: file.gitStatus,
			readableText: file.readableText,
		},
		provenance: provenance("filesystem", [{ path: file.path, hash: file.hash }], freshnessFor(file)),
	});
	addEdge(graph, "CONTAINS", `dir:${parentDirectory(file.path)}`, fileNodeId(file.path), "contains");
	if (file.gitStatus !== "tracked" && file.gitStatus !== "unknown") addDirtyArtifact(graph, file);
}

function fileNodeKind(file: InventoryFile): CodeGraphNode["kind"] {
	if (file.kind === "generated") return "GeneratedArtifact";
	if (file.path.endsWith(".md")) return "Doc";
	return "File";
}

async function addFileFacts(graph: MutableGraph, file: InventoryFile, allPaths: ReadonlySet<string>): Promise<void> {
	const text = await readText(file);
	if (text === undefined) return;
	addImports(graph, file, text, allPaths);
	addDocReferenceFacts(graph, file, text, allPaths);
	addSymbols(graph, file, text);
	addEnvVars(graph, file, text);
	addSqlFacts(graph, file, text);
	addIacFacts(graph, file, text);
	addWorkflowFacts(graph, file, text);
}

function addImports(graph: MutableGraph, file: InventoryFile, text: string, allPaths: ReadonlySet<string>): void {
	for (const fact of extractImports(file, text, allPaths)) {
		addImportFact(graph, file, fact);
	}
}

function addImportFact(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractImports>[number],
): void {
	const dependencyId = importDependencyNodeId(graph, file, fact);
	if (dependencyId === undefined) return;
	addEdge(graph, importEdgeKind(fact), fileNodeId(file.path), dependencyId, fact.specifier);
	addTestCoverageEdge(graph, file, fact, dependencyId);
}

function importDependencyNodeId(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractImports>[number],
): string | undefined {
	if (fact.targetPath !== undefined) return fileNodeId(fact.targetPath);
	if (fact.externalPackage === undefined) return undefined;
	return addExternalDependency(graph, file, fact.externalPackage, fact.specifier);
}

function addExternalDependency(
	graph: MutableGraph,
	file: InventoryFile,
	packageName: string,
	specifier: string,
): string {
	const dependencyId = `external:${packageName}`;
	addNode(graph, {
		id: dependencyId,
		kind: "ExternalDependency",
		label: packageName,
		metadata: { specifier },
		provenance: provenance("syntax", [{ path: file.path }]),
	});
	return dependencyId;
}

function importEdgeKind(fact: ReturnType<typeof extractImports>[number]): CodeGraphEdgeKind {
	return fact.typeOnly ? "TYPE_IMPORTS" : "IMPORTS";
}

function addSymbols(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractSymbols(file, text)) {
		const symbolId = `symbol:${file.path}:${fact.name}`;
		addNode(graph, {
			id: symbolId,
			kind: "Symbol",
			label: fact.name,
			path: file.path,
			metadata: { symbolKind: fact.kind, exported: fact.exported },
			provenance: provenance("syntax", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		});
		addEdge(graph, "DEFINES", fileNodeId(file.path), symbolId, fact.kind);
		if (fact.exported) addEdge(graph, "EXPORTS", fileNodeId(file.path), symbolId, fact.kind);
	}
}

function addEnvVars(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractEnvVars(text)) {
		const envId = `env:${fact.name}`;
		addNode(graph, {
			id: envId,
			kind: "EnvVar",
			label: fact.name,
			metadata: {},
			provenance: provenance("syntax", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		});
		addEdge(graph, "USES_ENV", fileNodeId(file.path), envId, fact.name);
	}
}

function addDocReferenceFacts(
	graph: MutableGraph,
	file: InventoryFile,
	text: string,
	allPaths: ReadonlySet<string>,
): void {
	for (const fact of extractDocReferenceFacts(file, text, allPaths)) {
		addProvenanceEdge(
			graph,
			"DOCUMENTS",
			fileNodeId(file.path),
			fileNodeId(fact.targetPath),
			fact.label,
			provenance("doc-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		);
	}
}

function addSqlFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	addMigrationNode(graph, file);
	for (const fact of extractSqlFacts(file, text)) {
		const kind = sqlNodeKinds[fact.kind];
		const nodeId = `${kind.toLowerCase()}:${fact.name}`;
		addNode(graph, {
			id: nodeId,
			kind,
			label: fact.name,
			path: file.path,
			metadata: { action: fact.action },
			provenance: provenance("sql-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		});
		addProvenanceEdge(
			graph,
			sqlEdgeKinds[fact.action],
			sqlFactSourceNodeId(file),
			nodeId,
			fact.action,
			provenance("sql-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		);
	}
}

function addMigrationNode(graph: MutableGraph, file: InventoryFile): void {
	if (!isSqlMigrationPath(file.path)) return;
	const nodeId = migrationNodeId(file.path);
	addNode(graph, {
		id: nodeId,
		kind: "Migration",
		label: basename(file.path),
		path: file.path,
		metadata: { migrationKind: "sql" },
		provenance: provenance("sql-parser", [{ path: file.path, hash: file.hash }], freshnessFor(file)),
	});
	addProvenanceEdge(
		graph,
		"CONFIGURES",
		fileNodeId(file.path),
		nodeId,
		"sql migration",
		provenance("sql-parser", [{ path: file.path, hash: file.hash }], freshnessFor(file)),
	);
}

function sqlFactSourceNodeId(file: InventoryFile): string {
	return isSqlMigrationPath(file.path) ? migrationNodeId(file.path) : fileNodeId(file.path);
}

function migrationNodeId(path: string): string {
	return `migration:${path}`;
}

function isSqlMigrationPath(path: string): boolean {
	return path.endsWith(".sql") && /(^|\/)(migrations?|supabase\/migrations)\//i.test(path);
}

function addIacFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractIacFacts(file, text)) {
		const kind = fact.kind === "module" ? "IaCModule" : "IaCResource";
		const nodeId = `${kind.toLowerCase()}:${fact.type}:${fact.name}`;
		addNode(graph, {
			id: nodeId,
			kind,
			label: `${fact.type}.${fact.name}`,
			path: file.path,
			metadata: { type: fact.type, name: fact.name },
			provenance: provenance("iac-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		});
		addEdge(graph, "CONFIGURES", fileNodeId(file.path), nodeId, fact.kind);
	}
}

function addWorkflowFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	const facts = extractWorkflowFacts(file, text);
	for (const fact of facts) addWorkflowNode(graph, file, fact);
	for (const fact of facts) addWorkflowEdges(graph, file, fact);
}

function addWorkflowNode(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractWorkflowFacts>[number],
): void {
	addNode(graph, {
		id: workflowNodeId(file, fact),
		kind: "Config",
		label: fact.name,
		path: file.path,
		metadata: {
			configKind: "ci-workflow",
			workflowFactKind: fact.kind,
			workflowName: fact.workflowName,
			taskKind: fact.taskKind,
			...(fact.jobId === undefined ? {} : { jobId: fact.jobId }),
			...(fact.stepIndex === undefined ? {} : { stepIndex: fact.stepIndex }),
			...(fact.command === undefined ? {} : { command: fact.command }),
		},
		provenance: provenance("ci-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
	});
}

function addWorkflowEdges(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractWorkflowFacts>[number],
): void {
	const nodeId = workflowNodeId(file, fact);
	if (fact.kind === "workflow") {
		addProvenanceEdge(
			graph,
			"CONFIGURES",
			fileNodeId(file.path),
			nodeId,
			"ci workflow",
			provenance("ci-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		);
		return;
	}
	if (fact.kind === "job") {
		addProvenanceEdge(
			graph,
			"CONFIGURES",
			workflowRootNodeId(file),
			nodeId,
			fact.taskKind,
			provenance("ci-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		);
		return;
	}
	addProvenanceEdge(
		graph,
		"TASK_DEPENDS_ON",
		workflowJobNodeId(file, fact.jobId ?? "unknown"),
		nodeId,
		fact.taskKind,
		provenance("ci-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
	);
}

function workflowNodeId(file: InventoryFile, fact: ReturnType<typeof extractWorkflowFacts>[number]): string {
	if (fact.kind === "workflow") return workflowRootNodeId(file);
	if (fact.kind === "job") return workflowJobNodeId(file, fact.jobId ?? fact.name);
	return `config:ci:${file.path}:job:${fact.jobId ?? "unknown"}:run:${fact.stepIndex ?? fact.line}`;
}

function workflowRootNodeId(file: InventoryFile): string {
	return `config:ci:${file.path}`;
}

function workflowJobNodeId(file: InventoryFile, jobId: string): string {
	return `config:ci:${file.path}:job:${jobId}`;
}

async function addSqlReferenceEdges(graph: MutableGraph, files: readonly InventoryFile[]): Promise<void> {
	for (const file of files) {
		const text = await readText(file);
		if (text === undefined) continue;
		addSqlReferenceFacts(graph, file, text);
	}
}

function addSqlReferenceFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractSqlReferenceFacts(file, text)) addSqlReferenceFact(graph, fact);
}

function addSqlReferenceFact(graph: MutableGraph, fact: ReturnType<typeof extractSqlReferenceFacts>[number]): void {
	const ids = sqlReferenceEdgeIds(graph, fact);
	if (ids === undefined) return;
	addEdge(graph, "TABLE_REFERENCES_TABLE", ids.fromId, ids.toId, fact.toTable);
}

function sqlReferenceEdgeIds(
	graph: MutableGraph,
	fact: ReturnType<typeof extractSqlReferenceFacts>[number],
): { readonly fromId: string; readonly toId: string } | undefined {
	const fromId = dbNodeIdByName(graph, "DbTable", "dbtable:", fact.fromTable);
	const toId = dbNodeIdByName(graph, "DbTable", "dbtable:", fact.toTable);
	if (fromId === undefined) return undefined;
	if (toId === undefined) return undefined;
	if (fromId === toId) return undefined;
	return { fromId, toId };
}

async function addDataAccessEdges(graph: MutableGraph, files: readonly InventoryFile[]): Promise<void> {
	for (const file of files) {
		const text = await readText(file);
		if (text === undefined) continue;
		addDataAccessFacts(graph, file, text);
	}
}

function addDataAccessFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractDataAccessFacts(file, text)) addDataAccessFact(graph, file, fact);
}

function addDataAccessFact(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractDataAccessFacts>[number],
): void {
	const targetId = dataAccessTargetNodeId(graph, fact);
	if (targetId === undefined) return;
	addEdge(graph, dataAccessEdgeKind(fact), fileNodeId(file.path), targetId, fact.name);
}

function dataAccessEdgeKind(fact: ReturnType<typeof extractDataAccessFacts>[number]): CodeGraphEdgeKind {
	return fact.kind === "rpc" ? "SERVICE_CALLS_RPC" : "SERVICE_QUERIES_TABLE";
}

function dataAccessTargetNodeId(
	graph: MutableGraph,
	fact: ReturnType<typeof extractDataAccessFacts>[number],
): string | undefined {
	return dbNodeIdByName(graph, dataAccessNodeKind(fact), dataAccessNodePrefix(fact), fact.name);
}

function dataAccessNodeKind(
	fact: ReturnType<typeof extractDataAccessFacts>[number],
): Extract<CodeGraphNode["kind"], "DbFunction" | "DbTable"> {
	return fact.kind === "rpc" ? "DbFunction" : "DbTable";
}

function dataAccessNodePrefix(fact: ReturnType<typeof extractDataAccessFacts>[number]): "dbfunction:" | "dbtable:" {
	return fact.kind === "rpc" ? "dbfunction:" : "dbtable:";
}

function dbNodeIdByName(
	graph: MutableGraph,
	kind: Extract<CodeGraphNode["kind"], "DbFunction" | "DbTable">,
	prefix: "dbfunction:" | "dbtable:",
	name: string,
): string | undefined {
	const exact = [`${prefix}${name}`, `${prefix}public.${name}`].find((id) => graph.nodes.get(id)?.kind === kind);
	if (exact !== undefined) return exact;
	return uniqueDbNodeBySuffix(graph, kind, `.${name}`)?.id;
}

function uniqueDbNodeBySuffix(
	graph: MutableGraph,
	kind: Extract<CodeGraphNode["kind"], "DbFunction" | "DbTable">,
	suffix: string,
): CodeGraphNode | undefined {
	const matches = [...graph.nodes.values()].filter((node) => node.kind === kind && node.label.endsWith(suffix));
	return matches.length === 1 ? matches[0] : undefined;
}

async function addIacDependencyEdges(graph: MutableGraph, files: readonly InventoryFile[]): Promise<void> {
	for (const file of files) {
		const text = await readText(file);
		if (text === undefined) continue;
		addIacDependencyFacts(graph, file, text);
	}
}

function addIacDependencyFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractIacDependencyFacts(file, text)) addIacDependencyFact(graph, file, fact);
}

function addIacDependencyFact(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractIacDependencyFacts>[number],
): void {
	const fromId = iacDependencyNodeId(fact.from);
	const toId = iacDependencyNodeId(fact.to);
	if (fromId === toId) return;
	if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) return;
	addProvenanceEdge(
		graph,
		"RESOURCE_DEPENDS_ON",
		fromId,
		toId,
		iacDependencyLabel(fact.to),
		provenance("iac-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
	);
}

function iacDependencyNodeId(endpoint: ReturnType<typeof extractIacDependencyFacts>[number]["from"]): string {
	if (endpoint.kind === "module") return `iacmodule:module:${endpoint.name}`;
	return `iacresource:${endpoint.type}:${endpoint.name}`;
}

function iacDependencyLabel(endpoint: ReturnType<typeof extractIacDependencyFacts>[number]["to"]): string {
	if (endpoint.kind === "module") return `module.${endpoint.name}`;
	return `${endpoint.type}.${endpoint.name}`;
}

function addDirtyArtifact(graph: MutableGraph, file: InventoryFile): void {
	const dirtyId = `dirty:${file.path}`;
	addNode(graph, {
		id: dirtyId,
		kind: "DirtyArtifact",
		label: file.gitStatus,
		path: file.path,
		metadata: { status: file.gitStatus },
		provenance: provenance("git", [{ path: file.path, hash: file.hash }], freshnessFor(file)),
	});
	addEdge(graph, "AFFECTS", dirtyId, fileNodeId(file.path), file.gitStatus);
}

function addGeneratedOwnershipFacts(graph: MutableGraph, files: readonly InventoryFile[]): void {
	const generatedFiles = files.filter((file) => file.kind === "generated");
	if (generatedFiles.length === 0) return;
	addGeneratedEdgesForScripts(graph, generatedFiles);
}

function addGeneratedEdgesForScripts(graph: MutableGraph, generatedFiles: readonly InventoryFile[]): void {
	for (const script of packageScriptNodes(graph)) {
		addGeneratedEdgesForScript(graph, script, generatedFiles);
	}
}

function packageScriptNodes(graph: MutableGraph): CodeGraphNode[] {
	return [...graph.nodes.values()].filter((node) => node.kind === "PackageScript");
}

function addGeneratedEdgesForScript(
	graph: MutableGraph,
	script: CodeGraphNode,
	generatedFiles: readonly InventoryFile[],
): void {
	const command = stringMetadata(script.metadata["command"]);
	if (command === undefined) return;
	for (const file of generatedFiles) addGeneratedEdgeIfMatched(graph, script, command, file);
}

function addGeneratedEdgeIfMatched(
	graph: MutableGraph,
	script: CodeGraphNode,
	command: string,
	file: InventoryFile,
): void {
	if (!scriptGeneratesFile(script.label, command, file.path)) return;
	addEdge(graph, "GENERATED_BY", fileNodeId(file.path), script.id, "generated by");
}

function addTestCoverageEdge(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractImports>[number],
	dependencyId: string,
): void {
	if (!isTestTargetImport(file, fact)) return;
	addEdge(graph, "TESTS", dependencyId, fileNodeId(file.path), "tested by");
}

function addInferredTestCoverageFacts(
	graph: MutableGraph,
	files: readonly InventoryFile[],
	allPaths: ReadonlySet<string>,
): void {
	for (const file of files) addInferredTestCoverageEdges(graph, file, allPaths);
}

function addInferredTestCoverageEdges(graph: MutableGraph, file: InventoryFile, allPaths: ReadonlySet<string>): void {
	for (const sourcePath of inferredTestTargetPaths(file.path, allPaths)) {
		addProvenanceEdge(
			graph,
			"TESTS",
			fileNodeId(sourcePath),
			fileNodeId(file.path),
			"tested by naming convention",
			provenance("filesystem", [{ path: sourcePath }, { path: file.path }]),
		);
	}
}

function inferredTestTargetPaths(testPath: string, allPaths: ReadonlySet<string>): readonly string[] {
	const targetPath = testTargetPath(testPath);
	if (targetPath === undefined) return [];
	const candidates = new Set<string>([targetPath]);
	for (const candidate of testTargetPathsFromTestsDirectory(testPath)) candidates.add(candidate);
	return [...candidates].filter((candidate) => allPaths.has(candidate) && !isTestFile(candidate));
}

function testTargetPath(testPath: string): string | undefined {
	const match = testPath.match(/^(.*)\.(test|spec)(\.[cm]?[jt]sx?)$/);
	if (match === null) return undefined;
	const [, stem, , extension] = match;
	return stem === undefined || extension === undefined ? undefined : `${stem}${extension}`;
}

function testTargetPathsFromTestsDirectory(testPath: string): readonly string[] {
	const marker = "/__tests__/";
	const markerIndex = testPath.indexOf(marker);
	if (markerIndex < 0) return [];
	const baseDir = testPath.slice(0, markerIndex);
	const relativeTestPath = testPath.slice(markerIndex + marker.length);
	const relativeTargetPath = testTargetPath(relativeTestPath);
	if (relativeTargetPath === undefined) return [];
	return pathizedTestTargetPaths(relativeTargetPath).map((candidate) => `${baseDir}/${candidate}`);
}

function pathizedTestTargetPaths(relativeTargetPath: string): readonly string[] {
	const parts = testTargetPathParts(relativeTargetPath);
	if (parts === undefined) return [relativeTargetPath];
	const placement = pathVariantPlacement(parts.pathWithoutExtension);
	return [
		relativeTargetPath,
		...hyphenPathVariants(placement.stem).map((variant) => `${placement.prefix}${variant}${parts.extension}`),
	];
}

function testTargetPathParts(
	relativeTargetPath: string,
): { readonly pathWithoutExtension: string; readonly extension: string } | undefined {
	const extensionMatch = relativeTargetPath.match(/^(.+?)(\.[cm]?[jt]sx?)$/);
	if (extensionMatch === null) return undefined;
	const [, pathWithoutExtension, extension] = extensionMatch;
	return pathWithoutExtension === undefined || extension === undefined
		? undefined
		: { pathWithoutExtension, extension };
}

function pathVariantPlacement(pathWithoutExtension: string): { readonly prefix: string; readonly stem: string } {
	const directory = parentDirectory(pathWithoutExtension);
	const stem = pathWithoutExtension.slice(directory === "." ? 0 : directory.length + 1);
	const prefix = directory === "." ? "" : `${directory}/`;
	return { prefix, stem };
}

function hyphenPathVariants(stem: string): readonly string[] {
	const parts = stem.split("-").filter((part) => part.length > 0);
	if (parts.length < 2) return [];
	return partitionHyphenParts(parts).map((groups) => groups.map((group) => group.join("-")).join("/"));
}

function partitionHyphenParts(parts: readonly string[]): readonly string[][][] {
	if (parts.length === 0) return [[]];
	const variants: string[][][] = [];
	for (let size = 1; size <= parts.length; size += 1) {
		const head = parts.slice(0, size);
		for (const tail of partitionHyphenParts(parts.slice(size))) variants.push([head, ...tail]);
	}
	return variants;
}

function isTestTargetImport(file: InventoryFile, fact: ReturnType<typeof extractImports>[number]): boolean {
	if (!isTestFile(file.path)) return false;
	if (fact.targetPath === undefined) return false;
	return !isTestFile(fact.targetPath);
}

function scriptGeneratesFile(scriptName: string, command: string, path: string): boolean {
	const normalizedCommand = command.split("\\").join("/");
	if (normalizedCommand.includes(path)) return true;
	return generationScriptName(scriptName) && normalizedCommand.includes(basename(path));
}

function generationScriptName(scriptName: string): boolean {
	return /(^|[:_-])(gen|generate|codegen|types)([:_-]|$)|build:types|db:types/i.test(scriptName);
}

function stringMetadata(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isTestFile(path: string): boolean {
	return path.includes("/__tests__/") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.startsWith("e2e/tests/");
}

function manifestFor(
	root: string,
	now: Date,
	git: GitInventory,
	graph: MutableGraph,
	files: readonly InventoryFile[],
): CodeGraphManifest {
	const packageCount = [...graph.nodes.values()].filter((node) => node.kind === "Package").length;
	return {
		schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
		root,
		generatedAt: now.toISOString(),
		scanner: { name: "cartographer", version: SCANNER_VERSION },
		git: {
			...(git.commit !== undefined ? { commit: git.commit } : {}),
			dirty: git.dirty,
			trackedFiles: git.trackedFiles,
			untrackedFiles: git.untrackedFiles,
			modifiedFiles: git.modifiedFiles,
			deletedFiles: git.deletedFiles,
		},
		totals: {
			files: files.length,
			packages: packageCount,
			nodes: graph.nodes.size,
			edges: graph.edges.size,
			findings: graph.findings.length,
		},
		ignorePatterns: defaultIgnorePatterns(),
	};
}
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/extractors.ts" language="ts">
<![CDATA[
import { dirname, extname, join, normalize } from "node:path";
import { uniqueBy } from "./collections.ts";
import type { InventoryFile } from "./inventory.ts";
import { normalizePath } from "./path-utils.ts";

export interface ImportFact {
	readonly specifier: string;
	readonly targetPath?: string | undefined;
	readonly externalPackage?: string | undefined;
	readonly typeOnly: boolean;
}

export interface SymbolFact {
	readonly name: string;
	readonly kind: "function" | "class" | "interface" | "type" | "const";
	readonly line: number;
	readonly exported: boolean;
}

export interface EnvVarFact {
	readonly name: string;
	readonly line: number;
}

export interface SqlFact {
	readonly kind: "table" | "function" | "policy" | "trigger";
	readonly action: "creates" | "alters" | "drops";
	readonly name: string;
	readonly line: number;
}

export interface DocReferenceFact {
	readonly targetPath: string;
	readonly label: string;
	readonly line: number;
}

export interface SqlReferenceFact {
	readonly fromTable: string;
	readonly toTable: string;
	readonly line: number;
}

export interface IacFact {
	readonly kind: "resource" | "module";
	readonly type: string;
	readonly name: string;
	readonly line: number;
}

export interface IacDependencyFact {
	readonly from: IacDependencyEndpoint;
	readonly to: IacDependencyEndpoint;
	readonly line: number;
}

export interface IacDependencyEndpoint {
	readonly kind: "resource" | "module";
	readonly type: string;
	readonly name: string;
}

export interface DataAccessFact {
	readonly kind: "table" | "rpc";
	readonly name: string;
	readonly line: number;
}

export interface WorkflowFact {
	readonly kind: "workflow" | "job" | "run";
	readonly workflowName: string;
	readonly name: string;
	readonly taskKind: "validation" | "deployment" | "other";
	readonly line: number;
	readonly jobId?: string | undefined;
	readonly stepIndex?: number | undefined;
	readonly command?: string | undefined;
}

const symbolPatterns: Array<{ readonly kind: SymbolFact["kind"]; readonly regex: RegExp }> = [
	{ kind: "function", regex: /\b(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
	{ kind: "class", regex: /\b(export\s+)?class\s+([A-Za-z_$][\w$]*)/g },
	{ kind: "interface", regex: /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g },
	{ kind: "type", regex: /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g },
	{ kind: "const", regex: /\bexport\s+const\s+([A-Za-z_$][\w$]*)/g },
];

const envPatterns = [
	/\b(?:process|Bun)\.env\.([A-Z][A-Z0-9_]*)/g,
	/\b(?:process|Bun)\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
	/\bDeno\.env\.get\(['"]([A-Z][A-Z0-9_]*)['"]\)/g,
	/\$\{\{\s*(?:secrets|vars)\.([A-Z][A-Z0-9_]*)\s*\}\}/g,
];

export async function readText(file: InventoryFile): Promise<string | undefined> {
	if (!file.readableText) return undefined;
	return Bun.file(file.absolutePath).text();
}

export function extractImports(
	file: InventoryFile,
	text: string,
	allPaths: ReadonlySet<string>,
): readonly ImportFact[] {
	const ext = extname(file.path).toLowerCase();
	if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].includes(ext)) {
		return extractEcmaImports(file.path, text, allPaths);
	}
	if (ext === ".py") return extractPythonImports(text);
	return [];
}

export function extractSymbols(file: InventoryFile, text: string): readonly SymbolFact[] {
	const ext = extname(file.path).toLowerCase();
	if (![".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].includes(ext)) return [];
	return symbolPatterns.flatMap((pattern) =>
		[...text.matchAll(pattern.regex)].flatMap((match) => symbolFact(text, pattern, match)),
	);
}

export function extractEnvVars(text: string): readonly EnvVarFact[] {
	const facts = envPatterns.flatMap((pattern) => [...text.matchAll(pattern)].flatMap((match) => envFact(text, match)));
	return uniqueBy(facts, (fact) => fact.name);
}

export function extractSqlFacts(file: InventoryFile, text: string): readonly SqlFact[] {
	if (!file.path.endsWith(".sql")) return [];
	const patterns: Array<{
		readonly kind: SqlFact["kind"];
		readonly action: SqlFact["action"];
		readonly regex: RegExp;
	}> = [
		{ kind: "table", action: "creates", regex: /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?([\w.]+)"?/gi },
		{ kind: "table", action: "alters", regex: /\balter\s+table\s+"?([\w.]+)"?/gi },
		{ kind: "table", action: "drops", regex: /\bdrop\s+table\s+(?:if\s+exists\s+)?"?([\w.]+)"?/gi },
		{ kind: "function", action: "creates", regex: /\bcreate\s+(?:or\s+replace\s+)?function\s+"?([\w.]+)"?/gi },
		{ kind: "policy", action: "creates", regex: /\bcreate\s+policy\s+"?([\w.]+)"?/gi },
		{ kind: "trigger", action: "creates", regex: /\bcreate\s+trigger\s+"?([\w.]+)"?/gi },
	];
	return patterns.flatMap((pattern) =>
		[...text.matchAll(pattern.regex)].flatMap((match) => {
			const name = match[1];
			if (name === undefined) return [];
			return [{ kind: pattern.kind, action: pattern.action, name, line: lineForIndex(text, match.index ?? 0) }];
		}),
	);
}

export function extractSqlReferenceFacts(file: InventoryFile, text: string): readonly SqlReferenceFact[] {
	if (!file.path.endsWith(".sql")) return [];
	return uniqueBy([...extractCreateTableReferences(text), ...extractAlterTableReferences(text)], sqlReferenceKey);
}

export function extractDocReferenceFacts(
	file: InventoryFile,
	text: string,
	allPaths: ReadonlySet<string>,
): readonly DocReferenceFact[] {
	if (!file.path.endsWith(".md")) return [];
	const linkFacts = [...text.matchAll(/\[[^\]]+\]\(([^)#?]+)(?:[#?][^)]+)?\)/g)].flatMap((match) =>
		docReferenceFact(file.path, text, match, match[1], allPaths),
	);
	const codeFacts = [...text.matchAll(/`((?:src|apps|packages|infra|supabase|\.github)\/[^`\s]+)`/g)].flatMap((match) =>
		docReferenceFact(file.path, text, match, match[1], allPaths),
	);
	return uniqueBy([...linkFacts, ...codeFacts], (fact) => `${fact.targetPath}:${fact.line}`);
}

export function extractIacFacts(file: InventoryFile, text: string): readonly IacFact[] {
	if (!file.path.endsWith(".tf")) return [];
	return [...extractTerraformResources(text), ...extractTerraformModules(text)];
}

export function extractIacDependencyFacts(file: InventoryFile, text: string): readonly IacDependencyFact[] {
	if (!file.path.endsWith(".tf")) return [];
	return uniqueBy(
		terraformBlocks(text).flatMap((block) => terraformDependencyFactsForBlock(text, block)),
		iacDependencyKey,
	);
}

export function extractDataAccessFacts(file: InventoryFile, text: string): readonly DataAccessFact[] {
	const ext = extname(file.path).toLowerCase();
	if (![".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"].includes(ext)) return [];
	const patterns: Array<{ readonly kind: DataAccessFact["kind"]; readonly regex: RegExp }> = [
		{ kind: "table", regex: /\.\s*from\s*(?:<[^>]+>)?\s*\(\s*['"]([^'"]+)['"]/g },
		{ kind: "rpc", regex: /\.\s*rpc\s*(?:<[^>]+>)?\s*\(\s*['"]([^'"]+)['"]/g },
	];
	const facts = patterns.flatMap((pattern) =>
		[...text.matchAll(pattern.regex)].flatMap((match) => dataAccessFact(text, pattern.kind, match)),
	);
	return uniqueBy(facts, (fact) => `${fact.kind}:${fact.name}:${fact.line}`);
}

export function extractWorkflowFacts(file: InventoryFile, text: string): readonly WorkflowFact[] {
	if (!isGithubWorkflowPath(file.path)) return [];
	const lines = text.split(/\r?\n/);
	const workflowName = workflowNameFor(file.path, lines);
	const facts: WorkflowFact[] = [
		{
			kind: "workflow",
			workflowName,
			name: workflowName,
			taskKind: workflowTaskKind(workflowName),
			line: workflowNameLine(lines) ?? 1,
		},
	];
	for (const job of workflowJobs(lines)) {
		facts.push({
			kind: "job",
			workflowName,
			jobId: job.id,
			name: job.name ?? job.id,
			taskKind: workflowTaskKind([job.id, job.name, ...job.commands].filter(isString).join(" ")),
			line: job.line,
		});
		for (const [index, step] of job.steps.entries()) {
			facts.push({
				kind: "run",
				workflowName,
				jobId: job.id,
				stepIndex: index + 1,
				name: step.name ?? `${job.id} run ${index + 1}`,
				taskKind: workflowTaskKind([step.name, step.command, job.id].filter(isString).join(" ")),
				command: step.command,
				line: step.line,
			});
		}
	}
	return facts;
}

function extractEcmaImports(path: string, text: string, allPaths: ReadonlySet<string>): readonly ImportFact[] {
	const facts: ImportFact[] = [];
	const patterns: Array<{ readonly regex: RegExp; readonly typeOnly: boolean }> = [
		{ regex: /\bimport\s+type\s+[^'"]*from\s+['"]([^'"]+)['"]/g, typeOnly: true },
		{ regex: /\bimport\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/g, typeOnly: false },
		{ regex: /\bexport\s+type\s+[^'"]*from\s+['"]([^'"]+)['"]/g, typeOnly: true },
		{ regex: /\bexport\s+(?!type\b)[^'"]*from\s+['"]([^'"]+)['"]/g, typeOnly: false },
		{ regex: /\brequire\(['"]([^'"]+)['"]\)/g, typeOnly: false },
		{ regex: /\bimport\(['"]([^'"]+)['"]\)/g, typeOnly: false },
	];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern.regex)) {
			const specifier = match[1];
			if (specifier === undefined) continue;
			facts.push(importFact(path, specifier, pattern.typeOnly, allPaths));
		}
	}
	return dedupeImports(facts);
}

function docReferenceFact(
	path: string,
	text: string,
	match: RegExpMatchArray,
	rawTarget: string | undefined,
	allPaths: ReadonlySet<string>,
): readonly DocReferenceFact[] {
	const targetPath = docReferenceTargetPath(path, rawTarget, allPaths);
	if (targetPath === undefined) return [];
	return [
		{
			targetPath,
			label: rawTarget ?? targetPath,
			line: lineForIndex(text, match.index ?? 0),
		},
	];
}

function docReferenceTargetPath(
	path: string,
	rawTarget: string | undefined,
	allPaths: ReadonlySet<string>,
): string | undefined {
	if (rawTarget === undefined) return undefined;
	if (/^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) return undefined;
	const normalized = normalizePath(normalize(rawTarget.startsWith("/") ? rawTarget.slice(1) : join(dirname(path), rawTarget)));
	const rootRelative = normalizePath(rawTarget.replace(/^\.\//, "").replace(/^\//, ""));
	return [normalized, rootRelative].find((candidate) => allPaths.has(candidate));
}

function extractPythonImports(text: string): readonly ImportFact[] {
	const facts: ImportFact[] = [];
	for (const match of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
		const specifier = match[1] ?? match[2];
		if (specifier !== undefined) {
			facts.push({ specifier, externalPackage: specifier.split(".")[0], typeOnly: false });
		}
	}
	return dedupeImports(facts);
}

function importFact(path: string, specifier: string, typeOnly: boolean, allPaths: ReadonlySet<string>): ImportFact {
	if (specifier.startsWith(".")) {
		const targetPath = resolveRelativeImport(path, specifier, allPaths);
		return { specifier, ...(targetPath !== undefined ? { targetPath } : {}), typeOnly };
	}
	return { specifier, externalPackage: packageName(specifier), typeOnly };
}

function resolveRelativeImport(path: string, specifier: string, allPaths: ReadonlySet<string>): string | undefined {
	const base = normalizePath(normalize(join(dirname(path), specifier)));
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		`${base}.js`,
		`${base}.jsx`,
		`${base}.json`,
		`${base}.sql`,
		`${base}/index.ts`,
		`${base}/index.tsx`,
		`${base}/index.js`,
		`${base}/index.jsx`,
	];
	return candidates.find((candidate) => allPaths.has(candidate));
}

function packageName(specifier: string): string {
	if (specifier.startsWith("@")) {
		const [scope, name] = specifier.split("/");
		return name === undefined ? specifier : `${scope}/${name}`;
	}
	return specifier.split("/")[0] ?? specifier;
}

function dedupeImports(facts: readonly ImportFact[]): readonly ImportFact[] {
	return uniqueBy(facts, importKey);
}

function lineForIndex(text: string, index: number): number {
	return text.slice(0, index).split(/\r?\n/).length;
}

function symbolFact(
	text: string,
	pattern: { readonly kind: SymbolFact["kind"] },
	match: RegExpMatchArray,
): readonly SymbolFact[] {
	const name = match[2] ?? match[1];
	if (name === undefined) return [];
	return [
		{ name, kind: pattern.kind, line: lineForIndex(text, match.index ?? 0), exported: match[0].includes("export") },
	];
}

function envFact(text: string, match: RegExpMatchArray): readonly EnvVarFact[] {
	const name = match[1];
	return name === undefined ? [] : [{ name, line: lineForIndex(text, match.index ?? 0) }];
}

function extractCreateTableReferences(text: string): readonly SqlReferenceFact[] {
	const createTablePattern = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?([\w.]+)"?\s*\(([\s\S]*?)\);/gi;
	return extractTableReferenceMatches(text, createTablePattern);
}

function extractAlterTableReferences(text: string): readonly SqlReferenceFact[] {
	const alterTablePattern = /\balter\s+table\s+"?([\w.]+)"?([\s\S]*?);/gi;
	return extractTableReferenceMatches(text, alterTablePattern);
}

function extractTableReferenceMatches(text: string, pattern: RegExp): readonly SqlReferenceFact[] {
	return [...text.matchAll(pattern)].flatMap((match) => sqlReferencesForTableMatch(text, match));
}

function sqlReferencesForTableMatch(text: string, match: RegExpMatchArray): readonly SqlReferenceFact[] {
	const fromTable = match[1];
	const body = match[2];
	if (fromTable === undefined) return [];
	if (body === undefined) return [];
	return sqlReferencesInStatement(text, match.index ?? 0, body, fromTable);
}

function sqlReferencesInStatement(
	text: string,
	statementIndex: number,
	statement: string,
	fromTable: string,
): readonly SqlReferenceFact[] {
	return [...statement.matchAll(/\breferences\s+"?([\w.]+)"?/gi)].flatMap((match) => {
		const toTable = match[1];
		if (toTable === undefined || toTable === fromTable) return [];
		return [{ fromTable, toTable, line: lineForIndex(text, statementIndex + (match.index ?? 0)) }];
	});
}

function dataAccessFact(
	text: string,
	kind: DataAccessFact["kind"],
	match: RegExpMatchArray,
): readonly DataAccessFact[] {
	const name = usableDataAccessName(text, kind, match);
	if (name === undefined) return [];
	return [{ kind, name, line: lineForIndex(text, match.index ?? 0) }];
}

function usableDataAccessName(text: string, kind: DataAccessFact["kind"], match: RegExpMatchArray): string | undefined {
	const name = match[1];
	if (name === undefined) return undefined;
	if (shouldSkipDataAccessCall(text, kind, match.index ?? 0)) return undefined;
	return name;
}

function shouldSkipDataAccessCall(text: string, kind: DataAccessFact["kind"], dotIndex: number): boolean {
	if (kind !== "table") return false;
	return isBuiltInFromCall(text, dotIndex);
}

function isBuiltInFromCall(text: string, dotIndex: number): boolean {
	const receiver = receiverBeforeDot(text, dotIndex);
	return builtInFromReceivers.has(receiver);
}

function receiverBeforeDot(text: string, dotIndex: number): string {
	const beforeDot = text.slice(0, dotIndex).trimEnd();
	return beforeDot.match(/([A-Za-z_$][\w$]*)$/)?.[1] ?? "";
}

const builtInFromReceivers = new Set([
	"Array",
	"Buffer",
	"Uint8Array",
	"Uint16Array",
	"Uint32Array",
	"Int8Array",
	"Int16Array",
	"Int32Array",
	"Float32Array",
	"Float64Array",
	"BigInt64Array",
	"BigUint64Array",
]);

function isGithubWorkflowPath(path: string): boolean {
	return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path);
}

function workflowNameFor(path: string, lines: readonly string[]): string {
	const explicit = workflowNameFromLines(lines);
	return explicit ?? path.split("/").at(-1)?.replace(/\.ya?ml$/i, "") ?? path;
}

function workflowNameFromLines(lines: readonly string[]): string | undefined {
	for (const line of lines) {
		const match = line.match(/^name:\s*(.+?)\s*$/);
		if (match?.[1] !== undefined) return cleanYamlScalar(match[1]);
	}
	return undefined;
}

function workflowNameLine(lines: readonly string[]): number | undefined {
	const index = lines.findIndex((line) => /^name:\s*.+?\s*$/.test(line));
	return index >= 0 ? index + 1 : undefined;
}

interface WorkflowJob {
	readonly id: string;
	readonly line: number;
	readonly name?: string | undefined;
	readonly steps: readonly WorkflowRunStep[];
	readonly commands: readonly string[];
}

interface WorkflowRunStep {
	readonly name?: string | undefined;
	readonly command: string;
	readonly line: number;
}

function workflowJobs(lines: readonly string[]): readonly WorkflowJob[] {
	const jobsStartIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
	if (jobsStartIndex < 0) return [];
	const jobs: WorkflowJob[] = [];
	let current: MutableWorkflowJob | undefined;
	for (let index = jobsStartIndex + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (isTopLevelYamlKey(line)) break;
		const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
		if (jobMatch?.[1] !== undefined) {
			if (current !== undefined) jobs.push(workflowJobFromMutable(current));
			current = { id: jobMatch[1], line: index + 1, steps: [], commands: [] };
			continue;
		}
		if (current === undefined) continue;
		const jobName = line.match(/^    name:\s*(.+?)\s*$/)?.[1];
		if (jobName !== undefined) current.name = cleanYamlScalar(jobName);
		const stepName = nearbyWorkflowStepName(lines, index);
		const run = workflowRunCommand(lines, index);
		if (run !== undefined) {
			current.steps.push({ name: stepName, command: run.command, line: index + 1 });
			current.commands.push(run.command);
		}
	}
	if (current !== undefined) jobs.push(workflowJobFromMutable(current));
	return jobs;
}

interface MutableWorkflowJob {
	readonly id: string;
	readonly line: number;
	name?: string | undefined;
	readonly steps: WorkflowRunStep[];
	readonly commands: string[];
}

function workflowJobFromMutable(job: MutableWorkflowJob): WorkflowJob {
	return {
		id: job.id,
		line: job.line,
		...(job.name === undefined ? {} : { name: job.name }),
		steps: job.steps,
		commands: job.commands,
	};
}

function isTopLevelYamlKey(line: string): boolean {
	return /^[A-Za-z_][\w-]*:\s*/.test(line) && !/^jobs:\s*$/.test(line);
}

function nearbyWorkflowStepName(lines: readonly string[], runLineIndex: number): string | undefined {
	for (let index = runLineIndex - 1; index >= Math.max(0, runLineIndex - 5); index -= 1) {
		const line = lines[index] ?? "";
		const listName = line.match(/^\s*-\s+name:\s*(.+?)\s*$/)?.[1];
		if (listName !== undefined) return cleanYamlScalar(listName);
		const plainName = line.match(/^\s+name:\s*(.+?)\s*$/)?.[1];
		if (plainName !== undefined) return cleanYamlScalar(plainName);
		if (/^\s*-\s+(uses|run):/.test(line)) return undefined;
	}
	return undefined;
}

function workflowRunCommand(
	lines: readonly string[],
	lineIndex: number,
): { readonly command: string } | undefined {
	const line = lines[lineIndex] ?? "";
	const match = line.match(/^(\s*)-?\s*run:\s*(.*?)\s*$/);
	if (match === null) return undefined;
	const indent = match[1]?.length ?? 0;
	const rest = match[2] ?? "";
	if (rest === "|" || rest === ">" || rest.length === 0) {
		const block = workflowRunBlock(lines, lineIndex + 1, indent);
		return block.length === 0 ? undefined : { command: block.join("\n") };
	}
	return { command: cleanYamlScalar(rest) };
}

function workflowRunBlock(lines: readonly string[], startIndex: number, parentIndent: number): readonly string[] {
	const block: string[] = [];
	for (let index = startIndex; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line.trim().length === 0) {
			if (block.length > 0) block.push("");
			continue;
		}
		const indent = leadingSpaceCount(line);
		if (indent <= parentIndent) break;
		block.push(line.slice(parentIndent + 2).trimEnd());
	}
	return block;
}

function leadingSpaceCount(line: string): number {
	return line.length - line.trimStart().length;
}

function workflowTaskKind(text: string): WorkflowFact["taskKind"] {
	const lowered = text.toLowerCase();
	if (/\b(deploy|deployment|release|publish|docker\s+push|terraform\s+apply|supabase\s+db\s+push|vercel|fly\s+deploy|doctl)\b/.test(lowered)) {
		return "deployment";
	}
	if (/\b(test|typecheck|lint|check|verify|validate|build|ci|coverage|tsc|eslint|biome)\b/.test(lowered)) {
		return "validation";
	}
	return "other";
}

function cleanYamlScalar(value: string): string {
	const trimmed = value.trim().replace(/\s+#.*$/, "");
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
	return trimmed;
}

function isString(value: string | undefined): value is string {
	return value !== undefined && value.length > 0;
}

function extractTerraformResources(text: string): readonly IacFact[] {
	return terraformBlocks(text)
		.filter((block) => block.kind === "resource")
		.map((block) => ({ kind: block.kind, type: block.type, name: block.name, line: block.line }));
}

function extractTerraformModules(text: string): readonly IacFact[] {
	return terraformBlocks(text)
		.filter((block) => block.kind === "module")
		.map((block) => ({ kind: block.kind, type: block.type, name: block.name, line: block.line }));
}

function importKey(fact: ImportFact): string {
	return `${fact.specifier}:${fact.targetPath ?? fact.externalPackage ?? ""}:${fact.typeOnly}`;
}

function sqlReferenceKey(fact: SqlReferenceFact): string {
	return `${fact.fromTable}:${fact.toTable}:${fact.line}`;
}

interface TerraformBlock extends IacDependencyEndpoint {
	readonly line: number;
	readonly body: string;
	readonly bodyStartIndex: number;
}

interface TerraformReference extends IacDependencyEndpoint {
	readonly line: number;
}

function terraformBlocks(text: string): readonly TerraformBlock[] {
	return [...terraformResourceBlocks(text), ...terraformModuleBlocks(text)];
}

function terraformResourceBlocks(text: string): readonly TerraformBlock[] {
	return [...text.matchAll(/\bresource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g)].flatMap((match) => {
		const type = match[1];
		const name = match[2];
		if (type === undefined || name === undefined) return [];
		return terraformBlockForMatch(text, match, { kind: "resource", type, name });
	});
}

function terraformModuleBlocks(text: string): readonly TerraformBlock[] {
	return [...text.matchAll(/\bmodule\s+"([^"]+)"\s*\{/g)].flatMap((match) => {
		const name = match[1];
		if (name === undefined) return [];
		return terraformBlockForMatch(text, match, { kind: "module", type: "module", name });
	});
}

function terraformBlockForMatch(
	text: string,
	match: RegExpMatchArray,
	endpoint: IacDependencyEndpoint,
): readonly TerraformBlock[] {
	const matchIndex = match.index ?? 0;
	const body = terraformBlockBody(text, matchIndex);
	if (body === undefined) return [];
	return [
		{
			...endpoint,
			line: lineForIndex(text, matchIndex),
			body: body.text,
			bodyStartIndex: body.startIndex,
		},
	];
}

function terraformBlockBody(
	text: string,
	searchStartIndex: number,
): { readonly text: string; readonly startIndex: number } | undefined {
	const openBraceIndex = text.indexOf("{", searchStartIndex);
	if (openBraceIndex === -1) return undefined;
	const closeBraceIndex = matchingBraceIndex(text, openBraceIndex);
	if (closeBraceIndex === undefined) return undefined;
	const startIndex = openBraceIndex + 1;
	return { text: text.slice(startIndex, closeBraceIndex), startIndex };
}

function matchingBraceIndex(text: string, openBraceIndex: number): number | undefined {
	let depth = 0;
	for (let index = openBraceIndex; index < text.length; index += 1) {
		const char = text[index];
		depth += terraformBraceDelta(char);
		if (closesTerraformBlock(char, depth)) return index;
	}
	return undefined;
}

function terraformBraceDelta(char: string | undefined): number {
	if (char === "{") return 1;
	if (char === "}") return -1;
	return 0;
}

function closesTerraformBlock(char: string | undefined, depth: number): boolean {
	return char === "}" && depth === 0;
}

function terraformDependencyFactsForBlock(text: string, block: TerraformBlock): readonly IacDependencyFact[] {
	return terraformReferencesInBlock(text, block).flatMap((reference) => {
		if (sameIacEndpoint(block, reference)) return [];
		return [{ from: iacEndpoint(block), to: iacEndpoint(reference), line: reference.line }];
	});
}

function terraformReferencesInBlock(text: string, block: TerraformBlock): readonly TerraformReference[] {
	const references: TerraformReference[] = [];
	let offset = 0;
	for (const line of block.body.split(/\r?\n/)) {
		const lineStartIndex = block.bodyStartIndex + offset;
		references.push(...terraformReferencesInLine(text, line, lineStartIndex));
		offset += line.length + 1;
	}
	return uniqueBy(references, (reference) => `${reference.kind}:${reference.type}:${reference.name}:${reference.line}`);
}

function terraformReferencesInLine(text: string, line: string, lineStartIndex: number): readonly TerraformReference[] {
	return [
		...terraformInterpolationReferences(text, line, lineStartIndex),
		...terraformExpressionReferences(text, line, lineStartIndex),
	];
}

function terraformInterpolationReferences(
	text: string,
	line: string,
	lineStartIndex: number,
): readonly TerraformReference[] {
	return [...line.matchAll(/\$\{([^}]+)\}/g)].flatMap((match) => {
		const expression = match[1];
		if (expression === undefined) return [];
		return terraformReferencesInExpression(text, expression, lineStartIndex + (match.index ?? 0));
	});
}

function terraformExpressionReferences(
	text: string,
	line: string,
	lineStartIndex: number,
): readonly TerraformReference[] {
	const expression = stripTerraformLineComment(stripQuotedStrings(line));
	return terraformReferencesInExpression(text, expression, lineStartIndex);
}

function terraformReferencesInExpression(
	text: string,
	expression: string,
	expressionStartIndex: number,
): readonly TerraformReference[] {
	return [
		...terraformModuleReferences(text, expression, expressionStartIndex),
		...terraformResourceReferences(text, expression, expressionStartIndex),
	];
}

function terraformModuleReferences(
	text: string,
	expression: string,
	expressionStartIndex: number,
): readonly TerraformReference[] {
	return [...expression.matchAll(/\bmodule\.([A-Za-z0-9_-]+)\b/g)].flatMap((match) => {
		const name = match[1];
		if (name === undefined) return [];
		return [
			{
				kind: "module",
				type: "module",
				name,
				line: lineForIndex(text, expressionStartIndex + (match.index ?? 0)),
			},
		];
	});
}

function terraformResourceReferences(
	text: string,
	expression: string,
	expressionStartIndex: number,
): readonly TerraformReference[] {
	return [...expression.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z0-9_-]+)\b/g)].flatMap((match) => {
		return terraformResourceReferenceForMatch(text, match, expressionStartIndex);
	});
}

function terraformResourceReferenceForMatch(
	text: string,
	match: RegExpMatchArray,
	expressionStartIndex: number,
): readonly TerraformReference[] {
	const endpoint = terraformResourceEndpointForMatch(match);
	if (endpoint === undefined) return [];
	return [
		{
			...endpoint,
			line: lineForIndex(text, expressionStartIndex + (match.index ?? 0)),
		},
	];
}

function terraformResourceEndpointForMatch(match: RegExpMatchArray): IacDependencyEndpoint | undefined {
	const type = match[1];
	const name = match[2];
	if (type === undefined || name === undefined) return undefined;
	if (reservedTerraformReferenceRoots.has(type)) return undefined;
	return { kind: "resource", type, name };
}

const reservedTerraformReferenceRoots = new Set([
	"count",
	"data",
	"each",
	"local",
	"module",
	"path",
	"self",
	"terraform",
	"var",
]);

function stripQuotedStrings(line: string): string {
	return line.replace(/"([^"\\]|\\.)*"/g, "").replace(/'([^'\\]|\\.)*'/g, "");
}

function stripTerraformLineComment(line: string): string {
	return line.replace(/\s*(?:#|\/\/).*$/, "");
}

function sameIacEndpoint(left: IacDependencyEndpoint, right: IacDependencyEndpoint): boolean {
	return left.kind === right.kind && left.type === right.type && left.name === right.name;
}

function iacEndpoint(endpoint: IacDependencyEndpoint): IacDependencyEndpoint {
	return { kind: endpoint.kind, type: endpoint.type, name: endpoint.name };
}

function iacDependencyKey(fact: IacDependencyFact): string {
	return `${fact.from.kind}:${fact.from.type}:${fact.from.name}->${fact.to.kind}:${fact.to.type}:${fact.to.name}:${fact.line}`;
}
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/query.ts" language="ts">
<![CDATA[
import { countBy } from "./collections.ts";
import type {
	AffectedPackageSummary,
	AgentAnnotation,
	AnnotationNoteSummary,
	CodeGraphEdge,
	CodeGraphNode,
	CodeGraphSnapshot,
	GraphSlice,
	GraphSliceSummary,
	ValidationCommandSummary,
} from "./types.ts";

export interface ImpactGraphOptions {
	readonly maxDepth?: number | undefined;
}

export function summarizeGraph(graph: CodeGraphSnapshot): string {
	const byKind = countBy(graph.nodes, (node) => node.kind);
	const edgeKinds = countBy(graph.edges, (edge) => edge.kind);
	return [
		`Code graph: ${graph.manifest.root}`,
		`Generated: ${graph.manifest.generatedAt}`,
		`Git: ${graph.manifest.git.dirty ? "dirty" : "clean"}${graph.manifest.git.commit ? ` @ ${graph.manifest.git.commit.slice(0, 12)}` : ""}`,
		`Totals: ${graph.manifest.totals.files} files, ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.findings.length} findings`,
		"",
		"Node kinds:",
		...Object.entries(byKind).map(([kind, count]) => `  ${kind}: ${count}`),
		"",
		"Edge kinds:",
		...Object.entries(edgeKinds).map(([kind, count]) => `  ${kind}: ${count}`),
		"",
	].join("\n");
}

export function sliceGraph(graph: CodeGraphSnapshot, selector: string): GraphSlice {
	const selected = selectNodes(graph, selector);
	const selectedIds = new Set(selected.map((node) => node.id));
	const nodeIds = new Set(selectedIds);
	for (const edge of graph.edges) {
		if (selectedIds.has(edge.from) || selectedIds.has(edge.to)) {
			nodeIds.add(edge.from);
			nodeIds.add(edge.to);
		}
	}
	const relatedNodeIds = new Set(nodeIds);
	addPackageContext(graph, nodeIds);
	const nodes = graph.nodes.filter((node) => nodeIds.has(node.id));
	return {
		selector,
		title: `Slice for ${selector}`,
		nodes,
		summary: summarizeSliceContext(graph, nodeIds, relatedNodeIds, selectedIds),
		...sliceRelatedGraph(graph, nodeIds),
	};
}

export function impactGraph(graph: CodeGraphSnapshot, path: string, options: ImpactGraphOptions = {}): GraphSlice {
	const normalized = impactTargetFor(path);
	const target = graph.nodes.find(
		(node) => node.id === normalized || node.path === normalized || node.id === `file:${normalized}`,
	);
	if (target === undefined) return emptyImpactSlice(path);
	const nodeIds = expandedImpactNodeIds(graph, target.id, options.maxDepth);
	const relatedNodeIds = new Set(nodeIds);
	addPackageContext(graph, nodeIds);
	return {
		selector: `impact:${path}`,
		title: `Impact for ${path}`,
		nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
		summary: summarizeSliceContext(graph, nodeIds, relatedNodeIds, new Set([target.id])),
		...sliceRelatedGraph(graph, nodeIds),
	};
}

function impactTargetFor(path: string): string {
	const normalized = path.replace(/^\.\//, "");
	return normalized.startsWith("path:") ? normalized.slice("path:".length) : normalized;
}

function emptyImpactSlice(path: string): GraphSlice {
	return {
		selector: `impact:${path}`,
		title: `Impact for ${path}`,
		nodes: [],
		edges: [],
		findings: [],
		annotations: [],
		summary: emptySliceSummary(),
	};
}

function expandedImpactNodeIds(graph: CodeGraphSnapshot, targetId: string, maxDepth: number | undefined): Set<string> {
	const nodeIds = new Set<string>([targetId]);
	let frontier = new Set<string>([targetId]);
	let depth = 0;
	while (withinImpactDepth(depth, maxDepth) && frontier.size > 0) {
		frontier = addImpactPass(graph, nodeIds, frontier);
		depth += 1;
	}
	addTestsForImpactedNodes(graph, nodeIds);
	return nodeIds;
}

function withinImpactDepth(depth: number, maxDepth: number | undefined): boolean {
	return maxDepth === undefined || depth < maxDepth;
}

function addImpactPass(graph: CodeGraphSnapshot, nodeIds: Set<string>, frontier: ReadonlySet<string>): Set<string> {
	const added = new Set<string>();
	for (const edge of graph.edges) addImpactedNode(edge, nodeIds, frontier, added);
	return added;
}

function addTestsForImpactedNodes(graph: CodeGraphSnapshot, nodeIds: Set<string>): void {
	const impactedNodeIds = new Set(nodeIds);
	for (const edge of graph.edges) {
		if (edge.kind === "TESTS" && impactedNodeIds.has(edge.from)) nodeIds.add(edge.to);
	}
}

function addImpactedNode(
	edge: CodeGraphEdge,
	nodeIds: Set<string>,
	frontier: ReadonlySet<string>,
	added: Set<string>,
): void {
	addOptionalNodeId(nodeIds, added, incomingImpactNode(edge, frontier, nodeIds));
	addOptionalNodeId(nodeIds, added, testImpactNode(edge, frontier, nodeIds));
}

function incomingImpactNode(
	edge: CodeGraphEdge,
	frontier: ReadonlySet<string>,
	nodeIds: ReadonlySet<string>,
): string | undefined {
	if (!isIncomingImpact(edge, frontier)) return undefined;
	return missingNodeId(nodeIds, edge.from);
}

function testImpactNode(
	edge: CodeGraphEdge,
	frontier: ReadonlySet<string>,
	nodeIds: ReadonlySet<string>,
): string | undefined {
	if (!isTestImpact(edge, frontier)) return undefined;
	return missingNodeId(nodeIds, edge.to);
}

function isIncomingImpact(edge: CodeGraphEdge, nodeIds: ReadonlySet<string>): boolean {
	return nodeIds.has(edge.to) && impactEdgeKinds.has(edge.kind);
}

function isTestImpact(edge: CodeGraphEdge, nodeIds: ReadonlySet<string>): boolean {
	return nodeIds.has(edge.from) && edge.kind === "TESTS";
}

function missingNodeId(nodeIds: ReadonlySet<string>, nodeId: string): string | undefined {
	return nodeIds.has(nodeId) ? undefined : nodeId;
}

function addOptionalNodeId(nodeIds: Set<string>, added: Set<string>, nodeId: string | undefined): void {
	if (nodeId === undefined) return;
	addNodeId(nodeIds, added, nodeId);
}

function addNodeId(nodeIds: Set<string>, added: Set<string>, nodeId: string): void {
	nodeIds.add(nodeId);
	added.add(nodeId);
}

function addPackageContext(graph: CodeGraphSnapshot, nodeIds: Set<string>): void {
	const context = collectPackageContext(graph, nodeIds);
	for (const packageId of context.packageIds) addPackageScripts(graph, nodeIds, packageId, context);
}

function hasDatabaseContext(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): boolean {
	return graph.nodes.some((node) => nodeIds.has(node.id) && databaseNodeKinds.has(node.kind));
}

interface PackageContext extends PackageScriptContext {
	readonly packageIds: ReadonlySet<string>;
}

interface PackageScriptContext {
	readonly hasDataContext: boolean;
	readonly packageDirs: ReadonlySet<string>;
}

function collectPackageContext(graph: CodeGraphSnapshot, nodeIds: Set<string>): PackageContext {
	const packageIds = new Set<string>();
	const packageDirs = new Set<string>();
	for (const node of selectedGraphNodes(graph, nodeIds)) {
		addOwningPackageContext(packageNodes(graph), node, nodeIds, packageIds, packageDirs);
	}
	return { packageIds, packageDirs, hasDataContext: hasDatabaseContext(graph, nodeIds) };
}

function selectedGraphNodes(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly CodeGraphNode[] {
	return graph.nodes.filter((node) => nodeIds.has(node.id));
}

function packageNodes(graph: CodeGraphSnapshot): readonly CodeGraphNode[] {
	return graph.nodes.filter((node) => node.kind === "Package");
}

function addOwningPackageContext(
	packages: readonly CodeGraphNode[],
	node: CodeGraphNode,
	nodeIds: Set<string>,
	packageIds: Set<string>,
	packageDirs: Set<string>,
): void {
	for (const owner of packageOwnersForPath(packages, node.path)) {
		packageIds.add(owner.id);
		packageDirs.add(packageDirForNode(owner));
		nodeIds.add(owner.id);
	}
}

function addPackageScripts(
	graph: CodeGraphSnapshot,
	nodeIds: Set<string>,
	packageId: string,
	context: PackageScriptContext,
): void {
	const packageDir = packageId.slice("package:".length);
	for (const node of packageScripts(graph, packageDir)) {
		if (isContextScript(node.label, packageDir, context)) {
			nodeIds.add(node.id);
		}
	}
}

function packageScripts(graph: CodeGraphSnapshot, packageDir: string): readonly CodeGraphNode[] {
	const scriptPrefix = `script:${packageDir}:`;
	return graph.nodes.filter((node) => isPackageScript(node, scriptPrefix));
}

function isPackageScript(node: CodeGraphNode, scriptPrefix: string): boolean {
	return node.kind === "PackageScript" && node.id.startsWith(scriptPrefix);
}

function isContextScript(scriptName: string, packageDir: string, context: PackageScriptContext): boolean {
	const kind = scriptContextKind(scriptName);
	if (kind === "safe-data") return context.hasDataContext;
	if (kind !== "validation") return false;
	return validationScriptMatchesPackageContext(scriptName, packageDir, context.packageDirs);
}

function scriptContextKind(scriptName: string): "safe-data" | "unsafe-data" | "validation" | "other" {
	if (isSafeDataScript(scriptName)) return "safe-data";
	if (scriptName.toLowerCase().startsWith("db:")) return "unsafe-data";
	if (isValidationScript(scriptName)) return "validation";
	return "other";
}

function validationScriptMatchesPackageContext(
	scriptName: string,
	packageDir: string,
	packageDirs: ReadonlySet<string>,
): boolean {
	if (packageDir !== ".") return true;
	return rootValidationScriptMatchesContext(scriptName, packageDirs);
}

function rootValidationScriptMatchesContext(scriptName: string, packageDirs: ReadonlySet<string>): boolean {
	if (packageDirs.size <= 1) return true;
	if (isGenericRootValidationScript(scriptName)) return true;
	return isRootValidationScriptForContext(scriptName, packageDirs);
}

function isGenericRootValidationScript(scriptName: string): boolean {
	return /^(build|check|ci|lint|test|typecheck|validate|verify)$/i.test(scriptName);
}

function isSafeDataScript(scriptName: string): boolean {
	return /^db:(types?|status|lint|check|validate|verify)$/i.test(scriptName);
}

function isValidationScript(scriptName: string): boolean {
	return /^(build|check|ci|e2e|fuzz|integration|lint|test|typecheck|unit|validate|verify)(:|$)/i.test(scriptName);
}

function isRootValidationScriptForContext(scriptName: string, packageDirs: ReadonlySet<string>): boolean {
	const scriptParts = scriptName.toLowerCase().split(":").slice(1);
	return contextPackageAliases(packageDirs).some((alias) => scriptParts.includes(alias));
}

function contextPackageAliases(packageDirs: ReadonlySet<string>): readonly string[] {
	return [...packageDirs]
		.filter((dir) => dir !== ".")
		.map((dir) => dir.split("/").at(-1)?.toLowerCase())
		.filter((dir): dir is string => dir !== undefined && dir.length > 0);
}

function packageOwnersForPath(packages: readonly CodeGraphNode[], path: string | undefined): readonly CodeGraphNode[] {
	if (path === undefined) return [];
	return packages
		.filter((node) => pathBelongsToPackage(path, packageDirForNode(node)))
		.toSorted((left, right) => packageDirForNode(right).length - packageDirForNode(left).length);
}

function pathBelongsToPackage(path: string, packageDir: string): boolean {
	return packageDir === "." ? true : path === packageDir || path.startsWith(`${packageDir}/`);
}

function packageDirForNode(node: CodeGraphNode): string {
	if (node.id.startsWith("package:")) return node.id.slice("package:".length);
	return ".";
}

const databaseNodeKinds = new Set<CodeGraphNode["kind"]>([
	"Migration",
	"DbTable",
	"DbFunction",
	"DbPolicy",
	"DbTrigger",
]);

function summarizeSliceContext(
	graph: CodeGraphSnapshot,
	nodeIds: ReadonlySet<string>,
	relatedNodeIds: ReadonlySet<string>,
	_focusedNodeIds: ReadonlySet<string>,
): GraphSliceSummary {
	const affectedPackages = affectedPackageSummaries(graph, nodeIds, relatedNodeIds);
	return {
		affectedPackages,
		validationCommands: validationCommandSummaries(graph, affectedPackages, nodeIds),
		annotationNotes: annotationNoteSummaries(selectedAnnotations(graph, nodeIds)),
	};
}

function emptySliceSummary(): GraphSliceSummary {
	return { affectedPackages: [], validationCommands: [], annotationNotes: [] };
}

interface PackageSummaryDraft {
	readonly packageNode: CodeGraphNode;
	directNodeCount: number;
	ancestorNodeCount: number;
	readonly scriptIds: Set<string>;
}

function affectedPackageSummaries(
	graph: CodeGraphSnapshot,
	nodeIds: ReadonlySet<string>,
	relatedNodeIds: ReadonlySet<string>,
): readonly AffectedPackageSummary[] {
	const packages = packageNodes(graph);
	const drafts = packageSummaryDrafts(packages, nodeIds);
	for (const node of selectedGraphNodes(graph, relatedNodeIds)) addPackageCounts(drafts, packages, node);
	for (const script of selectedPackageScripts(graph, nodeIds)) addPackageScriptId(drafts, script);
	return rankPackageSummaries([...drafts.values()]);
}

function packageSummaryDrafts(
	packages: readonly CodeGraphNode[],
	nodeIds: ReadonlySet<string>,
): Map<string, PackageSummaryDraft> {
	return new Map(
		packages
			.filter((node) => nodeIds.has(node.id))
			.map((node) => [node.id, { packageNode: node, directNodeCount: 0, ancestorNodeCount: 0, scriptIds: new Set() }]),
	);
}

function addPackageCounts(
	drafts: Map<string, PackageSummaryDraft>,
	packages: readonly CodeGraphNode[],
	node: CodeGraphNode,
): void {
	const owners = packageOwnersForPath(packages, node.path);
	for (const [index, owner] of owners.entries()) incrementPackageCount(drafts.get(owner.id), index);
}

function incrementPackageCount(draft: PackageSummaryDraft | undefined, ownerIndex: number): void {
	if (draft === undefined) return;
	if (ownerIndex === 0) draft.directNodeCount += 1;
	else draft.ancestorNodeCount += 1;
}

function addPackageScriptId(drafts: Map<string, PackageSummaryDraft>, script: CodeGraphNode): void {
	drafts.get(packageIdForScript(script))?.scriptIds.add(script.id);
}

function rankPackageSummaries(drafts: readonly PackageSummaryDraft[]): readonly AffectedPackageSummary[] {
	return sortedPackageSummaries(drafts).map((draft, index) => packageSummaryForDraft(draft, index + 1));
}

function sortedPackageSummaries(drafts: readonly PackageSummaryDraft[]): readonly PackageSummaryDraft[] {
	return [...drafts].sort(
		(left, right) =>
			packageSummarySortKey(right) - packageSummarySortKey(left) ||
			packageDirForNode(left.packageNode).localeCompare(packageDirForNode(right.packageNode)),
	);
}

function packageSummarySortKey(draft: PackageSummaryDraft): number {
	return draft.directNodeCount * 1_000 + draft.ancestorNodeCount * 10 + draft.scriptIds.size;
}

function packageSummaryForDraft(draft: PackageSummaryDraft, rank: number): AffectedPackageSummary {
	return {
		packageId: draft.packageNode.id,
		label: draft.packageNode.label,
		directory: packageDirForNode(draft.packageNode),
		path: draft.packageNode.path,
		rank,
		directNodeCount: draft.directNodeCount,
		ancestorNodeCount: draft.ancestorNodeCount,
		scriptIds: [...draft.scriptIds],
	};
}

function validationCommandSummaries(
	graph: CodeGraphSnapshot,
	packages: readonly AffectedPackageSummary[],
	nodeIds: ReadonlySet<string>,
): readonly ValidationCommandSummary[] {
	const packageCommands = validationCommandSummariesForPackages(graph, packages);
	const focusedCommands = focusedTestCommandSummaries(graph, packages, packageCommands, nodeIds);
	const moduleCommands = moduleTestCommandSummaries(graph, packages, packageCommands, nodeIds);
	return [...focusedCommands, ...moduleCommands, ...packageCommands];
}

function validationCommandSummariesForPackages(
	graph: CodeGraphSnapshot,
	packages: readonly AffectedPackageSummary[],
): readonly ValidationCommandSummary[] {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	return packages.flatMap((summary) =>
		summary.scriptIds.flatMap((scriptId) => validationCommandSummaryForScript(nodesById, summary.packageId, scriptId)),
	);
}

function focusedTestCommandSummaries(
	graph: CodeGraphSnapshot,
	packages: readonly AffectedPackageSummary[],
	commands: readonly ValidationCommandSummary[],
	nodeIds: ReadonlySet<string>,
): readonly ValidationCommandSummary[] {
	const testCommandsByPackageId = testCommandByPackageId(commands);
	const testPaths = testPathsForSelection(graph, nodeIds);
	return uniqueValidationCommands(
		testPaths.flatMap((testPath) => {
			const packageSummary = packageForPath(packages, testPath);
			if (packageSummary === undefined) return [];
			const testCommand = testCommandsByPackageId.get(packageSummary.packageId);
			if (testCommand === undefined) return [];
			const command = focusedTestCommandForScript(packageSummary, testCommand, testPath);
			return command === undefined ? [] : [command];
		}),
	);
}

function testCommandByPackageId(
	commands: readonly ValidationCommandSummary[],
): ReadonlyMap<string, ValidationCommandSummary> {
	return new Map(
		commands.flatMap((command) => (command.name === "test" ? [[command.packageId, command] as const] : [])),
	);
}

function uniqueValidationCommands(commands: readonly ValidationCommandSummary[]): readonly ValidationCommandSummary[] {
	const byScriptId = new Map<string, ValidationCommandSummary>();
	for (const command of commands) {
		if (!byScriptId.has(command.scriptId)) byScriptId.set(command.scriptId, command);
	}
	return [...byScriptId.values()];
}

function testPathsForSelection(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly string[] {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const paths = new Set<string>();
	for (const edge of graph.edges) addSelectedTestPath(edge, nodesById, nodeIds, paths);
	return [...paths].sort();
}

function addSelectedTestPath(
	edge: CodeGraphEdge,
	nodesById: ReadonlyMap<string, CodeGraphNode>,
	nodeIds: ReadonlySet<string>,
	paths: Set<string>,
): void {
	const testPath = selectedTestPath(edge, nodesById, nodeIds);
	if (testPath !== undefined) paths.add(testPath);
}

function selectedTestPath(
	edge: CodeGraphEdge,
	nodesById: ReadonlyMap<string, CodeGraphNode>,
	nodeIds: ReadonlySet<string>,
): string | undefined {
	if (!isSelectedTestEdge(edge, nodesById, nodeIds)) return undefined;
	return nodesById.get(edge.to)?.path;
}

function isSelectedTestEdge(
	edge: CodeGraphEdge,
	nodesById: ReadonlyMap<string, CodeGraphNode>,
	nodeIds: ReadonlySet<string>,
): boolean {
	return edge.kind === "TESTS" && !isPackageScriptNode(nodesById.get(edge.from)) && edgeTouchesSelection(edge, nodeIds);
}

function isPackageScriptNode(node: CodeGraphNode | undefined): boolean {
	return node?.kind === "PackageScript";
}

function edgeTouchesSelection(edge: CodeGraphEdge, nodeIds: ReadonlySet<string>): boolean {
	return nodeIds.has(edge.from) || nodeIds.has(edge.to);
}

function focusedTestCommandForScript(
	packageSummary: AffectedPackageSummary,
	testCommand: ValidationCommandSummary,
	testPath: string,
): ValidationCommandSummary | undefined {
	const focusedCommand = focusedBunTestCommand(testCommand.command, packageSummary.directory, testPath);
	if (focusedCommand === undefined) return undefined;
	return {
		packageId: packageSummary.packageId,
		scriptId: `${testCommand.scriptId}#${testPath}`,
		name: `test:${testPath}`,
		command: focusedCommand,
		runCommand: focusedCommand,
		path: testCommand.path,
	};
}

function moduleTestCommandSummaries(
	graph: CodeGraphSnapshot,
	packages: readonly AffectedPackageSummary[],
	commands: readonly ValidationCommandSummary[],
	nodeIds: ReadonlySet<string>,
): readonly ValidationCommandSummary[] {
	return moduleTestScopesForSelection(graph, nodeIds).flatMap((modulePath) =>
		moduleTestCommandForPath(packages, commands, modulePath),
	);
}

function moduleTestScopesForSelection(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly string[] {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const scopes = new Set<string>();
	for (const nodeId of nodeIds) {
		const scope = moduleTestScopeForNode(nodesById.get(nodeId));
		if (scope !== undefined) scopes.add(scope);
	}
	return [...scopes].sort();
}

function moduleTestScopeForNode(node: CodeGraphNode | undefined): string | undefined {
	if (node?.path === undefined || !moduleTestSourceNodeKinds.has(node.kind) || isTestPath(node.path)) return undefined;
	return moduleTestScopePath(node.path);
}

function isTestPath(path: string): boolean {
	return path.includes("__tests__/") || /\.(test|spec)\.[cm]?[tj]sx?$/.test(path);
}

const moduleTestSourceNodeKinds = new Set<CodeGraphNode["kind"]>(["Entrypoint", "File", "GeneratedArtifact", "Route"]);

function moduleTestScopePath(path: string): string | undefined {
	const segments = path.split("/");
	const srcIndex = segments.indexOf("src");
	if (srcIndex >= 0) return srcScopePath(segments, srcIndex);
	return parentPath(path);
}

function srcScopePath(segments: readonly string[], srcIndex: number): string {
	const endIndex = segments.length > srcIndex + 2 ? srcIndex + 2 : srcIndex + 1;
	return segments.slice(0, endIndex).join("/");
}

function parentPath(path: string): string | undefined {
	const index = path.lastIndexOf("/");
	return index <= 0 ? undefined : path.slice(0, index);
}

function moduleTestCommandForPath(
	packages: readonly AffectedPackageSummary[],
	commands: readonly ValidationCommandSummary[],
	modulePath: string,
): readonly ValidationCommandSummary[] {
	const command = moduleTestCommandSummary(packages, commands, modulePath);
	return command === undefined ? [] : [command];
}

function moduleTestCommandSummary(
	packages: readonly AffectedPackageSummary[],
	commands: readonly ValidationCommandSummary[],
	modulePath: string,
): ValidationCommandSummary | undefined {
	const packageSummary = packageForPath(packages, modulePath);
	if (packageSummary === undefined) return undefined;
	return moduleTestCommandForPackage(packageSummary, commands, modulePath);
}

function moduleTestCommandForPackage(
	packageSummary: AffectedPackageSummary,
	commands: readonly ValidationCommandSummary[],
	modulePath: string,
): ValidationCommandSummary | undefined {
	const testCommand = commands.find(
		(command) => command.packageId === packageSummary.packageId && command.name === "test",
	);
	if (testCommand === undefined) return undefined;
	const command = focusedBunTestCommand(testCommand.command, packageSummary.directory, modulePath);
	if (command === undefined) return undefined;
	return {
		packageId: packageSummary.packageId,
		scriptId: `${testCommand.scriptId}#${modulePath}`,
		name: `test:${modulePath}`,
		command,
		runCommand: command,
		path: testCommand.path,
	};
}

function packageForPath(packages: readonly AffectedPackageSummary[], path: string): AffectedPackageSummary | undefined {
	return packages
		.filter((summary) => pathBelongsToPackage(path, summary.directory))
		.toSorted((left, right) => right.directory.length - left.directory.length)[0];
}

function focusedBunTestCommand(command: string | undefined, packageDir: string, testPath: string): string | undefined {
	if (command !== "bun test") return undefined;
	if (packageDir === ".") return `bun test ${shellPath(bunTestPathArgument(testPath))}`;
	if (!pathBelongsToPackage(testPath, packageDir)) return undefined;
	const relativePath = testPath.slice(packageDir.length + 1);
	return `cd ${shellPath(packageDir)} && bun test ${shellPath(bunTestPathArgument(relativePath))}`;
}

function bunTestPathArgument(path: string): string {
	return path.startsWith("./") || path.startsWith("../") || path.startsWith("/") ? path : `./${path}`;
}

function shellPath(path: string): string {
	return /^[A-Za-z0-9_./:-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

function selectedPackageScripts(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly CodeGraphNode[] {
	return graph.nodes.filter((node) => nodeIds.has(node.id) && node.kind === "PackageScript");
}

function validationCommandSummaryForScript(
	nodesById: ReadonlyMap<string, CodeGraphNode>,
	packageId: string,
	scriptId: string,
): readonly ValidationCommandSummary[] {
	const node = nodesById.get(scriptId);
	if (node === undefined) return [];
	return [
		{
			packageId,
			scriptId: node.id,
			name: node.label,
			command: metadataString(node, "command"),
			runCommand: packageScriptRunCommand(packageId, node.label),
			path: node.path,
		},
	];
}

function packageScriptRunCommand(packageId: string, scriptName: string): string {
	const command = `bun run ${shellPath(scriptName)}`;
	const packageDir = packageDirForPackageId(packageId);
	return packageDir === "." ? command : `cd ${shellPath(packageDir)} && ${command}`;
}

function packageDirForPackageId(packageId: string): string {
	const directory = packageId.startsWith("package:") ? packageId.slice("package:".length) : ".";
	return directory.length === 0 ? "." : directory;
}

function packageIdForScript(node: CodeGraphNode): string {
	const suffix = node.id.slice("script:".length);
	const scriptSuffix = `:${node.label}`;
	const packageDir = suffix.endsWith(scriptSuffix) ? suffix.slice(0, -scriptSuffix.length) : ".";
	return `package:${packageDir}`;
}

function metadataString(node: CodeGraphNode, key: string): string | undefined {
	const value = node.metadata[key];
	return typeof value === "string" ? value : undefined;
}

export function renderSlice(slice: GraphSlice): string {
	const pathNodes = slice.nodes.filter((node) => node.path !== undefined);
	const nonPathNodes = slice.nodes.filter((node) => node.path === undefined);
	return [
		`# ${slice.title}`,
		"",
		`Selector: \`${slice.selector}\``,
		`Nodes: ${slice.nodes.length}`,
		`Edges: ${slice.edges.length}`,
		"",
		"## Files",
		...pathNodes.slice(0, 200).map((node) => `- ${node.kind}: \`${node.path}\` - ${node.label}`),
		"",
		"## Related Nodes",
		...nonPathNodes.slice(0, 200).map((node) => `- ${node.kind}: ${node.label}`),
		"",
		...renderPackageContext(slice.summary),
		...renderAnnotationContext(slice.summary),
		"## Edges",
		...slice.edges
			.slice(0, 200)
			.map((edge) => `- ${edge.kind}: ${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`),
		"",
		"## Findings",
		...(slice.findings.length === 0
			? ["- None"]
			: slice.findings.map((finding) => `- ${finding.severity}: ${finding.message}`)),
		"",
	].join("\n");
}

function renderAnnotationContext(summary: GraphSliceSummary | undefined): readonly string[] {
	if (summary === undefined || summary.annotationNotes.length === 0) return ["## Semantic Notes", "- None", ""];
	return [
		"## Semantic Notes",
		...summary.annotationNotes
			.slice(0, 50)
			.map((note) => `- ${note.kind} ${note.status}: ${note.targetNodeId} - ${note.summary}`),
		"",
	];
}

function renderPackageContext(summary: GraphSliceSummary | undefined): readonly string[] {
	if (summary === undefined || summary.affectedPackages.length === 0) return ["## Package Context", "- None", ""];
	return [
		"## Package Context",
		...summary.affectedPackages
			.slice(0, 50)
			.map(
				(packageSummary) =>
					`- #${packageSummary.rank} ${packageSummary.label} (${packageSummary.directory}): ${packageSummary.directNodeCount} direct nodes, ${packageSummary.ancestorNodeCount} ancestor nodes; scripts ${scriptNames(packageSummary.scriptIds)}`,
			),
		"",
	];
}

function scriptNames(scriptIds: readonly string[]): string {
	if (scriptIds.length === 0) return "none";
	return scriptIds.map((scriptId) => scriptId.split(":").slice(2).join(":")).join(", ");
}

function selectNodes(graph: CodeGraphSnapshot, selector: string): readonly CodeGraphNode[] {
	if (selector === "all") return graph.nodes;
	const packageValue = packageSelectorValue(selector);
	if (packageValue !== undefined) return selectPackageNodes(graph, packageValue);
	const scopedSelector = scopedSelectorFor(selector);
	if (scopedSelector !== undefined) return graph.nodes.filter(scopedSelector);
	const lowered = selector.toLowerCase();
	return graph.nodes.filter(
		(node) =>
			node.id.toLowerCase().includes(lowered) ||
			node.label.toLowerCase().includes(lowered) ||
			node.path?.toLowerCase().includes(lowered),
	);
}

function sliceRelatedGraph(
	graph: CodeGraphSnapshot,
	nodeIds: ReadonlySet<string>,
): Pick<GraphSlice, "edges" | "findings" | "annotations"> {
	return {
		edges: graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
		findings: graph.findings.filter((finding) => finding.nodeId === undefined || nodeIds.has(finding.nodeId)),
		annotations: selectedAnnotations(graph, nodeIds),
	};
}

function selectedAnnotations(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly AgentAnnotation[] {
	return graph.annotations.filter(
		(annotation) => nodeIds.has(annotation.targetNodeId) && visibleAnnotationStatuses.has(annotation.status),
	);
}

function annotationNoteSummaries(annotations: readonly AgentAnnotation[]): readonly AnnotationNoteSummary[] {
	return annotations.map((annotation) => ({
		id: annotation.id,
		targetNodeId: annotation.targetNodeId,
		kind: annotation.kind,
		status: annotation.status,
		confidence: annotation.confidence,
		summary: annotation.summary,
		evidencePaths: annotation.evidence.map((item) => item.path),
	}));
}

const visibleAnnotationStatuses = new Set<AgentAnnotation["status"]>(["accepted", "stale"]);

function scopedSelectorFor(selector: string): ((node: CodeGraphNode) => boolean) | undefined {
	const prefixed = prefixedSelectorFor(selector);
	if (prefixed !== undefined) return prefixed;
	if (isNodeIdSelector(selector)) return nodeIdSelector(selector);
	return undefined;
}

function prefixedSelectorFor(selector: string): ((node: CodeGraphNode) => boolean) | undefined {
	const entry = selectorPrefixes.find((candidate) => selector.startsWith(candidate.prefix));
	return entry?.create(selector.slice(entry.prefix.length));
}

function pathSelector(rawPath: string): (node: CodeGraphNode) => boolean {
	const path = rawPath.replace(/^\.\//, "");
	return (node) => node.path === path || node.path?.startsWith(`${path}/`) === true;
}

function packageSelectorValue(selector: string): string | undefined {
	return selector.startsWith("package:") ? selector.slice("package:".length) : undefined;
}

function selectPackageNodes(graph: CodeGraphSnapshot, value: string): readonly CodeGraphNode[] {
	const selectedPackages = packageNodes(graph).filter((node) => packageNodeMatches(node, value));
	const selectedPackageDirs = new Set(selectedPackages.map(packageDirForNode));
	return graph.nodes.filter(
		(node) =>
			selectedPackages.some((packageNode) => packageNode.id === node.id) ||
			(node.path !== undefined && pathBelongsToSelectedPackage(node.path, selectedPackageDirs)),
	);
}

function packageNodeMatches(node: CodeGraphNode, value: string): boolean {
	const packageDir = packageDirForNode(node);
	if (node.id === `package:${value}`) return true;
	if (node.label === value) return true;
	if (packageDir === value) return true;
	return nodePathMatchesPackageSelector(node, value);
}

function nodePathMatchesPackageSelector(node: CodeGraphNode, value: string): boolean {
	if (value === ".") return false;
	if (node.path === undefined) return false;
	return pathBelongsToPackage(node.path, value);
}

function pathBelongsToSelectedPackage(path: string, packageDirs: ReadonlySet<string>): boolean {
	return [...packageDirs].some((dir) => dir !== "." && pathBelongsToPackage(path, dir));
}

function kindSelector(kind: string): (node: CodeGraphNode) => boolean {
	return (node) => node.kind === kind;
}

function configSelector(id: string): (node: CodeGraphNode) => boolean {
	const fullId = `config:${id}`;
	return (node) => node.id === fullId || node.id.startsWith(`${fullId}:`);
}

const selectorPrefixes = [
	{ prefix: "path:", create: pathSelector },
	{ prefix: "kind:", create: kindSelector },
	{ prefix: "config:", create: configSelector },
];

function isNodeIdSelector(selector: string): boolean {
	return nodeIdSelectorPrefixes.some((prefix) => selector.startsWith(prefix));
}

function nodeIdSelector(selector: string): (node: CodeGraphNode) => boolean {
	return (node) => node.id === selector;
}

const nodeIdSelectorPrefixes = [
	"dbfunction:",
	"dbpolicy:",
	"dbtable:",
	"dbtrigger:",
	"config:",
	"dir:",
	"dirty:",
	"env:",
	"external:",
	"file:",
	"iacmodule:",
	"iacresource:",
	"migration:",
	"repo:",
	"script:",
	"symbol:",
];

const impactEdgeKinds = new Set<CodeGraphEdge["kind"]>([
	"IMPORTS",
	"TYPE_IMPORTS",
	"DOCUMENTS",
	"REFERENCES",
	"CALLS",
	"GENERATED_BY",
	"USES_ENV",
	"CONFIGURES",
	"SERVICE_QUERIES_TABLE",
	"SERVICE_CALLS_RPC",
	"TABLE_REFERENCES_TABLE",
	"DEPENDS_ON",
	"MIGRATION_CREATES",
	"MIGRATION_ALTERS",
	"MIGRATION_DROPS",
	"RESOURCE_DEPENDS_ON",
	"AFFECTS",
]);
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/context.ts" language="ts">
<![CDATA[
import { impactGraph, sliceGraph } from "./query.ts";
import type {
	AffectedPackageSummary,
	CodeGraphNode,
	CodeGraphSnapshot,
	GraphContext,
	GraphContextCompact,
	GraphContextSummary,
	GraphSlice,
	GraphSliceSummary,
	ValidationCommandSummary,
} from "./types.ts";

export interface BuildGraphContextOptions {
	readonly path: string;
	readonly selector?: string;
	readonly depth?: number | undefined;
}

export function buildGraphContext(graph: CodeGraphSnapshot, options: BuildGraphContextOptions): GraphContext {
	const selector = options.selector ?? contextSelectorFor(options.path);
	const slice = sliceGraph(graph, selector);
	const impact = impactGraph(graph, options.path, { maxDepth: options.depth });
	return {
		path: options.path,
		selector,
		depth: options.depth,
		manifest: graph.manifest,
		summary: summarizeContext(slice, impact),
		slice,
		impact,
	};
}

export function compactGraphContext(context: GraphContext): GraphContextCompact {
	const summary = compactGraphContextSummary(context.summary);
	return {
		path: context.path,
		selector: context.selector,
		depth: context.depth,
		manifest: context.manifest,
		summary,
		totals: {
			slice: graphSliceTotals(context.slice),
			impact: graphSliceTotals(context.impact),
		},
		omissions: {
			validationCommands: Math.max(0, context.summary.validationCommands.length - summary.validationCommands.length),
		},
		limits: {
			validationCommands: MAX_COMPACT_VALIDATION_COMMANDS,
		},
	};
}

export function renderGraphContextSummary(summary: GraphContextSummary): readonly string[] {
	return [
		"## Preflight Summary",
		"",
		"Primary paths:",
		...renderGraphContextList(summary.primaryPaths),
		"",
		"Impact paths:",
		...renderGraphContextList(summary.impactPaths),
		"",
		"Test paths:",
		...renderGraphContextList(summary.testPaths),
		"",
		"Affected packages:",
		...renderGraphContextList(summary.affectedPackages.map((item) => `#${item.rank} ${item.packageId}`)),
		"",
		"Validation commands:",
		...renderGraphContextList(
			summary.validationCommands.map((item) => {
				const command = validationCommandForDisplay(item);
				return `${item.scriptId}${command ? ` - ${command}` : ""}`;
			}),
		),
		"",
		"Semantic notes:",
		...renderGraphContextList(
			summary.annotationNotes.map((item) => `${item.kind} ${item.status}: ${item.targetNodeId} - ${item.summary}`),
		),
		"",
		"Findings:",
		...renderGraphContextList(summary.findings.map((item) => `${item.severity}: ${item.message}`)),
		"",
	];
}

export function renderGraphContextList(items: readonly string[]): readonly string[] {
	if (items.length === 0) return ["- None"];
	return items.slice(0, 50).map((item) => `- ${item}`);
}

export function contextSelectorFor(path: string): string {
	const normalized = path.replace(/^\.\//, "");
	if (normalized.startsWith("file:")) return `path:${normalized.slice("file:".length)}`;
	return isExplicitContextSelector(normalized) || looksLikeFilePath(normalized)
		? normalizedSelector(normalized)
		: normalized;
}

function graphSliceTotals(slice: GraphSlice): GraphContextCompact["totals"]["slice"] {
	return {
		nodes: slice.nodes.length,
		edges: slice.edges.length,
		findings: slice.findings.length,
	};
}

function compactGraphContextSummary(summary: GraphContextSummary): GraphContextSummary {
	return {
		...summary,
		validationCommands: compactValidationCommands(summary),
	};
}

function compactValidationCommands(summary: GraphContextSummary): readonly ValidationCommandSummary[] {
	const relevantFocused = summary.validationCommands.filter((command) =>
		validationCommandMatchesContext(command, summary),
	);
	const packageCommands = summary.validationCommands.filter(
		(command) => !command.scriptId.includes("#") && isCompactPackageCommand(command),
	);
	const fallbackCommands = relevantFocused.length === 0 ? summary.validationCommands : [];
	return mergeSummaryItems(relevantFocused, packageCommands, (item) => item.scriptId)
		.concat(fallbackCommands.filter((command) => !relevantFocused.some((item) => item.scriptId === command.scriptId)))
		.slice(0, MAX_COMPACT_VALIDATION_COMMANDS);
}

function isCompactPackageCommand(command: ValidationCommandSummary): boolean {
	return /^(build|check|ci|lint(:eslint)?|test|typecheck|validate|verify)$/i.test(command.name);
}

function validationCommandMatchesContext(command: ValidationCommandSummary, summary: GraphContextSummary): boolean {
	const scope = testCommandScope(command);
	if (scope === undefined) return false;
	return (
		summary.testPaths.includes(scope) ||
		summary.primaryPaths.some((path) => path === scope || path.startsWith(`${scope}/`)) ||
		summary.impactPaths.some((path) => path === scope || path.startsWith(`${scope}/`))
	);
}

function testCommandScope(command: ValidationCommandSummary): string | undefined {
	if (!command.name.startsWith("test:")) return undefined;
	const scope = command.name.slice("test:".length);
	return scope.length === 0 ? undefined : scope;
}

function summarizeContext(slice: GraphSlice, impact: GraphSlice): GraphContextSummary {
	const sliceSummary = summaryForSlice(slice);
	const impactSummary = summaryForSlice(impact);
	return {
		primaryPaths: contextPaths(slice),
		impactPaths: contextPaths(impact),
		testPaths: mergeSummaryItems(contextTestPaths(impact), contextTestPaths(slice), (item) => item),
		affectedPackages: rerankPackages(
			mergeSummaryItems(impactSummary.affectedPackages, sliceSummary.affectedPackages, (item) => item.packageId),
		),
		validationCommands: prioritizeValidationCommands(
			mergeSummaryItems(impactSummary.validationCommands, sliceSummary.validationCommands, (item) => item.scriptId),
		),
		annotationNotes: mergeSummaryItems(impactSummary.annotationNotes, sliceSummary.annotationNotes, (item) => item.id),
		findings: mergeSummaryItems(impact.findings, slice.findings, (item) => item.id),
	};
}

function prioritizeValidationCommands(
	commands: readonly ValidationCommandSummary[],
): readonly ValidationCommandSummary[] {
	return commands
		.map((command, index) => ({ command, index }))
		.toSorted(
			(left, right) =>
				validationCommandPriority(left.command) - validationCommandPriority(right.command) || left.index - right.index,
		)
		.map((item) => item.command);
}

function validationCommandPriority(command: ValidationCommandSummary): number {
	return command.scriptId.includes("#") ? 0 : 1;
}

function validationCommandForDisplay(command: ValidationCommandSummary): string | undefined {
	return command.runCommand ?? command.command;
}

function summaryForSlice(slice: GraphSlice): GraphSliceSummary {
	return slice.summary ?? EMPTY_GRAPH_SLICE_SUMMARY;
}

function contextPaths(slice: GraphSlice): readonly string[] {
	const paths = new Set<string>();
	for (const node of slice.nodes) {
		if (node.path !== undefined && contextPathNodeKinds.has(node.kind)) paths.add(node.path);
	}
	return [...paths];
}

function contextTestPaths(slice: GraphSlice): readonly string[] {
	const nodesById = new Map(slice.nodes.map((node) => [node.id, node]));
	return mergeSummaryItems(
		slice.edges.flatMap((edge) => {
			if (edge.kind !== "TESTS") return [];
			const testPath = nodesById.get(edge.to)?.path;
			return testPath === undefined ? [] : [testPath];
		}),
		[],
		(item) => item,
	);
}

function rerankPackages(packages: readonly AffectedPackageSummary[]): readonly AffectedPackageSummary[] {
	return packages.map((item, index) => ({ ...item, rank: index + 1 }));
}

function mergeSummaryItems<T>(
	primary: readonly T[],
	secondary: readonly T[],
	keyForItem: (item: T) => string,
): readonly T[] {
	const items = new Map<string, T>();
	for (const item of [...primary, ...secondary]) addSummaryItem(items, item, keyForItem);
	return [...items.values()];
}

function addSummaryItem<T>(items: Map<string, T>, item: T, keyForItem: (item: T) => string): void {
	const key = keyForItem(item);
	if (!items.has(key)) items.set(key, item);
}

function normalizedSelector(value: string): string {
	return isExplicitContextSelector(value) ? value : `path:${value}`;
}

function isExplicitContextSelector(value: string): boolean {
	return contextSelectorPrefixes.some((prefix) => value.startsWith(prefix));
}

function looksLikeFilePath(value: string): boolean {
	return value.includes("/") || value.includes(".");
}

const contextSelectorPrefixes = [
	"dbtable:",
	"dbfunction:",
	"dbpolicy:",
	"dbtrigger:",
	"config:",
	"dir:",
	"dirty:",
	"env:",
	"external:",
	"iacmodule:",
	"iacresource:",
	"kind:",
	"migration:",
	"package:",
	"path:",
	"policy:",
	"repo:",
	"route:",
	"script:",
	"symbol:",
	"test:",
] as const;

const contextPathNodeKinds = new Set<CodeGraphNode["kind"]>([
	"File",
	"Test",
	"Doc",
	"Config",
	"GeneratedArtifact",
	"BoundaryPolicy",
	"Entrypoint",
	"IaCModule",
	"IaCResource",
	"Route",
	"Migration",
	"DirtyArtifact",
]);

const EMPTY_GRAPH_SLICE_SUMMARY: GraphSliceSummary = {
	affectedPackages: [],
	validationCommands: [],
	annotationNotes: [],
};

const MAX_COMPACT_VALIDATION_COMMANDS = 20;
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/preflight.ts" language="ts">
<![CDATA[
import { resolve } from "node:path";
import { readCodeGraph } from "./artifacts.ts";
import { buildCodeGraph } from "./builder.ts";
import { buildGraphContext, compactGraphContext } from "./context.ts";
import { graphWithAnnotationOverlay, readAnnotationOverlay } from "./overlays.ts";
import type { CodeGraphSnapshot, GraphContextCompact, ValidationCommandSummary } from "./types.ts";
import { HarnessError } from "../shared/errors.ts";
import { ok, err, type Result } from "../shared/result.ts";
import { truncateChars } from "../shared/text.ts";
import { escapeXml } from "../shared/xml.ts";

export interface CartographerPreflightInput {
	readonly root: string;
	readonly path: string;
	readonly outDir?: string | undefined;
	readonly live?: boolean | undefined;
	readonly depth?: number | undefined;
	readonly maxFileBytes?: number | undefined;
	readonly maxPromptChars?: number | undefined;
}

export interface CartographerPreflightResult {
	readonly command: string;
	readonly root: string;
	readonly targetPath: string;
	readonly live: boolean;
	readonly depth: number;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly durationMs: number;
	readonly timings: CartographerPreflightTimings;
	readonly context: GraphContextCompact;
	readonly promptText: string;
}

export interface CartographerPreflightTimings {
	readonly loadGraphMs: number;
	readonly buildContextMs: number;
	readonly renderPromptMs: number;
}

interface ResolvedCartographerPreflightInput extends CartographerPreflightInput {
	readonly root: string;
	readonly live: boolean;
	readonly depth: number;
}

export async function runCartographerPreflight(
	input: CartographerPreflightInput,
): Promise<Result<CartographerPreflightResult, HarnessError>> {
	const startedAtMs = Date.now();
	const startedAtDate = new Date(startedAtMs);
	const resolved = resolvePreflightInput(input);
	const command = cartographerPreflightCommand(resolved);
	try {
		const loadGraphStartedAtMs = Date.now();
		const graph = await loadPreflightGraph(resolved);
		const loadGraphFinishedAtMs = Date.now();
		return ok(
			cartographerPreflightResult({
				input: resolved,
				command,
				startedAtDate,
				startedAtMs,
				loadGraphMs: elapsedMs(loadGraphStartedAtMs, loadGraphFinishedAtMs),
				graph,
			}),
		);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause, preflightErrorContext(resolved, command)));
	}
}

function resolvePreflightInput(input: CartographerPreflightInput): ResolvedCartographerPreflightInput {
	return {
		...input,
		root: resolve(input.root),
		live: input.live ?? true,
		depth: input.depth ?? 1,
	};
}

async function loadPreflightGraph(input: ResolvedCartographerPreflightInput): Promise<CodeGraphSnapshot> {
	const outDir = input.outDir === undefined ? resolve(input.root, "docs/codegraph") : resolve(input.root, input.outDir);
	const graph = input.live
		? await buildCodeGraph({ root: input.root, maxFileBytes: input.maxFileBytes ?? 750_000 })
		: await readCodeGraph(outDir);
	return graphWithAnnotationOverlay(graph, await readAnnotationOverlay(outDir));
}

function cartographerPreflightResult(input: {
	readonly input: ResolvedCartographerPreflightInput;
	readonly command: string;
	readonly startedAtDate: Date;
	readonly startedAtMs: number;
	readonly loadGraphMs: number;
	readonly graph: CodeGraphSnapshot;
}): CartographerPreflightResult {
	const buildContextStartedAtMs = Date.now();
	const context = compactGraphContext(
		buildGraphContext(input.graph, { path: input.input.path, depth: input.input.depth }),
	);
	const buildContextFinishedAtMs = Date.now();
	const renderPromptStartedAtMs = Date.now();
	const promptText = renderCartographerPreflightPrompt({
		command: input.command,
		context,
		maxPromptChars: input.input.maxPromptChars,
	});
	const finishedAtMs = Date.now();
	const finishedAtDate = new Date(finishedAtMs);
	return {
		command: input.command,
		root: input.input.root,
		targetPath: input.input.path,
		live: input.input.live,
		depth: input.input.depth,
		startedAt: input.startedAtDate.toISOString(),
		finishedAt: finishedAtDate.toISOString(),
		durationMs: elapsedMs(input.startedAtMs, finishedAtMs),
		timings: {
			loadGraphMs: input.loadGraphMs,
			buildContextMs: elapsedMs(buildContextStartedAtMs, buildContextFinishedAtMs),
			renderPromptMs: elapsedMs(renderPromptStartedAtMs, finishedAtMs),
		},
		context,
		promptText,
	};
}

function elapsedMs(startedAtMs: number, finishedAtMs: number): number {
	return Math.max(0, finishedAtMs - startedAtMs);
}

function preflightErrorContext(input: ResolvedCartographerPreflightInput, command: string): Record<string, unknown> {
	return {
		operation: "cartographer.preflight",
		command,
		root: input.root,
		path: input.path,
		live: input.live,
		depth: input.depth,
		...(input.outDir !== undefined ? { outDir: resolve(input.root, input.outDir) } : {}),
	};
}

function renderCartographerPreflightPrompt(input: {
	readonly command: string;
	readonly context: GraphContextCompact;
	readonly maxPromptChars?: number | undefined;
}): string {
	const json = JSON.stringify(input.context, null, 2);
	const maxChars = input.maxPromptChars ?? 20_000;
	const contextJson = promptContextJson(json, maxChars);
	return [
		'<system-reminder source="cartographer" type="cartographer-preflight" version="1">',
		"  <instruction>Cartographer graph preflight already ran before this turn. Use it for initial orientation, then verify with direct source reads before editing.</instruction>",
		`  <command>${escapeXml(input.command)}</command>`,
		"  <navigation-brief>",
		...renderPreflightNavigationBrief(input.context).map((line) => `    ${escapeXml(line)}`),
		"  </navigation-brief>",
		...renderContextJsonGuidance(input.context, contextJson).map((line) => `  ${line}`),
		`  <context-json truncated="${contextJson.truncated}" original-chars="${contextJson.originalChars}" emitted-chars="${contextJson.emittedChars}" max-chars="${contextJson.maxChars}">`,
		escapeXml(contextJson.text),
		"  </context-json>",
		"</system-reminder>",
	].join("\n");
}

function renderContextJsonGuidance(
	context: GraphContextCompact,
	contextJson: ReturnType<typeof promptContextJson>,
): readonly string[] {
	if (!contextJson.truncated) return [];
	return [
		"<truncation-guidance>",
		"  <instruction>The context-json payload is truncated. Use the navigation brief for orientation, then query fuller graph context before relying on missing details.</instruction>",
		`  <follow-up-command>${escapeXml(fullContextCommand(context))}</follow-up-command>`,
		"</truncation-guidance>",
	];
}

function fullContextCommand(context: GraphContextCompact): string {
	const parts = [
		"cartographer",
		"context",
		"--root",
		shellToken(context.manifest.root),
		"--live",
		"--path",
		shellToken(context.path),
	];
	if (context.depth !== undefined) parts.push("--depth", String(context.depth));
	parts.push("--json");
	return parts.join(" ");
}

function promptContextJson(
	json: string,
	maxChars: number,
): {
	readonly text: string;
	readonly truncated: boolean;
	readonly originalChars: number;
	readonly emittedChars: number;
	readonly maxChars: number;
} {
	const text = truncateChars(json, maxChars);
	const originalChars = charCount(json);
	const emittedChars = charCount(text);
	return {
		text,
		truncated: emittedChars < originalChars,
		originalChars,
		emittedChars,
		maxChars: Math.max(0, Math.floor(maxChars)),
	};
}

function charCount(value: string): number {
	return Array.from(value).length;
}

function renderPreflightNavigationBrief(context: GraphContextCompact): readonly string[] {
	return [
		`Target: ${context.path}`,
		`Selector: ${context.selector}`,
		`Graph: ${context.manifest.totals.files} files, ${context.manifest.totals.nodes} nodes, ${context.manifest.totals.edges} edges, ${context.manifest.totals.findings} findings`,
		`Slice: ${context.totals.slice.nodes} nodes, ${context.totals.slice.edges} edges; impact: ${context.totals.impact.nodes} nodes, ${context.totals.impact.edges} edges`,
		"Primary paths:",
		...briefList(context.summary.primaryPaths),
		"Test paths:",
		...briefList(context.summary.testPaths),
		"Affected packages:",
		...briefList(
			context.summary.affectedPackages.map(
				(item) => `#${item.rank} ${item.packageId} (${item.directory}) direct=${item.directNodeCount}`,
			),
		),
		"Validation commands:",
		...briefList(validationCommandBriefItems(context.summary.validationCommands)),
		"Semantic notes:",
		...briefList(context.summary.annotationNotes.map((item) => `${item.kind} ${item.status}: ${item.summary}`)),
		"Findings:",
		...briefList(context.summary.findings.map((item) => `${item.severity}: ${item.message}`)),
	];
}

function validationCommandBriefItems(commands: readonly ValidationCommandSummary[]): readonly string[] {
	return prioritizedValidationCommands(commands).map((item) => `${item.name}: ${validationCommandForDisplay(item)}`);
}

function prioritizedValidationCommands(
	commands: readonly ValidationCommandSummary[],
): readonly ValidationCommandSummary[] {
	return commands
		.map((command, index) => ({ command, index }))
		.toSorted(
			(left, right) =>
				validationCommandPriority(left.command) - validationCommandPriority(right.command) || left.index - right.index,
		)
		.map((item) => item.command);
}

function validationCommandPriority(command: ValidationCommandSummary): number {
	return command.scriptId.includes("#") ? 0 : 1;
}

function validationCommandForDisplay(command: ValidationCommandSummary): string | undefined {
	return command.runCommand ?? command.command;
}

function briefList(items: readonly string[]): readonly string[] {
	if (items.length === 0) return ["- None"];
	const visible = items.slice(0, MAX_BRIEF_ITEMS).map((item) => `- ${item}`);
	const omittedCount = items.length - visible.length;
	return omittedCount > 0 ? [...visible, `- ... ${omittedCount} more`] : visible;
}

const MAX_BRIEF_ITEMS = 12;

function cartographerPreflightCommand(input: {
	readonly root: string;
	readonly path: string;
	readonly outDir?: string | undefined;
	readonly live: boolean;
	readonly depth: number;
	readonly maxFileBytes?: number | undefined;
}): string {
	const parts = ["cartographer", "preflight", "--root", shellToken(input.root)];
	if (input.outDir !== undefined) parts.push("--out", shellToken(input.outDir));
	if (input.live) parts.push("--live");
	parts.push("--path", shellToken(input.path), "--depth", String(input.depth));
	if (input.maxFileBytes !== undefined) parts.push("--max-file-bytes", String(input.maxFileBytes));
	return parts.join(" ");
}

function shellToken(value: string): string {
	return /^[a-zA-Z0-9_./:@-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/commands.ts" language="ts">
<![CDATA[
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HarnessError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { ParsedArgs } from "../cli/args.ts";
import { flagString, hasFlag } from "../cli/args.ts";
import { writeOut } from "../cli/io.ts";
import type { RuntimeEvent } from "../core/types.ts";
import {
	analyzeGraphCommandAdoption,
	checkGraphFirstAdoption,
	checkTraceExpectations,
	type GraphCommandAdoptionSummary,
	type GraphFirstAdoptionCheck,
	type TraceExpectedValue,
	type TraceExpectationCheck,
	type TraceExpectationInput,
} from "./adoption.ts";
import { checkCodeGraphArtifacts, writeCodeGraphArtifacts, readCodeGraph, type CodeGraphArtifactCompatibility } from "./artifacts.ts";
import { buildCodeGraph } from "./builder.ts";
import {
	buildGraphContext,
	compactGraphContext,
	contextSelectorFor,
	renderGraphContextList,
	renderGraphContextSummary,
} from "./context.ts";
import { diffCodeGraphs, renderCodeGraphDiff } from "./diff.ts";
import type { CodeGraphDiff } from "./diff.ts";
import { runCartographerMcpServer } from "./mcp.ts";
import { annotateSliceWithOpenRouter, DEFAULT_OPENROUTER_MODEL } from "./openrouter.ts";
import {
	auditAnnotationOverlay,
	graphWithAnnotationOverlay,
	readAnnotationOverlay,
	renderAnnotationOverlayAudit,
	type AnnotationOverlayAudit,
	type AnnotationOverlayLoadResult,
} from "./overlays.ts";
import { impactGraph, renderSlice, sliceGraph, summarizeGraph } from "./query.ts";
import { runCartographerPreflight, type CartographerPreflightResult } from "./preflight.ts";
import type { AgentAnnotation, GraphContext, GraphContextCompact } from "./types.ts";

type CartographerHandler = (args: ParsedArgs) => Promise<Result<void, HarnessError>>;

interface AdoptionTraceAnalysis {
	readonly events: readonly RuntimeEvent[];
	readonly summary: GraphCommandAdoptionSummary;
}

const cartographerHandlers: Record<string, CartographerHandler> = {
	help: runHelp,
	mcp: runMcp,
	index: runIndex,
	update: runIndex,
	verify: runVerify,
	view: runView,
	diff: runDiff,
	slice: runSlice,
	impact: runImpact,
	context: runContext,
	preflight: runPreflight,
	adoption: runAdoption,
	annotate: runAnnotate,
	annotations: runAnnotations,
};

export async function runCartographer(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	const subcommand = args.positionals[0] ?? "help";
	const handler = cartographerHandlers[subcommand];
	return handler === undefined
		? err(new HarnessError("VALIDATION_FAILED", `unknown cartographer subcommand: ${subcommand}`))
		: handler(args);
}

async function runHelp(): Promise<Result<void, HarnessError>> {
	await writeOut(cartographerHelp());
	return ok(undefined);
}

async function runMcp(): Promise<Result<void, HarnessError>> {
	try {
		await runCartographerMcpServer();
		return ok(undefined);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runIndex(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const root = flagString(args, "root", ".");
		const outDir = flagString(args, "out", "docs/codegraph");
		const maxFileBytes = numberFlag(args, "max-file-bytes", 750_000);
		const graph = await buildCodeGraph({ root, maxFileBytes });
		await writeCodeGraphArtifacts(graph, { outDir, mapPath: mapPath(args, outDir) });
		await writeOut(`${summarizeGraph(graph)}Artifacts: ${outDir}\n`);
		return ok(undefined);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runView(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const graph = await loadGraph(args);
		if (hasFlag(args, "json")) {
			await writeOut(`${JSON.stringify(graph.manifest, null, 2)}\n`);
			return ok(undefined);
		}
		await writeOut(summarizeGraph(graph));
		return ok(undefined);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runVerify(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const outDir = flagString(args, "out", "docs/codegraph");
		const compatibility = await checkCodeGraphArtifacts(outDir);
		const freshness = hasFlag(args, "fresh") ? await graphFreshnessCheck(args, outDir) : undefined;
		const output = verifyOutput(compatibility, freshness);
		await writeOut(
			hasFlag(args, "json")
				? `${JSON.stringify(output, null, 2)}\n`
				: renderArtifactCompatibility(output),
		);
		if (!output.ok) {
			return err(new HarnessError("VALIDATION_FAILED", `code graph artifacts are incompatible: ${outDir}`));
		}
		return ok(undefined);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause));
	}
}

interface CodeGraphVerifyOutput extends CodeGraphArtifactCompatibility {
	readonly freshness?: CodeGraphFreshnessCheck | undefined;
}

interface CodeGraphFreshnessCheck {
	readonly ok: boolean;
	readonly root: string;
	readonly diffSummary: CodeGraphDiff["summary"];
	readonly persisted: CodeGraphDiff["base"];
	readonly live: CodeGraphDiff["head"];
}

async function graphFreshnessCheck(args: ParsedArgs, outDir: string): Promise<CodeGraphFreshnessCheck> {
	const root = flagString(args, "root", ".");
	const persisted = await readCodeGraph(outDir);
	const live = await buildCodeGraph({ root, maxFileBytes: numberFlag(args, "max-file-bytes", 750_000) });
	const diff = diffCodeGraphs(persisted, live);
	return {
		ok: diffIsEmpty(diff),
		root,
		diffSummary: diff.summary,
		persisted: diff.base,
		live: diff.head,
	};
}

function diffIsEmpty(diff: CodeGraphDiff): boolean {
	return Object.values(diff.summary).every(
		(summary) => summary.added === 0 && summary.removed === 0 && summary.changed === 0,
	);
}

function verifyOutput(
	compatibility: CodeGraphArtifactCompatibility,
	freshness: CodeGraphFreshnessCheck | undefined,
): CodeGraphVerifyOutput {
	return { ...compatibility, ok: compatibility.ok && (freshness?.ok ?? true), freshness };
}

async function runDiff(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const base = requiredFlag(args, "base", "usage: cartographer diff --base docs/codegraph.before --head docs/codegraph.after");
		const head = requiredFlag(args, "head", "usage: cartographer diff --base docs/codegraph.before --head docs/codegraph.after");
		const diff = diffCodeGraphs(await readCodeGraph(base), await readCodeGraph(head));
		await writeOut(hasFlag(args, "json") ? `${JSON.stringify(diff, null, 2)}\n` : renderCodeGraphDiff(diff));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runSlice(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const selector = requiredFlag(
			args,
			"selector",
			"usage: cartographer slice --selector path:src/index.ts",
		);
		const graph = await loadGraph(args);
		await writeSlice(args, sliceGraph(graph, selector));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runImpact(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const path = requiredFlag(args, "path", "usage: cartographer impact --path src/index.ts");
		const graph = await loadGraph(args);
		await writeSlice(args, impactGraph(graph, path, { maxDepth: optionalNumberFlag(args, "depth") }));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runContext(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const path = requiredFlag(args, "path", "usage: cartographer context --path src/index.ts");
		const graph = await loadGraph(args);
		const depth = optionalNumberFlag(args, "depth");
		const selector = flagString(args, "selector", contextSelectorFor(path));
		await writeContext(args, buildGraphContext(graph, { path, selector, depth }));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runPreflight(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const path = requiredFlag(args, "path", "usage: cartographer preflight --path src/index.ts");
		const result = await runCartographerPreflight({
			root: flagString(args, "root", "."),
			outDir: flagString(args, "out", "docs/codegraph"),
			live: hasFlag(args, "live"),
			path,
			depth: optionalNumberFlag(args, "depth") ?? 1,
			maxFileBytes: numberFlag(args, "max-file-bytes", 750_000),
		});
		if (!result.ok) return err(result.error);
		await writeOut(`${JSON.stringify(preflightJson(result.data), null, 2)}\n`);
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runAdoption(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const analysis = await adoptionTraceAnalysisFromArgs(args);
		const expectationCheck = traceExpectationCheck(args, analysis.events);
		const graphFirstCheck = graphFirstAdoptionCheck(args, analysis.summary);
		await writeAdoptionSummary(args, analysis.summary, expectationCheck, graphFirstCheck);
		const graphFirst = enforceGraphFirstAdoption(args, analysis.summary, graphFirstCheck);
		if (!graphFirst.ok) return graphFirst;
		return enforceTraceExpectations(expectationCheck);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function adoptionTraceAnalysisFromArgs(args: ParsedArgs): Promise<AdoptionTraceAnalysis> {
	const tracePath = requiredFlag(args, "trace", "usage: cartographer adoption --trace trace.json");
	const events = await readRuntimeEvents(tracePath);
	return { events, summary: analyzeGraphCommandAdoption(events) };
}

async function writeAdoptionSummary(
	args: ParsedArgs,
	summary: GraphCommandAdoptionSummary,
	expectationCheck: TraceExpectationCheck | undefined,
	graphFirstCheck: GraphFirstAdoptionCheck | undefined,
): Promise<void> {
	await writeOut(
		hasFlag(args, "json")
			? `${JSON.stringify(adoptionJson(summary, expectationCheck, graphFirstCheck), null, 2)}\n`
			: renderAdoptionSummary(summary, expectationCheck, graphFirstCheck),
	);
}

function adoptionJson(
	summary: GraphCommandAdoptionSummary,
	expectationCheck: TraceExpectationCheck | undefined,
	graphFirstCheck: GraphFirstAdoptionCheck | undefined,
): Record<string, unknown> {
	return {
		...summary,
		...(graphFirstCheck === undefined ? {} : { graphFirstAdoption: graphFirstCheck }),
		...(expectationCheck === undefined ? {} : { finalResponseExpectation: expectationCheck }),
	};
}

function preflightJson(result: CartographerPreflightResult): Record<string, unknown> {
	return {
		...result.context,
		preflight: {
			command: result.command,
			root: result.root,
			targetPath: result.targetPath,
			live: result.live,
			startedAt: result.startedAt,
			finishedAt: result.finishedAt,
			durationMs: result.durationMs,
			timings: result.timings,
		},
	};
}

function traceExpectationCheck(args: ParsedArgs, events: readonly RuntimeEvent[]): TraceExpectationCheck | undefined {
	const expectations = traceExpectationInput(args);
	return expectations === undefined ? undefined : checkTraceExpectations(events, expectations);
}

function traceExpectationInput(args: ParsedArgs): TraceExpectationInput | undefined {
	const expectations = {
		...optionalStringFlag(args, "expect-text", "text"),
		...optionalStringFlag(args, "expect-path", "path"),
		...optionalStringFlag(args, "expect-command", "command"),
		...optionalStringFlag(args, "expect-executed-command", "executedCommand"),
	};
	return Object.keys(expectations).length === 0 ? undefined : expectations;
}

function optionalStringFlag(
	args: ParsedArgs,
	flag: string,
	key: keyof TraceExpectationInput,
): Partial<TraceExpectationInput> {
	const value = args.flags[flag];
	if (typeof value === "string" && value.length > 0) {
		return { [key]: value };
	}
	const values = Array.isArray(value) ? value.filter((entry) => entry.length > 0) : [];
	return values.length > 0 ? { [key]: values } : {};
}

function graphFirstAdoptionCheck(
	args: ParsedArgs,
	summary: GraphCommandAdoptionSummary,
): GraphFirstAdoptionCheck | undefined {
	return hasFlag(args, "require-graph-first") ? checkGraphFirstAdoption(summary) : undefined;
}

function enforceGraphFirstAdoption(
	args: ParsedArgs,
	summary: GraphCommandAdoptionSummary,
	graphFirst: GraphFirstAdoptionCheck | undefined,
): Result<void, HarnessError> {
	if (!hasFlag(args, "require-graph-first") || graphFirst === undefined) return ok(undefined);
	if (graphFirst.passed) return ok(undefined);
	return err(
		new HarnessError("VALIDATION_FAILED", `graph-first adoption failed: ${graphFirst.failures.join("; ")}`, {
			context: {
				adopted: summary.adopted,
				graphPreflightFailureCount: summary.graphPreflightFailureCount,
				sourceReadBeforeGraphCount: summary.sourceReadBeforeGraphCount,
				failures: [...graphFirst.failures],
			},
		}),
	);
}

function enforceTraceExpectations(expectationCheck: TraceExpectationCheck | undefined): Result<void, HarnessError> {
	if (expectationCheck === undefined || expectationCheck.passed) return ok(undefined);
	return err(
		new HarnessError("VALIDATION_FAILED", `trace expectation failed: ${expectationCheck.failures.join("; ")}`, {
			context: {
				finalTextLength: expectationCheck.finalTextLength,
				failures: [...expectationCheck.failures],
				expectedText: expectationCheck.expectedText,
				expectedPath: expectationCheck.expectedPath,
				expectedCommand: expectationCheck.expectedCommand,
				expectedExecutedCommand: expectationCheck.expectedExecutedCommand,
			},
		}),
	);
}

async function writeSlice(args: ParsedArgs, slice: ReturnType<typeof sliceGraph>): Promise<void> {
	if (hasFlag(args, "json")) {
		await writeOut(`${JSON.stringify(slice, null, 2)}\n`);
		return;
	}
	await writeOut(renderSlice(slice));
}

async function writeContext(args: ParsedArgs, context: GraphContext): Promise<void> {
	if (hasFlag(args, "compact")) {
		const compact = compactGraphContext(context);
		await writeOut(hasFlag(args, "json") ? `${JSON.stringify(compact, null, 2)}\n` : renderCompactContext(compact));
		return;
	}
	if (hasFlag(args, "json")) {
		await writeOut(`${JSON.stringify(context, null, 2)}\n`);
		return;
	}
	await writeOut(renderContext(context));
}

function renderContext(context: GraphContext): string {
	return [
		`# Context for ${context.path}`,
		"",
		`Graph: \`${context.manifest.root}\``,
		`Generated: ${context.manifest.generatedAt}`,
		`Git: ${context.manifest.git.dirty ? "dirty" : "clean"}${context.manifest.git.commit ? ` @ ${context.manifest.git.commit.slice(0, 12)}` : ""}`,
		`Selector: \`${context.selector}\``,
		`Impact depth: ${context.depth ?? "unbounded"}`,
		"",
		...renderGraphContextSummary(context.summary),
		"## Selected Slice",
		renderSlice(context.slice).trim(),
		"",
		"## Impact",
		renderSlice(context.impact).trim(),
		"",
	].join("\n");
}

function renderCompactContext(context: GraphContextCompact): string {
	return [
		`# Context for ${context.path}`,
		"",
		`Graph: \`${context.manifest.root}\``,
		`Generated: ${context.manifest.generatedAt}`,
		`Git: ${context.manifest.git.dirty ? "dirty" : "clean"}${context.manifest.git.commit ? ` @ ${context.manifest.git.commit.slice(0, 12)}` : ""}`,
		`Selector: \`${context.selector}\``,
		`Impact depth: ${context.depth ?? "unbounded"}`,
		`Slice totals: ${context.totals.slice.nodes} nodes, ${context.totals.slice.edges} edges, ${context.totals.slice.findings} findings`,
		`Impact totals: ${context.totals.impact.nodes} nodes, ${context.totals.impact.edges} edges, ${context.totals.impact.findings} findings`,
		"",
		...renderGraphContextSummary(context.summary),
	].join("\n");
}

function renderArtifactCompatibility(compatibility: CodeGraphVerifyOutput): string {
	return [
		"# Code Graph Artifact Compatibility",
		"",
		`Artifacts: \`${compatibility.outDir}\``,
		`Compatible: ${yesNo(compatibility.ok)}`,
		`Schema version: ${compatibility.schemaVersion ?? "unknown"}`,
		`Generated: ${compatibility.generatedAt ?? "unknown"}`,
		"",
		"Totals:",
		...renderCompatibilityTotals(compatibility),
		"",
		"Issues:",
		...renderCompatibilityIssues(compatibility),
		"",
		...renderFreshnessCheck(compatibility.freshness),
		"",
	].join("\n");
}

function renderCompatibilityTotals(compatibility: CodeGraphArtifactCompatibility): readonly string[] {
	if (compatibility.totals === undefined) return ["- Unknown"];
	return [
		`- Files: ${compatibility.totals.files}`,
		`- Packages: ${compatibility.totals.packages}`,
		`- Nodes: ${compatibility.totals.nodes}`,
		`- Edges: ${compatibility.totals.edges}`,
		`- Findings: ${compatibility.totals.findings}`,
	];
}

function renderCompatibilityIssues(compatibility: CodeGraphArtifactCompatibility): readonly string[] {
	if (compatibility.issues.length === 0) return ["- None"];
	return compatibility.issues.map((issue) =>
		[
			`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`,
			issue.path === undefined ? "" : `(${issue.path})`,
		]
			.filter((part) => part.length > 0)
			.join(" "),
	);
}

function renderFreshnessCheck(freshness: CodeGraphFreshnessCheck | undefined): readonly string[] {
	if (freshness === undefined) return [];
	return [
		"Freshness:",
		`- Root: \`${freshness.root}\``,
		`- Fresh: ${yesNo(freshness.ok)}`,
		`- Node changes: +${freshness.diffSummary.nodes.added} -${freshness.diffSummary.nodes.removed} ~${freshness.diffSummary.nodes.changed}`,
		`- Edge changes: +${freshness.diffSummary.edges.added} -${freshness.diffSummary.edges.removed} ~${freshness.diffSummary.edges.changed}`,
		`- Finding changes: +${freshness.diffSummary.findings.added} -${freshness.diffSummary.findings.removed} ~${freshness.diffSummary.findings.changed}`,
		`- Annotation changes: +${freshness.diffSummary.annotations.added} -${freshness.diffSummary.annotations.removed} ~${freshness.diffSummary.annotations.changed}`,
	];
}

function renderAdoptionSummary(
	summary: GraphCommandAdoptionSummary,
	expectationCheck: TraceExpectationCheck | undefined,
	graphFirstCheck: GraphFirstAdoptionCheck | undefined,
): string {
	return [
		"# Graph Command Adoption",
		"",
		`Adopted: ${yesNo(summary.adopted)}`,
		`Trace events: ${summary.eventCount}`,
		`Trace duration: ${msOrUnknown(summary.traceDurationMs)}`,
		`Tool commands: ${summary.toolCommandCount}`,
		`Graph preflight results: ${summary.graphPreflightResultCount}`,
		`First graph preflight duration: ${msOrUnknown(summary.firstGraphPreflightDurationMs)}`,
		`Graph preflight failures: ${summary.graphPreflightFailureCount}`,
		`Source reads before graph: ${summary.sourceReadBeforeGraphCount}`,
		`First graph command: ${textOrNone(summary.firstGraphCommand)}`,
		`First graph command offset: ${msOrUnknown(summary.firstGraphCommandOffsetMs)}`,
		`First graph preflight failure: ${textOrNone(summary.firstGraphPreflightFailureCommand)}`,
		`First graph preflight failure offset: ${msOrUnknown(summary.firstGraphPreflightFailureOffsetMs)}`,
		`First source read before graph: ${textOrNone(summary.firstSourceReadBeforeGraph)}`,
		`First source read before graph offset: ${msOrUnknown(summary.firstSourceReadBeforeGraphOffsetMs)}`,
		"",
		"Graph preflight failure commands:",
		...renderGraphContextList(summary.graphPreflightFailureCommands),
		"",
		"Source reads before graph:",
		...renderGraphContextList(summary.sourceReadCommandsBeforeGraph),
		"",
		...renderGraphFirstAdoptionSummary(graphFirstCheck),
		"",
		...renderTraceExpectationSummary(expectationCheck),
		"",
	].join("\n");
}

function renderGraphFirstAdoptionSummary(graphFirstCheck: GraphFirstAdoptionCheck | undefined): readonly string[] {
	if (graphFirstCheck === undefined) return [];
	return [
		"Graph-first gate:",
		`Passed: ${yesNo(graphFirstCheck.passed)}`,
		"Gate failures:",
		...renderGraphContextList(graphFirstCheck.failures),
	];
}

function renderTraceExpectationSummary(expectationCheck: TraceExpectationCheck | undefined): readonly string[] {
	if (expectationCheck === undefined) return [];
	return [
		"Final response expectation:",
		`Passed: ${yesNo(expectationCheck.passed)}`,
		`Final text length: ${expectationCheck.finalTextLength}`,
		`Expected text: ${expectedValueOrNone(expectationCheck.expectedText)}`,
		`Expected path: ${expectedValueOrNone(expectationCheck.expectedPath)}`,
		`Expected command: ${expectedValueOrNone(expectationCheck.expectedCommand)}`,
		`Expected executed command: ${expectedValueOrNone(expectationCheck.expectedExecutedCommand)}`,
		"Expectation metrics:",
		...renderTraceExpectationMetrics(expectationCheck.metrics),
		"Path evidence:",
		...renderPathEvidence(expectationCheck.pathEvidence),
		"Command evidence:",
		...renderCommandEvidence(expectationCheck.commandEvidence),
		"Executed command evidence:",
		...renderCommandEvidence(expectationCheck.executedCommandEvidence),
		"Expectation failures:",
		...renderGraphContextList(expectationCheck.failures),
	];
}

function renderTraceExpectationMetrics(metrics: TraceExpectationCheck["metrics"]): readonly string[] {
	return [
		`- Text final hits: ${metrics.finalTextHitCount}/${metrics.expectedTextCount}`,
		`- Path final/tool/source-read hits: ${metrics.finalPathHitCount}/${metrics.toolPathHitCount}/${metrics.sourceReadPathHitCount} of ${metrics.expectedPathCount}`,
		`- Command final/tool hits: ${metrics.finalCommandHitCount}/${metrics.toolCommandHitCount} of ${metrics.expectedCommandCount}`,
		`- Executed command hits: ${metrics.executedCommandHitCount}/${metrics.expectedExecutedCommandCount}`,
	];
}

function renderPathEvidence(pathEvidence: TraceExpectationCheck["pathEvidence"]): readonly string[] {
	if (pathEvidence === undefined || pathEvidence.length === 0) return ["- None"];
	return pathEvidence.map((item) =>
		[
			`- ${item.path}: final=${yesNo(item.observedInFinalResponse)}`,
			`tool=${yesNo(item.observedInToolCommand)}`,
			`source-read=${yesNo(item.observedInSourceReadCommand)}`,
			`first-tool=${textOrNone(item.firstToolCommand)}`,
			`first-source-read=${textOrNone(item.firstSourceReadCommand)}`,
		].join("; "),
	);
}

function renderCommandEvidence(commandEvidence: TraceExpectationCheck["commandEvidence"]): readonly string[] {
	if (commandEvidence === undefined || commandEvidence.length === 0) return ["- None"];
	return commandEvidence.map((item) =>
		[
			`- ${item.command}: final=${yesNo(item.observedInFinalResponse)}`,
			`tool=${yesNo(item.observedInToolCommand)}`,
			`first-tool=${textOrNone(item.firstToolCommand)}`,
		].join("; "),
	);
}

function yesNo(value: boolean): string {
	return value ? "yes" : "no";
}

function textOrNone(value: string | undefined): string {
	return value ?? "None";
}

function expectedValueOrNone(value: TraceExpectedValue | undefined): string {
	if (value === undefined) return "None";
	return typeof value === "string" ? value : value.join(", ");
}

function msOrUnknown(value: number | undefined): string {
	return `${value ?? "unknown"} ms`;
}

async function readRuntimeEvents(path: string): Promise<readonly RuntimeEvent[]> {
	const text = await readFile(path, "utf8");
	return runtimeEventsFromJson(parseTraceJson(text)).map(runtimeEventAtIndex);
}

function parseTraceJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new HarnessError(
			"VALIDATION_FAILED",
			`trace is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
}

function runtimeEventsFromJson(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) return value;
	if (!isRecord(value)) throw invalidTraceShapeError();
	return runtimeEventArrayFromRecord(value) ?? raiseTraceShapeError();
}

function runtimeEventArrayFromRecord(value: Record<string, unknown>): readonly unknown[] | undefined {
	const events = value["events"];
	if (Array.isArray(events)) return events;
	const runtimeEvents = value["runtimeEvents"];
	return Array.isArray(runtimeEvents) ? runtimeEvents : undefined;
}

function runtimeEventAtIndex(event: unknown, index: number): RuntimeEvent {
	if (isRuntimeEvent(event)) return event;
	throw new HarnessError("VALIDATION_FAILED", `trace event at index ${index} is not a RuntimeEvent`);
}

function raiseTraceShapeError(): never {
	throw invalidTraceShapeError();
}

function invalidTraceShapeError(): HarnessError {
	return new HarnessError(
		"VALIDATION_FAILED",
		"trace JSON must be a RuntimeEvent[] or an object with events/runtimeEvents",
	);
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
	return isRecord(value) && hasRuntimeEventHeader(value) && "data" in value;
}

function hasRuntimeEventHeader(value: Record<string, unknown>): boolean {
	return (
		runtimeEventTypes.has(value["type"]) &&
		typeof value["timestamp"] === "string" &&
		typeof value["turnId"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runAnnotate(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const graph = await loadGraph(args);
		const selector = flagString(args, "selector", "all");
		const slice = sliceGraph(graph, selector);
		if (hasFlag(args, "dry-run")) {
			await writeOut(renderSlice(slice));
			return ok(undefined);
		}
		const apiKey = requireOpenRouterApiKey();
		const annotations = await annotateSliceWithOpenRouter({
			apiKey,
			model: flagString(args, "model", DEFAULT_OPENROUTER_MODEL),
			slice,
		});
		const overlayPath = await writeAnnotationOverlay(args, annotations);
		await writeOut(`Wrote ${annotations.length} candidate annotations to ${overlayPath}\n`);
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runAnnotations(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const graph = await loadBaseGraph(args);
		const overlay = await loadAnnotationOverlay(args);
		const audit = auditAnnotationOverlay(graph, overlay);
		const review = annotationReviewFromArgs(args);
		if (review !== undefined) {
			const result = applyAnnotationReview(overlay, audit, review);
			await writeAnnotationOverlayRecords(overlay.overlayPath, result.annotations);
			const nextAudit = auditAnnotationOverlay(graph, { ...overlay, annotations: result.annotations, parseIssues: [] });
			await writeAnnotationReviewResult(args, { ...result, audit: nextAudit });
			return ok(undefined);
		}
		await writeOut(hasFlag(args, "json") ? `${JSON.stringify(audit, null, 2)}\n` : renderAnnotationOverlayAudit(audit));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

interface AnnotationReviewInput {
	readonly action: "accept" | "retire";
	readonly annotationId: string;
	readonly reviewer: string;
	readonly now: Date;
}

interface AnnotationReviewResult {
	readonly overlayPath: string;
	readonly action: AnnotationReviewInput["action"];
	readonly annotationId: string;
	readonly reviewer: string;
	readonly annotation: AgentAnnotation;
	readonly annotations: readonly AgentAnnotation[];
}

interface AnnotationReviewOutput extends AnnotationReviewResult {
	readonly audit: AnnotationOverlayAudit;
}

function annotationReviewFromArgs(args: ParsedArgs): AnnotationReviewInput | undefined {
	const accept = optionalFlagString(args, "accept");
	const retire = optionalFlagString(args, "retire");
	if (accept !== undefined && retire !== undefined) {
		throw new HarnessError("VALIDATION_FAILED", "use only one of --accept or --retire");
	}
	const annotationId = accept ?? retire;
	if (annotationId === undefined) return undefined;
	const reviewer = optionalFlagString(args, "reviewer");
	if (reviewer === undefined) {
		throw new HarnessError("VALIDATION_FAILED", "--reviewer is required when reviewing annotations");
	}
	return { action: accept !== undefined ? "accept" : "retire", annotationId, reviewer, now: new Date() };
}

function optionalFlagString(args: ParsedArgs, name: string): string | undefined {
	const value = args.flags[name];
	if (Array.isArray(value)) return value.at(-1);
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function applyAnnotationReview(
	overlay: AnnotationOverlayLoadResult,
	audit: AnnotationOverlayAudit,
	review: AnnotationReviewInput,
): AnnotationReviewResult {
	if (audit.parseIssues.length > 0) {
		throw new HarnessError("VALIDATION_FAILED", "cannot rewrite annotation overlay while parse issues are present");
	}
	const annotation = overlay.annotations.find((candidate) => candidate.id === review.annotationId);
	if (annotation === undefined) {
		throw new HarnessError("VALIDATION_FAILED", `annotation not found: ${review.annotationId}`);
	}
	const updated = updateReviewedAnnotation(annotation, review, issuesForAnnotation(audit, review.annotationId));
	return {
		overlayPath: overlay.overlayPath,
		action: review.action,
		annotationId: review.annotationId,
		reviewer: review.reviewer,
		annotation: updated,
		annotations: overlay.annotations.map((candidate) => (candidate.id === review.annotationId ? updated : candidate)),
	};
}

function issuesForAnnotation(audit: AnnotationOverlayAudit, annotationId: string) {
	return audit.issues.filter((issue) => issue.annotationId === annotationId);
}

function updateReviewedAnnotation(
	annotation: AgentAnnotation,
	review: AnnotationReviewInput,
	issues: ReturnType<typeof issuesForAnnotation>,
): AgentAnnotation {
	if (review.action === "accept" && issues.length > 0) {
		throw new HarnessError(
			"VALIDATION_FAILED",
			`cannot accept annotation with audit issues: ${issues.map((issue) => issue.code).join(", ")}`,
		);
	}
	return {
		...annotation,
		author: { type: "human", name: review.reviewer },
		confidence: "human-reviewed",
		status: review.action === "accept" ? "accepted" : "retired",
		updatedAt: review.now.toISOString(),
	};
}

async function writeAnnotationReviewResult(args: ParsedArgs, result: AnnotationReviewOutput): Promise<void> {
	if (hasFlag(args, "json")) {
		await writeOut(
			`${JSON.stringify(
				{
					overlayPath: result.overlayPath,
					action: result.action,
					annotationId: result.annotationId,
					reviewer: result.reviewer,
					annotation: result.annotation,
					audit: result.audit,
				},
				null,
				2,
			)}\n`,
		);
		return;
	}
	await writeOut(
		[
			`Reviewed annotation ${result.annotationId}`,
			`Action: ${result.action}`,
			`Reviewer: ${result.reviewer}`,
			`Overlay: ${result.overlayPath}`,
			"",
		].join("\n"),
	);
}

function requireOpenRouterApiKey(): string {
	const apiKey = Bun.env["OPENROUTER_API_KEY"];
	if (apiKey !== undefined && apiKey.length > 0) return apiKey;
	throw new HarnessError("AUTH_FAILED", "OPENROUTER_API_KEY is required for cartographer annotate");
}

async function writeAnnotationOverlay(args: ParsedArgs, annotations: readonly unknown[]): Promise<string> {
	const outDir = flagString(args, "out", "docs/codegraph");
	const overlayDir = join(outDir, "overlays");
	await mkdir(overlayDir, { recursive: true });
	const overlayPath = join(overlayDir, "agent-notes.jsonl");
	if (annotations.length > 0) {
		await appendFile(overlayPath, `${annotations.map((annotation) => JSON.stringify(annotation)).join("\n")}\n`);
	}
	return overlayPath;
}

async function writeAnnotationOverlayRecords(
	overlayPath: string,
	annotations: readonly AgentAnnotation[],
): Promise<void> {
	await mkdir(dirname(overlayPath), { recursive: true });
	await writeFile(
		overlayPath,
		annotations.length === 0 ? "" : `${annotations.map((annotation) => JSON.stringify(annotation)).join("\n")}\n`,
	);
}

async function loadGraph(args: ParsedArgs) {
	return graphWithAnnotationOverlay(await loadBaseGraph(args), await loadAnnotationOverlay(args));
}

async function loadBaseGraph(args: ParsedArgs) {
	const outDir = flagString(args, "out", "docs/codegraph");
	if (hasFlag(args, "live")) {
		return buildCodeGraph({
			root: flagString(args, "root", "."),
			maxFileBytes: numberFlag(args, "max-file-bytes", 750_000),
		});
	}
	return readCodeGraph(outDir);
}

async function loadAnnotationOverlay(args: ParsedArgs) {
	return readAnnotationOverlay(flagString(args, "out", "docs/codegraph"));
}

function mapPath(args: ParsedArgs, outDir: string): string | undefined {
	const value = args.flags["map"];
	if (value === false) return undefined;
	if (typeof value === "string") return value;
	return join(outDir, "CODEBASE_MAP.md");
}

function requiredFlag(args: ParsedArgs, name: string, message: string): string {
	const value = args.flags[name];
	if (typeof value === "string" && value.length > 0) return value;
	throw new HarnessError("VALIDATION_FAILED", message);
}

function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
	const value = args.flags[name];
	if (typeof value !== "string") return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalNumberFlag(args: ParsedArgs, name: string): number | undefined {
	const value = args.flags[name];
	if (typeof value !== "string") return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function cartographerHelp(): string {
	return [
		"cartographer <subcommand> [options]",
		"",
		"Subcommands:",
		"  mcp        Run the thin MCP stdio wrapper over Cartographer CLI operations",
		"  index      Build docs/codegraph/{schema,manifest,graph}.json and CODEBASE_MAP.md",
		"  update     Rebuild the graph artifacts in place",
		"  verify     Check graph artifact compatibility and structural integrity",
		"  view       Show graph summary from --out",
		"  diff       Diff two graph artifact directories with --base and --head",
		"  slice      Show a task slice, e.g. --selector path:src/index.ts",
		"  impact     Show incoming impact for --path src/index.ts",
		"  context    Show slice plus impact context for --path src/index.ts",
		"  preflight  Agent pre-edit context: compact JSON, depth 1 by default",
		"  adoption   Summarize graph-command adoption from a RuntimeEvent trace",
		"  annotate   Use OpenRouter to write candidate overlay notes",
		"  annotations Audit semantic overlay notes against the current graph",
		"",
		"Options:",
		"  --root <path>              Repo root for live/index mode. Default: .",
		"  --out <path>               Graph artifact directory. Default: docs/codegraph",
		"  --base <path>              Base graph artifact directory for diff",
		"  --head <path>              Head graph artifact directory for diff",
		"  --map <path>               Map output path. Default: <out>/CODEBASE_MAP.md",
		"  --selector <selector>      all, path:<path>, package:<path-or-name>, kind:<node-kind>, node id, or text",
		"  --path <path>              File path or node id for impact/context",
		"  --trace <path>             RuntimeEvent[] JSON trace for adoption analysis",
		"  --depth <n>                Limit impact traversal depth. Default: unbounded",
		"  --json                     Emit JSON for view, slice, impact, context, adoption, and annotations",
		"  --fresh                    For verify, compare artifacts against a live graph from --root",
		"  --require-graph-first      For adoption, fail if graph was unused, preflight failed, or repo source was read before graph context",
		"  --expect-text <text>       For adoption, fail if final trace text omits this text. Repeatable",
		"  --expect-path <path>       For adoption, fail if final trace text omits this path. Repeatable",
		"  --expect-command <cmd>     For adoption, fail if final trace text omits this command. Repeatable",
		"  --expect-executed-command <cmd> For adoption, fail if no tool command executes this command. Repeatable",
		"  --accept <annotation-id>  For annotations, accept a review-ready candidate annotation",
		"  --retire <annotation-id>  For annotations, retire an annotation",
		"  --reviewer <name>         Reviewer name required with --accept or --retire",
		"  --compact                  For context, omit nested slice/impact payloads and keep totals only",
		"  --live                     Build in memory instead of reading <out>/graph.json",
		"  --dry-run                  For annotate, render the slice without calling OpenRouter",
		"  --model <model>            OpenRouter model. Default: openai/gpt-5.5",
		"  --max-file-bytes <bytes>   Max text bytes read per file. Default: 750000",
		"",
	].join("\n");
}

const runtimeEventTypes = new Set<unknown>([
	"status",
	"assistant",
	"tool_use",
	"tool_result",
	"result",
	"error",
	"heartbeat",
]);
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/src/code-graph/graph-store.ts" language="ts">
<![CDATA[
import type {
	CodeGraphEdge,
	CodeGraphEdgeKind,
	CodeGraphEvidence,
	CodeGraphFinding,
	CodeGraphNode,
	CodeGraphProvenance,
} from "./types.ts";

export const SCANNER_VERSION = "0.1.0";

export interface MutableGraph {
	readonly nodes: Map<string, CodeGraphNode>;
	readonly edges: Map<string, CodeGraphEdge>;
	readonly findings: CodeGraphFinding[];
}

export function createMutableGraph(): MutableGraph {
	return { nodes: new Map(), edges: new Map(), findings: [] };
}

export function addNode(graph: MutableGraph, node: CodeGraphNode): CodeGraphNode {
	const existing = graph.nodes.get(node.id);
	if (existing !== undefined) return existing;
	graph.nodes.set(node.id, node);
	return node;
}

export function addEdge(graph: MutableGraph, kind: CodeGraphEdgeKind, from: string, to: string, label?: string): void {
	addProvenanceEdge(graph, kind, from, to, label, provenance("syntax", []));
}

export function addProvenanceEdge(
	graph: MutableGraph,
	kind: CodeGraphEdgeKind,
	from: string,
	to: string,
	label: string | undefined,
	edgeProvenance: CodeGraphProvenance,
): void {
	if (!hasEdgeEndpoints(graph, kind, from, to)) return;
	const id = edgeId(kind, from, to, label);
	if (graph.edges.has(id)) return;
	graph.edges.set(id, {
		id,
		kind,
		from,
		to,
		...(label !== undefined ? { label } : {}),
		metadata: {},
		provenance: edgeProvenance,
	});
}

function hasEdgeEndpoints(graph: MutableGraph, kind: CodeGraphEdgeKind, from: string, to: string): boolean {
	if (graph.nodes.has(from) && graph.nodes.has(to)) return true;
	graph.findings.push({
		id: `finding:dangling:${kind}:${from}:${to}`,
		severity: "warn",
		message: `Skipped dangling ${kind} edge from ${from} to ${to}`,
		evidence: [],
	});
	return false;
}

function edgeId(kind: CodeGraphEdgeKind, from: string, to: string, label?: string): string {
	return `edge:${kind}:${from}:${to}:${label ?? ""}`;
}

export function provenance(
	source: CodeGraphProvenance["source"],
	evidence: readonly CodeGraphEvidence[],
	freshness: CodeGraphProvenance["freshness"] = "fresh",
): CodeGraphProvenance {
	return {
		source,
		evidence,
		confidence: source === "agent-annotation" ? "agent-inferred" : "deterministic",
		freshness,
		scannerVersion: SCANNER_VERSION,
	};
}

export function fileNodeId(path: string): string {
	return `file:${path}`;
}
]]>
</file>

<file path="/Users/saint/Dev/cartographer-plugin/package.json" language="json">
<![CDATA[
{
	"name": "@kingbootoshi/cartographer",
	"version": "0.1.0",
	"description": "Standalone Cartographer code graph CLI and agent navigation tooling",
	"license": "Apache-2.0",
	"type": "module",
	"module": "src/index.ts",
	"bin": {
		"cartographer": "src/cli/index.ts"
	},
	"files": [
		"src/",
		"plugins/",
		"docs/",
		"README.md",
		"LICENSE"
	],
	"exports": {
		".": "./src/index.ts",
		"./code-graph": "./src/code-graph/index.ts"
	},
	"scripts": {
		"cartographer": "bun run src/cli/index.ts",
		"cartographer:mcp": "bun run src/cli/index.ts mcp",
		"cartographer:index": "bun run src/cli/index.ts index",
		"cartographer:update": "bun run src/cli/index.ts update",
		"cartographer:verify": "bun run src/cli/index.ts verify",
		"cartographer:view": "bun run src/cli/index.ts view",
		"cartographer:diff": "bun run src/cli/index.ts diff",
		"cartographer:slice": "bun run src/cli/index.ts slice",
		"cartographer:impact": "bun run src/cli/index.ts impact",
		"cartographer:context": "bun run src/cli/index.ts context",
		"cartographer:preflight": "bun run src/cli/index.ts preflight",
		"cartographer:adoption": "bun run src/cli/index.ts adoption",
		"cartographer:annotate": "bun run src/cli/index.ts annotate",
		"cartographer:annotations": "bun run src/cli/index.ts annotations",
		"eval:cartographer": "bun run scripts/cartographer-code-graph-evals.ts",
		"eval:cartographer:smoke": "bun run scripts/cartographer-code-graph-evals.ts -- --profile smoke",
		"eval:cartographer:baseline": "bun run scripts/cartographer-code-graph-evals.ts -- --profile baseline",
		"eval:cartographer:codex": "bun run scripts/cartographer-code-graph-evals.ts -- --profile codex",
		"eval:cartographer:codex:live": "bun run scripts/cartographer-code-graph-evals.ts -- --profile codex-live --live",
		"typecheck": "tsc --noEmit",
		"test": "bun test src/code-graph"
	},
	"dependencies": {
		"zod": "4.3.6"
	},
	"devDependencies": {
		"@types/bun": "1.3.13",
		"typescript": "5.8.3"
	},
	"peerDependencies": {
		"typescript": "5.8.3"
	}
}
]]>
</file>

<file path="/Users/saint/.codex/skills/cartographer-v2/SKILL.md" language="md">
<![CDATA[
---
name: cartographer-v2
description: Use the standalone Cartographer v2 graph CLI to orient on a codebase before research, planning, implementation, or review. Trigger when the user asks for Cartographer v2, code graph navigation, graph preflight, repo orientation, graph freshness, graph diffing, agent/subagent context packs, migration/removal completeness audits, or when an orchestrator needs bounded structural evidence before delegating coding work. Do not use for the legacy CODEBASE_MAP-only Cartographer workflow.
---

# Cartographer v2

Use this skill to give an intelligent coding agent better repo navigation through the standalone Cartographer CLI.

Cartographer v2 is a deterministic repo evidence compiler. It helps agents orient faster by surfacing structural facts, graph freshness, impact paths, validation commands, and evidence-backed context. It is not a planner, subagent manager, semantic truth database, or grep replacement.

## Boundary

- Use the CLI as an orientation and evidence tool.
- Keep the orchestrator agent responsible for judgment, planning, user discussion, subagent assignment, and final claims.
- Use grep, direct file reads, tests, and docs after Cartographer. Never treat graph output as a substitute for source inspection.
- Do not write Cartographer artifacts into a target repo unless the user asked for that output location. Prefer `/tmp/...` for exploratory runs.
- When using `/Users/saint/dev/agent-runtime-kernel` or another repo as a target, treat it as read-only unless the user explicitly asks to edit it.
- Do not invoke the legacy `cartographer` skill behavior that creates `docs/CODEBASE_MAP.md` unless the user asks for that older workflow.

## Locate the CLI

Default repo:

```bash
/Users/saint/Dev/cartographer-plugin
```

Run commands from that repo unless `cartographer` is installed on PATH:

```bash
bun run cartographer -- --help
bun run cartographer:index -- --root <target-repo> --out /tmp/cartographer-graph
```

## Research Flow

Use this flow when the user is discussing or scoping work in a repo.

1. Identify the target repo and whether it may be mutated.
2. Build or refresh a graph into a scratch output directory:

```bash
bun run cartographer:index -- --root <target-repo> --out /tmp/cartographer-graph --max-file-bytes 500000
```

3. Check artifact health and freshness when persisted artifacts exist:

```bash
bun run cartographer:verify -- --out /tmp/cartographer-graph --root <target-repo> --fresh --json
```

4. Ask for bounded context around the relevant anchor:

```bash
bun run cartographer:preflight -- --root <target-repo> --live --path <path-or-node-id> --out /tmp/cartographer-graph
bun run cartographer:context -- --out /tmp/cartographer-graph --path <path-or-node-id> --depth 1 --compact --json
```

5. Read the source files Cartographer points at. Verify anything implementation-sensitive directly.
6. Use graph output to inform the plan, subagent prompts, validation commands, and review checklist.

## Command Guide

- `index`: build graph artifacts for a repo.
- `verify --fresh`: detect stale graph artifacts by comparing persisted graph to live source.
- `view`: summarize graph totals and freshness.
- `slice --selector <selector>`: show direct neighbors around a path, package, env var, DB node, IaC node, script, symbol, or config node.
- `impact --path <path-or-node-id>`: show downstream blast radius.
- `context --path <path-or-node-id>`: combine slice and impact for planning.
- `preflight --path <path-or-node-id>`: compact agent-facing context before source reads.
- `diff --base <out-dir> --head <out-dir>`: compare graph snapshots.
- `adoption --trace <runtime-events.json>`: score whether an agent used graph context before source reads.
- `annotations`: audit or review semantic overlay notes when present.
- `mcp`: run the thin newline-delimited stdio wrapper for MCP clients.

Current graph facts include files, directories, packages, package scripts, imports, exports, symbols, env var names, tests, SQL migrations and DB objects, Terraform resources/modules, GitHub Actions workflow tasks, docs references, generated artifacts, and dirty artifacts.

## Selectors

Use exact selectors whenever possible:

```text
path:src/index.ts
package:apps/web
env:DATABASE_URL
dbtable:public.users
dbfunction:public.do_work
iacresource:aws_s3_bucket:assets
config:ci:.github/workflows/ci.yml
script:.:typecheck
symbol:src/index.ts:main
```

Use broad text selectors only when intentionally exploring.

## Orchestrator Use

During research and discussion:

- Use `view`, `preflight`, `context`, and `impact` to understand structure before proposing work.
- Convert graph evidence into a human-readable plan or PRD yourself. Cartographer does not write the plan.
- Include graph freshness, selected anchor, primary files, impact files, tests, validation commands, omissions, and stale warnings in the plan when relevant.

When delegating to subagents:

- Give each subagent a bounded brief, not the whole graph.
- Name the anchor, relevant files, likely tests, package ownership, and off-limits areas.
- Tell subagents to verify with direct source reads and return evidence-backed findings.
- Use `adoption` only as a trace receipt. Adoption is a guardrail, not proof that the task outcome is correct.

## Migration or Removal Work

For service removals like Supabase replacement, use Cartographer to reduce missed surfaces:

1. Search with normal tools for direct references.
2. Use graph selectors for package, env var, DB, SQL, docs, tests, IaC, and CI/deploy surfaces.
3. Use `impact` to find connected files and validation commands.
4. Track completion as evidence classes: dependencies, imports, env vars, migrations, policies, functions, generated types, CI/deploy secrets by name only, tests, mocks, docs, and validation.
5. Treat retained references as explicit exceptions with evidence and reason.

Until dedicated `audit` and `notes` commands exist in the CLI, write ledgers in docs or task notes outside Cartographer and cite graph/source evidence.

## Output Discipline

When reporting Cartographer findings to the user:

- State the target repo and output directory used.
- State whether the graph was live or persisted.
- Mention graph freshness or dirty state.
- List only the high-signal files, nodes, and validation commands.
- Call out omissions and uncertainty.
- Say which direct source reads or tests verified the graph-informed conclusion.

## References

Read `references/cli-reference.md` when you need exact command examples or current implementation notes.
]]>
</file>

<file path="/Users/saint/.codex/skills/cartographer-v2/references/cli-reference.md" language="md">
<![CDATA[
# Cartographer v2 CLI Reference

Use from the standalone repo unless `cartographer` is installed globally:

```bash
cd /Users/saint/Dev/cartographer-plugin
```

## Basic Commands

```bash
bun run cartographer -- --help
bun run cartographer:index -- --root <target-repo> --out /tmp/cartographer-graph --max-file-bytes 500000
bun run cartographer:view -- --out /tmp/cartographer-graph
bun run cartographer:verify -- --out /tmp/cartographer-graph --root <target-repo> --fresh --json
bun run cartographer:preflight -- --root <target-repo> --live --path <path-or-node-id> --out /tmp/cartographer-graph
bun run cartographer:context -- --out /tmp/cartographer-graph --path <path-or-node-id> --depth 1 --compact --json
bun run cartographer:slice -- --out /tmp/cartographer-graph --selector <selector> --json
bun run cartographer:impact -- --out /tmp/cartographer-graph --path <path-or-node-id> --depth 1 --json
bun run cartographer:diff -- --base /tmp/cartographer-before --head /tmp/cartographer-after --json
```

## Adoption Trace

```bash
bun run cartographer:adoption -- --trace trace.json --json
bun run cartographer:adoption -- --trace trace.json --require-graph-first
bun run cartographer:adoption -- --trace trace.json \
  --expect-path src/code-graph/adoption.ts \
  --expect-command "bun test src/code-graph" \
  --expect-executed-command "bun test src/code-graph"
```

## Selector Examples

```text
path:src/index.ts
package:apps/web
env:SUPABASE_URL
dbtable:public.users
dbfunction:public.handle_user
dbpolicy:account_read
dbtrigger:on_user_created
iacresource:aws_s3_bucket:assets
iacmodule:module:cdn
config:ci:.github/workflows/ci.yml
script:.:typecheck
symbol:src/index.ts:main
```

## Current Extracted Evidence

The current implementation extracts:

- filesystem inventory and git dirty state
- directories, files, docs, generated artifacts, dirty artifacts
- workspaces, packages, package scripts, local package dependencies
- imports, type imports, exports, symbols
- inferred and explicit test edges
- env var names only
- SQL migration nodes, tables, functions, policies, triggers, table references
- TypeScript/JavaScript data access calls for `.from()` and `.rpc()` when linked to DB nodes
- Terraform resources, modules, and dependency references
- GitHub Actions workflow, job, and run-step config nodes
- Markdown links and backticked repo-path references as docs edges
- semantic overlay annotations when present and accepted or stale

## Safety Notes

- Prefer `/tmp/cartographer-*` output during research.
- Do not write graph artifacts into another repo unless asked.
- Do not expose secret values. Env var names are acceptable.
- Verify graph claims with source reads before editing.
- Treat `adoption` as process evidence, not task-success evidence.
]]>
</file>

</files>
