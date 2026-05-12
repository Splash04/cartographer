# Cartographer v2 Master PRD

Status: master PRD
Owner: Cartographer
Date: 2026-05-12
Decision source: Oracle optimization review plus ARK graph/token measurements
Supersedes: `docs/prds/cartographer-v2-code-graph.md` as the product source of truth

## Executive Summary

Cartographer v2 is a deterministic repo evidence compiler for highly capable coding agents.

It is not an agent manager, autonomous planner, PRD writer, semantic memory brain, or grep replacement. The orchestrator agent remains the intelligence layer. Cartographer gives that orchestrator and its subagents bounded structural context, graph freshness, drift checks, evidence-backed notes, and task-specific completion ledgers.

The core product decision:

```text
Full graph/index: durable local store
Agent interface: bounded brief/audit/note packets
Debug export: explicit only
```

The v2 command spine is:

```bash
cartographer index
cartographer brief
cartographer audit
cartographer notes
cartographer export
```

Everything else is advanced, debug, legacy, eval-only, or future integration.

## Strategic Decisions

### Decision 1: SQLite Is The Default Durable Store

The current full `graph.json` is too large and too easy to misuse as a prompt artifact. In the ARK measurement run, the current pretty JSON graph was about 2.36M `o200k_base` tokens, and the minified graph was still about 1.67M tokens. The raw tracked ARK repo text was about 1.12M tokens.

This is expected because the current JSON file is acting as:

- durable database
- debug export
- query substrate
- agent prompt object
- provenance ledger
- schema validation target

Those roles must be split.

Default v2 artifacts:

```text
.cartographer/
  manifest.json
  graph.sqlite
  schema/
    brief.schema.json
    audit-ledger.schema.json
    notes.schema.json
  briefs/
  audits/
  notes.jsonl
  reports/
  exports/
    graph.debug.json
    nodes.jsonl
    edges.jsonl
```

`graph.sqlite` is the normal durable graph/index. `graph.debug.json`, `nodes.jsonl`, and `edges.jsonl` are explicit exports only.

### Decision 2: `brief` Is The Normal Agent Interface

Agents should not see the whole graph. Agents should receive compact, ranked, honest context packets.

Default agent-facing outputs must include:

- root, commit, dirty state, graph freshness
- selected anchor
- read-first files
- impact paths
- affected packages
- env/db/iac/ci/doc surfaces when relevant
- tests and validation commands
- accepted and stale notes
- findings and warnings
- omissions and continuation commands
- source-read-required instruction

Default agent-facing outputs must not include:

- full node arrays
- full edge arrays
- every symbol
- every directory containment edge
- repeated provenance blocks
- full repo dumps

### Decision 3: Removal Audits Are First-Class Ledgers

For workflows like removing Supabase from a monorepo, generic graph traversal is not enough. The hard part is completeness across evidence classes.

Cartographer should use graph queries plus literal search to create and verify task-specific audit ledgers. The ledger is the product surface. The graph is the discovery substrate.

### Decision 4: Notes Are Evidence-Backed Claims, Not Graph Facts

Human and agent observations are useful, but they must not pollute deterministic graph traversal.

Notes live as overlay records with evidence hashes and lifecycle state:

```text
candidate -> accepted -> stale | retired
```

Accepted notes may appear in briefs. Stale notes appear only as warnings.

## Problem

Modern coding agents are already strong at grep, source reads, tool chaining, and local reasoning. The remaining failure mode is not that agents cannot search. The failure mode is that large repo work requires many evidence classes to be discovered, scoped, remembered, and rechecked across:

- frontend applications
- backend services
- shared packages
- SQL migrations and DB functions
- auth/user models
- IaC/Terraform resources
- CI and deploy configuration
- environment variables
- generated artifacts
- docs, tests, mocks, and fixtures

Examples:

- A Supabase removal is not complete just because `rg supabase` returns fewer hits.
- A risky auth change is not scoped just because the first relevant file was found.
- A stale module note is dangerous if its source evidence changed.
- A subagent prompt is weaker when it lacks package ownership, tests, validation commands, and known omissions.
- A principal engineer cannot safely call a migration clean without a ledger of checked surfaces and retained exceptions.

Cartographer v2 solves the evidence organization problem around intelligent agents. It helps the orchestrator know what to inspect, what was checked, what remains unknown, and what must be verified before declaring work complete.

## Product Boundary

### Cartographer Should Do

- Build and refresh deterministic repo graph/index artifacts.
- Store the durable graph in a queryable local store.
- Produce bounded briefs around paths, packages, env vars, DB resources, IaC resources, audits, or changed files.
- Rank likely relevant files, packages, tests, validation commands, and impact paths.
- Track graph freshness, git commit, dirty state, evidence hashes, graph hash, and omitted context.
- Create and verify task-specific audit ledgers, starting with removals.
- Store evidence-backed notes from humans or agents as reviewable claims.
- Detect stale notes when cited evidence changes.
- Emit prompt-sized context packets for orchestrator and subagent use.
- Provide stable JSON and readable Markdown.
- Work without any model call.

