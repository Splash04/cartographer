# Cartographer Code Graph CLI

The Cartographer code graph CLI gives agents a deterministic repo map plus a provider-backed semantic overlay for Codex-style annotation workflows. OpenRouter is the current annotation backend, not the architecture boundary.

The important split is:

- deterministic graph facts: files, imports, symbols, packages, scripts, SQL/IaC resources, Terraform resource/module dependencies, env vars, and git freshness
- agent overlay notes: purpose, edit warnings, generated ownership, workflow guidance, validation advice, and risk notes

Tree-sitter-style parsing belongs in the first bucket. Codex/OpenRouter annotations belong in the second bucket and must stay evidence-linked, reviewable, and stale-markable. The graph must be useful without annotations; overlay notes add workflow meaning, edit warnings, ownership guidance, and validation recipes after the structural graph has already found the relevant code and IaC surfaces.

## Commands

```bash
bun run cartographer:index -- --root . --out docs/codegraph
bun run cartographer:update -- --root . --out docs/codegraph
bun run cartographer:view -- --out docs/codegraph
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

Use `--json` for harnesses, eval runners, and other automated consumers. The markdown output is for humans. `cartographer preflight` always emits compact JSON and is the default graph-first agent preflight; it exposes `manifest`, `summary.primaryPaths`, `summary.impactPaths`, `summary.testPaths`, `summary.affectedPackages`, focused `summary.validationCommands`, `summary.annotationNotes`, `summary.findings`, slice/impact totals, compact-output `omissions`, and a `preflight` metadata block with command, timestamps, total duration, and phase timings. Full `context --json` is the scoring mode when a harness needs nested `slice` and `impact` payloads with `selector`, `title`, `nodes`, `edges`, `annotations`, `findings`, and `summary` fields for recall, precision, slice size, package context, semantic-note coverage, and validation-command coverage. Top-level `summary.testPaths` is derived from `TESTS` edges and gives agents directly relevant test files without forcing them to parse nested edge payloads. `TESTS` edges come from explicit test imports and a conservative `__tests__` naming convention, so a facade-style test can still point agents at the source file it covers when that source file exists. Top-level `summary.annotationNotes` is derived from accepted or stale overlay annotations whose target nodes appear in the selected slice or impact view; candidate and retired notes stay out of normal preflight context. Nested `summary.affectedPackages` ranks owning packages by direct and ancestor coverage, while `summary.validationCommands` lists the package script id, package id, command name, raw package-script body as `command`, root-executable command as `runCommand`, and source `package.json` path. In compact preflight, validation commands are capped and focused for agent navigation, and `omissions.validationCommands` records how many broader commands were left out. The human preflight brief prefers `runCommand`, so package scripts appear as pasteable Bun invocations such as `bun run typecheck` or `cd apps/web && bun run typecheck` while preserving raw script metadata for tooling. `adoption --json` consumes raw runtime traces shaped as an event array or objects with `events`/`runtimeEvents` and emits the deterministic graph-adoption summary used by future live-agent scoring, including trace duration, first graph command offset, successful preflight result count and timings, shell-wrapped source-read detection, skill-instruction read exclusions, structured graph preflight failures, and first source-read-before-graph offset when timestamps are present. `--require-graph-first` turns that summary into a manual strict gate and includes `graphFirstAdoption` in JSON output. Repeatable `--expect-text`, `--expect-path`, and `--expect-command` flags check the final trace response for expected text, file paths, or validation-command mentions. Repeatable `--expect-executed-command` checks actual tool-command execution. The combined `finalResponseExpectation.metrics` object includes aggregate final-response hits, path tool/source-read hits, command mention hits, and executed-command hits. Expected-path checks also report whether each path appeared in the final response, any tool command, and any direct source-read command, which helps separate "the agent named the file" from "the agent actually navigated to it." Expected-command checks report whether each command appeared in the final response or an actual tool command; executed-command checks fail unless the command appears in tool execution history. These are manual gates, not generated eval reports.

Agent runtimes can opt into the same preflight without asking the model to run the command manually. A runtime wrapper should build compact Cartographer context against the active workspace before adapter execution, inject it into the prompt as a `cartographer-preflight` system reminder, and emit `tool_use`/`tool_result` runtime events shaped so `cartographer adoption --trace` can measure graph use. This is a harness workflow hook, not an eval report.

Slices and impact views include owning and ancestor packages plus focused validation scripts such as `build`, `lint`, `typecheck`, and `test:*`. Database slices also include safe schema/type/status scripts such as `db:types` and `db:status`; runtime-only or destructive scripts such as `dev`, `start`, `preview`, `postinstall`, `db:reset`, and `db:seed` are intentionally omitted. Terraform `RESOURCE_DEPENDS_ON` edges connect resource and module nodes to referenced resources/modules, so `impact --path iacresource:<type>:<name>` can show downstream infrastructure that depends on that resource.

Node-id selectors such as `env:DATABASE_URL`, `dbtable:public.accounts`, `script:.:test`, `symbol:src/index.ts:main`, and `iacresource:aws_s3_bucket:assets` are exact selectors. `path:src/index.ts` is accepted in `context --path` and drives both the selected slice and impact view. Use plain text only when broad search is intentional.

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