### Cartographer Should Not Do

- Manage subagents.
- Decide task plans.
- Write PRDs.
- Own approvals.
- Replace grep, source reads, tests, or docs.
- Become a generic vector memory system.
- Treat agent observations as canonical facts.
- Use cloud credentials or runtime provider APIs by default.
- Claim deep call/reference precision unless backed by a precise provider.
- Hide uncertainty, omissions, stale state, or low-confidence extraction.
- Emit full graph dumps in normal agent workflows.

## Users

### Principal Engineer Orchestrator

The orchestrator is the main intelligent layer. It discusses with Saint, researches first, writes PRDs, decides implementation strategy, prompts subagents, reviews findings, and owns final judgment.

Cartographer helps the orchestrator by providing:

- repo overview and freshness
- focused briefs
- evidence classes to check
- package/surface ownership
- impact and blast-radius hints
- validation command candidates
- subagent prompt context
- completion ledgers
- stale note warnings

### Subagents

Subagents are capable scouts and workers. They grep, inspect source, implement, and verify scoped work.

Cartographer helps subagents by providing:

- bounded context for their assigned area
- likely files to open first
- likely tests and validation commands
- known warnings and stale notes
- structured evidence-report expectations

### Humans

Humans use Cartographer output to inspect repo shape, approve PRDs, review cleanup completeness, audit retained references, and understand why an agent was pointed at specific files.

## Operating Model

Cartographer v2 assumes the intelligence layer is outside the tool.

Normal workflow:

1. A principal-engineer orchestrator discusses the problem with Saint.
2. The orchestrator uses Cartographer during research to understand repo structure, evidence classes, impact surfaces, stale notes, and validation paths.
3. The orchestrator decides whether to keep researching, write a PRD, split work across subagents, or implement directly.
4. Subagents receive bounded Cartographer briefs as extra context alongside normal grep, source reads, docs, tests, and direct reasoning.
5. Subagents return evidence-backed reports.
6. Cartographer records or verifies those reports only as notes, ledgers, and receipts.
7. The orchestrator remains responsible for judgment, review, plan changes, and final claims.

Cartographer should not require a natural-language task to be useful. The orchestrator may ask for a brief around a path, package, env var, DB object, audit ledger, changed files, or repo area before it has decided on a plan.

## Current Measurements

The current prototype was measured against `/Users/saint/Dev/agent-runtime-kernel` as a realistic ARK test repo.

ARK state at measurement:

```text
Commit: 9ff50df2c300
Worktree: dirty
Tracked files: 670
Untracked files: 1
Modified files: 2
```

Graph totals:

```text
Files: 671
Nodes: 4,664
Edges: 10,802
Findings: 0
```

Measured with OpenAI `tiktoken` using `o200k_base`:

| Output | Size | Tokens |
| --- | ---: | ---: |
| Raw tracked ARK repo text | 4.5 MB | 1,118,417 |
| Full `graph.json` pretty JSON | 8.5 MB | 2,357,195 |
| Full `graph.json` minified | 6.1 MB | 1,666,255 |
| Persisted graph+manifest+schema | 8.5 MB | 2,359,776 |
| `CODEBASE_MAP.md` summary | 6.8 KB | 2,056 |
| `cartographer view` | 675 B | 283 |
| `verify --fresh --json` | 1.4 KB | 505 |
| `context` for `src/kernel/turn-executor.ts` depth 1 | 15.6 KB | 4,162 |
| `preflight` for `src/kernel/turn-executor.ts` | 16.2 KB | 4,356 |
| `impact` for `src/kernel/turn-executor.ts` depth 1 | 145.8 KB | 41,082 |

Breakdown of the minified graph:

```text
Nodes: ~509K tokens
Edges: ~1.16M tokens
```

Largest buckets:

```text
Symbol nodes:     ~383K tokens
DEFINES edges:    ~406K tokens
IMPORTS edges:    ~204K tokens
EXPORTS edges:    ~140K tokens
TYPE_IMPORTS:     ~122K tokens
DOCUMENTS edges:  ~97K tokens
TESTS edges:      ~90K tokens
```

Conclusion: the graph concept is correct, but the current verbose JSON artifact must not be the normal durable store or agent-facing object.

## Core Concepts

### Graph Index

The graph index is the durable local store of deterministic repo facts and relationships.

The graph index exists to support queries. It is not meant to be pasted into agent context.

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
- matchers
- evidence classes
- active findings
- removed/replaced/retained status
- unknown hits
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

Notes are never deterministic graph facts.

## Command Surface

### `cartographer index`

Build or refresh deterministic graph artifacts.

Example:

```bash
cartographer index --root . --out .cartographer
```

Requirements:

- Must write `manifest.json` and `graph.sqlite` by default.
- Must not write `graph.json` by default.
- Must not mutate the target repo except the chosen output directory.
- Must record root, graph hash, git commit, dirty state, generated time, scanner version, file count, node count, edge count, and findings.
- Must ignore default generated/vendor paths.
- Must store env var names only.
- Must be safe to run repeatedly after branch changes.
- Must support incremental indexing later via file hashes and extractor versions.

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

Default budgets:

| Field | Default |
| --- | ---: |
| Brief target budget | 8,000 tokens |
| Brief hard default cap | 12,000 tokens |
| Absolute non-debug cap | 24,000 tokens |
| Primary path cap | 15 |
| Impact path cap | 25 |
| Test path cap | 20 |
| Package cap | 10 |
| Validation command cap | 12 |
| Notes cap | 10 accepted, 10 stale |
| Finding cap | 20 |
| Impact depth default | 1 |
| Impact depth normal max | 2 |

Brief output must include:

- graph snapshot and freshness
- selected anchor
- read-first paths
- impact paths
- affected packages
- tests
- validation commands
- dependencies when relevant
- env/db/iac/ci/doc surfaces when relevant
- accepted notes
- stale notes
- findings
- omitted context counts
- continuation commands
- confidence and provenance summary
- source-read-required instruction

Brief output must not include full graph nodes or edges by default.

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
- replacement-surface requirements
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
- Must report ledger snapshot drift when source changed after ledger creation.

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
  "target": "path:apps/web/src/auth/client.ts",
  "claims": [
    {
      "kind": "edit-warning",
      "summary": "This auth client used to wrap Supabase and must be checked during auth migration.",
      "evidence": [
        { "path": "apps/web/src/auth/client.ts", "lineStart": 1, "lineEnd": 60 }
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

### `cartographer export`

Export graph data for debugging, evals, or interchange.

Examples:

```bash
cartographer export graph --format debug-json --out .cartographer/exports/graph.debug.json
cartographer export graph --format jsonl --out .cartographer/exports
```

Requirements:

- Must be explicit.
- Must not run as part of default `index`.
- Must warn that debug graph exports are not agent prompt artifacts.
- Must support compact JSONL for large repos.

## Advanced And Legacy Commands

These may remain available for debugging, evals, or compatibility, but they are not the main v2 product story:

- `slice`
- `impact`
- `context`
- `preflight`
- `adoption`
- `annotate`
- `annotations`
- `mcp`

Recommended mapping:

| Existing command | v2 treatment |
| --- | --- |
| `slice` | advanced/debug graph primitive |
| `impact` | advanced/debug graph primitive; bounded by default |
| `context` | compatibility wrapper around `brief` internals |
| `preflight` | alias or machine-mode rendering of `brief` |
| `adoption` | eval/harness tool, not daily user command |
| `annotate` | experimental only |
| `annotations` | migrate to `notes` |
| `mcp` | optional integration, not required for v2 |

Do not ship these as separate core concepts:

- `dossier`
- `scout-kit`
- `prompt-pack`
- `prd-context`

Those are `brief --mode ...` renderings.

## Data Model

### Durable Store

Use a normalized relational store with generic graph tables plus typed fact tables.

Minimum tables:

```sql
CREATE TABLE manifest (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE paths (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  kind TEXT,
  size_bytes INTEGER,
  line_count INTEGER,
  hash TEXT,
  git_status TEXT,
  readable_text INTEGER NOT NULL DEFAULT 1,
  generated INTEGER NOT NULL DEFAULT 0,
  ignored INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  path_id INTEGER,
  metadata_json TEXT,
  provenance_class_id INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(path_id) REFERENCES paths(id)
);

CREATE INDEX idx_nodes_kind ON nodes(kind);
CREATE INDEX idx_nodes_path_id ON nodes(path_id);

CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  label TEXT,
  metadata_json TEXT,
  provenance_class_id INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(from_id) REFERENCES nodes(id),
  FOREIGN KEY(to_id) REFERENCES nodes(id),
  UNIQUE(kind, from_id, to_id, label)
);

CREATE INDEX idx_edges_kind ON edges(kind);
CREATE INDEX idx_edges_from ON edges(from_id);
CREATE INDEX idx_edges_to ON edges(to_id);
CREATE INDEX idx_edges_to_kind ON edges(to_id, kind);
CREATE INDEX idx_edges_from_kind ON edges(from_id, kind);

CREATE TABLE provenance_classes (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  confidence TEXT NOT NULL,
  freshness TEXT,
  extractor TEXT,
  extractor_version TEXT,
  scanner_version TEXT,
  default_for_snapshot INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source, confidence, freshness, extractor, extractor_version, scanner_version)
);

CREATE TABLE evidence (
  id INTEGER PRIMARY KEY,
  path_id INTEGER NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  hash TEXT,
  excerpt_hash TEXT,
  FOREIGN KEY(path_id) REFERENCES paths(id)
);

CREATE TABLE node_evidence (
  node_id TEXT NOT NULL,
  evidence_id INTEGER NOT NULL,
  PRIMARY KEY(node_id, evidence_id)
);

CREATE TABLE edge_evidence (
  edge_id INTEGER NOT NULL,
  evidence_id INTEGER NOT NULL,
  PRIMARY KEY(edge_id, evidence_id)
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  node_id TEXT,
  evidence_json TEXT
);
```

Typed accelerator tables:

```sql
CREATE TABLE packages (
  node_id TEXT PRIMARY KEY,
  name TEXT,
  directory_path_id INTEGER,
  manifest_path_id INTEGER,
  manager TEXT
);

CREATE TABLE package_scripts (
  node_id TEXT PRIMARY KEY,
  package_node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  run_command TEXT,
  path_id INTEGER
);

CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  file_node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  exported INTEGER NOT NULL,
  line_start INTEGER,
  line_end INTEGER
);

CREATE INDEX idx_symbols_file ON symbols(file_node_id);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_exported ON symbols(exported);

CREATE TABLE imports (
  source_file_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  specifier TEXT NOT NULL,
  type_only INTEGER NOT NULL DEFAULT 0,
  external INTEGER NOT NULL DEFAULT 0,
  line_start INTEGER,
  PRIMARY KEY(source_file_id, target_node_id, specifier, type_only)
);

CREATE INDEX idx_imports_target ON imports(target_node_id);

CREATE TABLE env_uses (
  file_node_id TEXT NOT NULL,
  env_node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  line_start INTEGER,
  PRIMARY KEY(file_node_id, env_node_id, line_start)
);

CREATE TABLE test_targets (
  target_node_id TEXT NOT NULL,
  test_file_node_id TEXT NOT NULL,
  confidence TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY(target_node_id, test_file_node_id)
);

CREATE TABLE db_facts (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  schema_name TEXT,
  object_name TEXT NOT NULL,
  action TEXT,
  path_id INTEGER,
  line_start INTEGER
);

CREATE TABLE iac_facts (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  resource_type TEXT,
  name TEXT NOT NULL,
  path_id INTEGER,
  line_start INTEGER
);

CREATE TABLE ci_facts (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  workflow TEXT,
  job_id TEXT,
  step_index INTEGER,
  task_kind TEXT,
  command TEXT,
  path_id INTEGER,
  line_start INTEGER
);
```

### Core Node Kinds

Keep as core:

- `RepoSnapshot`
- `Workspace`
- `Package`
- `PackageScript`
- `File`
- `Directory`
- `Doc`
- `GeneratedArtifact`
- `DirtyArtifact`
- `ExternalDependency`
- `EnvVar`
- `Migration`
- `DbTable`
- `DbFunction`
- `DbPolicy`
- `DbTrigger`
- `IaCModule`
- `IaCResource`

Use typed tables rather than broad graph nodes for:

- symbols
- CI workflows, jobs, and run steps
- file/package membership
- validation commands

Move out of core:

| Kind | Treatment |
| --- | --- |
| `AgentAnnotation` | note record, not graph node |
| `Finding` | finding record, not graph node |
| `BoundaryPolicy` | postpone until deterministic extractor exists |
| `Route` | postpone unless extractor is reliable |
| `Entrypoint` | metadata until stronger extraction exists |
| `Config` | avoid broad generic kind; prefer typed CI/IaC/package records |

### Core Edge Kinds

Keep conservative graph edges:

- `CONTAINS`
- `IMPORTS`
- `TYPE_IMPORTS`
- `EXPORTS`
- `TESTS`
- `DEPENDS_ON`
- `USES_ENV`
- `DOCUMENTS`
- `MIGRATION_CREATES`
- `MIGRATION_ALTERS`
- `MIGRATION_DROPS`
- `TABLE_REFERENCES_TABLE`
- `RESOURCE_DEPENDS_ON`
- `AFFECTS`
- `CONFIGURES`
- `GENERATED_BY`

Avoid or postpone:

- `CALLS`
- `REFERENCES`
- `GUARDED_BY`
- `OWNED_BY`
- `ROUTES_TO`
- `SERVICE_QUERIES_TABLE`
- `SERVICE_CALLS_RPC`
- `TASK_DEPENDS_ON`
- `MIGRATION_SUPERSEDES`

These may return later only when backed by a precise provider or explicit evidence. Path/package ownership should usually be derived, not materialized as many edges.

### Symbol Handling

Symbols are useful, but representing every symbol as a full graph node plus `DEFINES` and `EXPORTS` edges is too expensive.

Recommended model:

```text
symbols table:
  id
  file_node_id
  name
  kind
  exported
  line_start
  line_end
```

Brief output should promote symbols only when:

- the anchor is a symbol
- the symbol is exported API surface
- import/export query requires it
- the symbol belongs to a read-first file

Prompt rendering should prefer:

```text
src/foo.ts
  exports: Foo, createFoo, FooOptions
```

instead of full symbol nodes.

### Provenance And Evidence

Current per-node/per-edge provenance repetition must be normalized.

Use three levels:

1. Snapshot-level defaults in `manifest.json`.
2. `provenance_classes` referenced by facts.
3. Evidence records attached only where useful.

Manifest example:

```json
{
  "schemaVersion": "cartographer.graph.v2",
  "graphHash": "...",
  "generatedAt": "2026-05-12T00:00:00.000Z",
  "scanner": {
    "name": "cartographer",
    "version": "0.2.0"
  },
  "git": {
    "commit": "...",
    "dirty": true,
    "modifiedFiles": 2,
    "untrackedFiles": 1
  },
  "defaultProvenance": {
    "source": "syntax",
    "confidence": "parser-backed",
    "freshness": "fresh",
    "scannerVersion": "0.2.0"
  }
}
```

Confidence vocabulary:

- `exact`
- `compiler-backed`
- `parser-backed`
- `heuristic`
- `human-reviewed`
- `agent-inferred`

Freshness should mostly be computed from graph snapshot, git state, and file hashes. Do not stamp every edge with `fresh`.

## Brief Packet Schema

All agent-facing brief modes should render from one internal object.

Required shape:

```json
{
  "schemaVersion": "cartographer.brief.v1",
  "kind": "brief",
  "mode": "implementation",
  "generatedAt": "2026-05-12T00:00:00.000Z",
  "snapshot": {
    "root": ".",
    "graphHash": "...",
    "commit": "9ff50df2c300",
    "dirty": true,
    "generatedAt": "...",
    "live": true,
    "scannerVersion": "0.2.0",
    "freshness": "fresh-with-dirty-worktree"
  },
  "anchor": {
    "type": "path",
    "value": "src/kernel/turn-executor.ts",
    "resolved": [
      {
        "nodeId": "file:src/kernel/turn-executor.ts",
        "kind": "File",
        "path": "src/kernel/turn-executor.ts",
        "label": "turn-executor.ts",
        "confidence": "exact"
      }
    ]
  },
  "budget": {
    "requestedTokens": 12000,
    "estimatedTokens": 4380,
    "hardLimitTokens": 24000,
    "truncated": false
  },
  "readFirst": [],
  "impact": [],
  "packages": [],
  "dependencies": [],
  "surfaces": {
    "env": [],
    "db": [],
    "iac": [],
    "ci": [],
    "docs": []
  },
  "tests": [],
  "validation": [],
  "notes": {
    "accepted": [],
    "stale": []
  },
  "findings": [],
  "omissions": [],
  "instructions": {
    "sourceReadRequired": true,
    "summary": "Use this for orientation. Verify implementation-sensitive claims with direct source reads."
  }
}
```

Path record shape:

```json
{
  "rank": 1,
  "path": "src/kernel/turn-executor.ts",
  "nodeId": "file:src/kernel/turn-executor.ts",
  "kind": "File",
  "reason": "selected anchor",
  "relationship": "anchor",
  "depth": 0,
  "confidence": "exact",
  "evidence": [
    {
      "path": "src/kernel/turn-executor.ts"
    }
  ]
}
```

Omission shape:

```json
{
  "section": "impact",
  "omittedCount": 83,
  "reason": "budget",
  "nextCommand": "cartographer brief --path src/kernel/turn-executor.ts --section impact --limit 100"
}
```

Prompt rendering should be path- and reason-centric, not edge-centric.

## Monorepo Scale Requirements

Monorepos require partitioning, not just compression.

Every file should have derived membership in:

- workspace
- package
- service or app
- surface

Recommended surfaces:

- `frontend`
- `backend`
- `shared`
- `database`
- `iac`
- `ci`
- `docs`
- `generated`
- `tests`
- `fixtures`
- `scripts`

File membership table:

```sql
CREATE TABLE file_membership (
  path_id INTEGER NOT NULL,
  package_node_id TEXT,
  workspace_node_id TEXT,
  surface TEXT,
  generated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(path_id, surface)
);
```

Monorepo query flow:

```text
anchor
  -> owning package/service
  -> direct local facts
  -> cross-boundary facts
  -> tests/validation
  -> audit surfaces if relevant
  -> bounded ranked packet
```

Prioritize cross-boundary facts:

- package A imports package B
- package A uses env var X
- package A depends on external package Y
- package A references DB object Z
- package A has validation command C
- CI job touches package A
- IaC resource references service A
- docs mention package A

Do not waste agent budget on every local symbol and directory edge.

Generated/vendor handling:

- Index generated files conservatively.
- Store path, hash, and generator if known.
- Do not deeply extract symbols/imports by default.
- Include generated files in audits when target terms appear.
- Include generated files in briefs only when directly relevant.
- Treat lockfiles as audit evidence, not normal graph context.

Incremental indexing:

```sql
CREATE TABLE index_cache (
  path_id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  facts_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
```

If file hash and extractor version match, reuse facts.

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
| Lockfile references | No active lockfile references unless corresponding dependency retention is explained. |
| Imports and SDK clients | No active imports, client factories, wrappers, mocks, or generated client helpers. |
| Env vars | No active `SUPABASE_*` runtime env names in app, CI, deploy config, or active docs unless retained with reason. |
| CI/deploy secrets | Secret names checked; no raw secret values stored. |
| SQL migrations | Supabase-specific migrations, functions, triggers, grants, and policies reviewed and migrated or retained. |
| RLS policies | RLS policy objects accounted for; no orphaned Supabase auth assumptions. |
| DB functions/triggers | Functions and triggers using Supabase assumptions replaced, removed, or retained with reason. |
| Edge functions | Function directories, deploy config, callers, tests, and docs removed or retained with reason. |
| Storage buckets | Bucket policy, upload, signed URL, mocks, and docs accounted for. |
| Generated DB types | Supabase-generated types removed or replaced with local Postgres generation. |
| Auth/user model | Replacement auth and user model surfaces connected and tested. |
| Tests/mocks/fixtures | Supabase-specific tests and mocks removed or rewritten. |
| Docs active | Active docs updated. |
| Docs historical | Historical retained references explicitly listed. |
| Unknown literal hits | Unknown hits classified or marked needs-review. |
| Replacement auth | Clerk or selected auth replacement has evidence and validation. |
| Replacement DB | Local Postgres replacement has evidence and validation. |
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

## Audit Ledger Schema

```json
{
  "schemaVersion": "cartographer.audit-ledger.v1",
  "id": "supabase-removal",
  "kind": "removal",
  "target": {
    "raw": "supabase",
    "matchers": [
      "@supabase/*",
      "supabase",
      "SUPABASE_*",
      "auth.uid",
      "storage.objects",
      "supabase/functions"
    ]
  },
  "createdAt": "2026-05-12T00:00:00.000Z",
  "updatedAt": "2026-05-12T00:00:00.000Z",
  "snapshot": {
    "root": ".",
    "graphHash": "...",
    "commit": "...",
    "dirty": true
  },
  "verdict": {
    "status": "needs-review",
    "blockers": []
  },
  "classes": [
    {
      "class": "package-dependency",
      "status": "found",
      "summary": "Found @supabase/supabase-js in apps/web/package.json.",
      "active": [],
      "removed": [],
      "retained": [],
      "unknown": [],
      "omitted": {
        "count": 0,
        "reason": null
      },
      "verification": {
        "checkedAt": "2026-05-12T00:00:00.000Z",
        "method": "graph+literal-search",
        "query": "package dependencies matching supabase",
        "resultCount": 1
      }
    }
  ],
  "replacementRequirements": [
    {
      "surface": "auth",
      "expectedReplacement": "Clerk",
      "status": "needs-review",
      "evidence": []
    },
    {
      "surface": "database",
      "expectedReplacement": "local Postgres",
      "status": "needs-review",
      "evidence": []
    }
  ],
  "validation": [],
  "exceptions": []
}
```

## Note Schema

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
  "author": {
    "type": "agent",
    "name": "codex",
    "runId": "..."
  },
  "createdAt": "2026-05-12T00:00:00.000Z",
  "updatedAt": "2026-05-12T00:00:00.000Z"
}
```

Supported note kinds:

- `purpose`
- `invariant`
- `edit-warning`
- `workflow`
- `test-guidance`
- `generated-ownership`
- `iac-link`
- `risk`

## Output Guardrails

### Defaults

- `brief`, `context`, `preflight`, `slice`, and `impact` must be budgeted by default.
- `--json` means machine-readable within the same budget, not unlimited output.
- Broad selectors must require explicit `--allow-broad`.
- Debug graph payloads must require explicit `--debug-graph` or `cartographer export`.

### Hard Stops

The CLI should warn or fail when:

- graph is stale
- worktree is dirty and persisted mode is used
- selector matches too many nodes
- output budget would omit high-priority paths
- impact depth expands too broadly
- generated/vendor files dominate the selection
- an audit ledger is based on an older graph snapshot
- notes are stale
- requested output exceeds the hard cap

### Large Output Escape Hatches

Allowed only with explicit flags:

```bash
cartographer export graph --format debug-json
cartographer context --debug-graph --max-tokens 100000
cartographer impact --depth 4 --allow-large-output
cartographer slice --selector all --allow-broad --debug-graph
```

## Artifacts

Default output directory:

```text
.cartographer
```

Required artifacts:

```text
.cartographer/manifest.json
.cartographer/graph.sqlite
.cartographer/schema/brief.schema.json
.cartographer/schema/audit-ledger.schema.json
.cartographer/schema/notes.schema.json
.cartographer/briefs/
.cartographer/audits/
.cartographer/notes.jsonl
.cartographer/reports/
.cartographer/exports/
```

Optional human map:

```text
docs/codegraph/CODEBASE_MAP.md
```

Optional debug exports:

```text
.cartographer/exports/graph.debug.json
.cartographer/exports/nodes.jsonl
.cartographer/exports/edges.jsonl
```

The committed human map is optional. The deterministic graph index, briefs, ledgers, and notes are the core product.

## Requirements

### Functional Requirements

- `index` builds a valid `graph.sqlite` and `manifest.json` for this repo and selected external repos by path.
- `index` does not emit full `graph.json` by default.
- `brief` can compile context around path, package, env var, DB node, IaC node, audit, and changed-file anchors.
- `brief` respects prompt budgets and records omissions.
- `brief` has prompt and JSON renderers over the same packet.
- `slice`, `impact`, `context`, and `preflight` are bounded by default.
- `export graph` can produce debug JSON/JSONL when explicitly requested.
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
- Full graph export must be opt-in.

## Evals

### Suite 1: Graph Store Contract

Purpose: prove graph artifacts are structurally safe.

Targets:

- schema validation: 100%
- SQLite integrity check: 100%
- duplicate node IDs: 0
- duplicate typed fact IDs: 0
- dangling edges: 0
- ignored-path contamination: 0
- raw secret values: 0
- evidence paths exist: 100%

### Suite 2: Token Efficiency

Purpose: prove normal commands cannot blow up agent context.

Metrics:

- default brief tokens
- default preflight tokens
- default impact tokens
- debug graph export tokens
- omission count accuracy
- budget compliance rate

Targets:

- `brief` under configured budget: 100%
- `preflight` under 8K default: 100%
- normal `impact` under 12K default: 100%
- full debug export never emitted by normal commands: 100%
- omission counts present when capped: 100%

ARK regression target:

- The current 41,082-token `impact` output for `src/kernel/turn-executor.ts` must become a bounded normal packet under 8K-12K tokens, with omission counts and continuation commands.

### Suite 3: Brief Context Precision

Purpose: prove `brief` gives compact, useful context.

Metrics:

- top-5 gold-file recall
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

### Suite 4: Removal Audit Fixture

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

### Suite 5: Agent Baseline Comparison

Purpose: prove intelligent agents perform better with Cartographer than grep alone.

Profiles:

- `baseline-direct`: normal agent tools, no Cartographer instruction
- `cartographer-brief`: agent is told to run or receives a Cartographer brief
- `cartographer-brief-plus-audit`: agent receives both a brief and an audit ledger

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

### Suite 6: Drift And Staleness

Purpose: prove notes and ledgers do not rot silently.

Checks:

- accepted notes become stale when evidence hashes change
- stale notes appear as warnings in `brief`
- audit verification does not trust stale notes
- ledger verification reports changed evidence
- branch changes force freshness warnings when graph is stale

### Suite 7: Security And Privacy

Purpose: ensure safe indexing and reporting.

Checks:

- env var names allowed
- secret values redacted
- `.env` files handled conservatively
- CI/deploy secret names only
- no credentialed cloud/runtime drift checks by default
- destructive commands excluded from validation suggestions

### Suite 8: Monorepo Scale

Purpose: prove the system works across frontend, backend, shared packages, DB, IaC, CI, docs, and generated artifacts.

Metrics:

- index time
- incremental index reuse rate
- package/surface classification accuracy
- cross-package edge recall
- token budget compliance by surface
- audit class recall across surfaces
- generated/vendor noise rate

Targets:

- normal briefs remain under budget on monorepo fixtures
- generated/vendor paths do not dominate briefs
- cross-surface evidence classes are not silently omitted

## Implementation Plan

### Phase 0: Product Surface Reset

- [ ] Mark this PRD as the v2 source of truth.
- [ ] Update feature docs to describe `index`, `brief`, `audit`, `notes`, and `export`.
- [ ] Demote `slice`, `impact`, `context`, `preflight`, `adoption`, `annotate`, and `annotations` in docs.
- [ ] Rename overlay language from annotations to notes in product docs.
- [ ] Keep existing commands as compatibility shims while the new surface lands.

### Phase 1: Output Brakes And `brief`

- [ ] Add `brief` command as the primary context compiler.
- [ ] Add `--mode planning|implementation|review|prd`.
- [ ] Add `--budget`, `--max-paths`, `--max-tests`, `--max-validation`, and omission metadata.
- [ ] Make normal `slice`, `impact`, `context`, and `preflight` bounded by default.
- [ ] Add broad-selector guards.
- [ ] Remove full nested graph payloads from normal outputs.
- [ ] Include graph freshness, git commit, dirty state, and live/persisted mode in every brief.
- [ ] Render compact JSON and prompt Markdown.
- [ ] Preserve `preflight` as an alias or machine-mode rendering of `brief`.

Acceptance criteria:

- `bun run typecheck` passes.
- Existing graph tests pass.
- New brief tests cover every anchor kind supported in Phase 1.
- ARK `turn-executor` brief stays under 8K-12K tokens.
- Brief fixture top-10 gold-file recall is at least 90%.
- Brief output includes zero hallucinated paths.

### Phase 2: Schema Diet

- [ ] Move `AgentAnnotation` out of graph nodes into notes.
- [ ] Move `Finding` out of graph nodes into findings.
- [ ] Demote `BoundaryPolicy`, `Route`, `Entrypoint`, and broad `Config`.
- [ ] Remove or hide `CALLS`, `REFERENCES`, `GUARDED_BY`, `OWNED_BY`, and `TASK_DEPENDS_ON` unless provider-backed.
- [ ] Move symbols into typed symbol records.
- [ ] Derive ownership from path/package metadata instead of many explicit ownership edges.
- [ ] Keep debug compatibility through export if needed.

Acceptance criteria:

- Normal brief token count drops or remains stable.
- Query behavior remains compatible for supported anchors.
- Debug export can still show equivalent information for eval/debug.

### Phase 3: Normalize Provenance

- [ ] Add snapshot-level default provenance.
- [ ] Add provenance class records.
- [ ] Add evidence records and joins.
- [ ] Stop repeating default provenance on every fact.
- [ ] Compute freshness from file hashes and graph snapshot instead of per-edge stamps.

Acceptance criteria:

- Graph export size drops materially.
- Freshness checks still detect stale source.
- Evidence-backed notes and ledgers can cite hashes.

### Phase 4: SQLite Durable Store

- [ ] Add `graph.sqlite` writer while keeping the existing in-memory builder.
- [ ] Write `manifest.json` alongside SQLite.
- [ ] Make `view` read SQLite.
- [ ] Make `brief` read SQLite.
- [ ] Make `verify` validate SQLite.
- [ ] Make `export graph` read SQLite.
- [ ] Keep `graph.json` only behind explicit export.

Acceptance criteria:

- `index` default output is `manifest.json` plus `graph.sqlite`.
- No default `graph.json` is produced.
- Existing graph contract evals are migrated to SQLite.
- Debug export is opt-in and stable.

### Phase 5: Removal Audit Plus Ledger

- [ ] Add `audit removal --target <thing>`.
- [ ] Add removal ledger schema.
- [ ] Add evidence classes for dependencies, imports, env vars, SQL, RLS, functions, triggers, storage, edge functions, generated types, CI/deploy, docs, tests, mocks, and unknown hits.
- [ ] Add intentional-retention records.
- [ ] Add replacement-surface requirements.
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

### Phase 6: Notes

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

### Phase 7: Incremental Indexing And Monorepo Scale

- [ ] Add file-hash based fact reuse.
- [ ] Add extractor-version invalidation.
- [ ] Add file/package/surface membership.
- [ ] Add generated/vendor noise controls.
- [ ] Add monorepo fixture and scale evals.

Acceptance criteria:

- Re-indexing unchanged repos reuses prior facts.
- Large monorepo briefs remain under budget.
- Package/surface classification is accurate enough for scoped briefs and audits.

### Phase 8: Agent Harness And Outcome Evals

- [ ] Update eval runner around `brief`, `audit removal`, and `notes`.
- [ ] Add baseline-direct, cartographer-brief, and cartographer-brief-plus-audit profiles.
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
- Which SQLite library should be used in Bun for the durable store?
- How should debug export compatibility be versioned across schema changes?

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
- Full graph in prompt context.
- Default `graph.json` artifact.

## Launch Criteria

Cartographer v2 is ready for dogfood when:

- `index`, `brief`, `audit removal`, `audit verify`, and `notes audit` work in this repo.
- Default `index` writes `graph.sqlite`, not `graph.json`.
- Normal `brief`, `context`, `preflight`, `slice`, and `impact` outputs are budgeted.
- The same commands run read-only against ARK and Axia-style monorepo targets.
- ARK token-efficiency regression passes.
- Supabase removal fixture eval passes.
- Brief context precision eval passes.
- Drift/staleness eval passes.
- Security/privacy eval passes.
- Monorepo scale eval passes.
- Existing smoke and Codex trace evals still pass or are intentionally migrated.
- Product docs describe the simplified surface without presenting Cartographer as an orchestrator.

## Final Product Statement

Before an agent changes a large repo, Cartographer gives it bounded structural context and the validation surface. For removals and migrations, Cartographer gives the orchestrator a completion ledger so important evidence classes are not missed.

Cartographer is the deterministic map, queryable graph index, audit ledger, and evidence compiler. The orchestrator agent is the intelligence layer. Subagents are scouts and workers that consume briefs and return evidence.
