# Cartographer Code Graph Eval Suites

Status: plan pending implementation approval
Owner: Cartographer
Last updated: 2026-05-12

## Goal

Measure whether Cartographer v2 makes large codebases easier for agents to navigate, update, and understand without relying on vibes or one-off demos.

The suite should answer four production questions:

- Can the graph extract a faithful, bounded map of a repo at practical speed?
- Do task slices surface the files, infra resources, env vars, tests, and risks an agent needs?
- Do Codex-style agent workflows actually use the graph before editing?
- Do agent-authored annotations add grounded workflow meaning without pretending to be parser or compiler facts?
- Does the graph stay durable as repos grow, change, and include monorepos plus IaC?

## What Better Means

Better means an agent reaches the right context faster, with fewer irrelevant reads, fewer fabricated paths, and clearer validation commands.

The goal is not to maximize edge count or make pretty maps. A graph that dumps half the repo into every task slice is worse than a smaller graph with high gold-file recall and acceptable precision.

## Trace Survey

The local trace survey is recorded at:

```text
.evals/research/cartographer-code-graph-trace-survey.md
.evals/research/cartographer-axia-stress-run.md
.evals/research/cartographer-gold-task-candidates.md
.evals/research/cartographer-runner-implementation-handoff.md
.evals/research/cartographer-manual-contract-checks.md
.evals/research/cartographer-exa-research-refresh.md
.evals/research/cartographer-dirty-worktree-preflight.md
```

Current standalone Cartographer read-only ARK target evidence, measured on 2026-05-12:

| Operation | Result |
| --- | --- |
| `cartographer:index --root /Users/saint/dev/agent-runtime-kernel --out /tmp/cartographer-ark-codegraph` | 0.41s wall time, 227,573,760 bytes max RSS |
| ARK graph size | 669 files, 4,620 nodes, 10,049 edges, 0 findings |
| ARK edge baselines | 835 `TESTS`, 2,000 `IMPORTS`, 1,177 `TYPE_IMPORTS`, 1,351 `EXPORTS`, 111 `USES_ENV`, 37 `TABLE_REFERENCES_TABLE` |
| `cartographer preflight --root /Users/saint/dev/agent-runtime-kernel --live --path src/code-graph/commands.ts --out /tmp/cartographer-ark-codegraph --json` | 335ms total; 321ms graph load, 13ms context build, 1ms prompt render |
| Preflight navigation evidence | 17 primary paths, 2 focused test paths, 0 findings |
| Compact validation commands | 11 commands after filtering, with `omissions.validationCommands: 102`; direct focused tests and module test first, safe broad commands retained, watch/live variants omitted |

Axia OS read-only stress run, measured on 2026-05-11:

| Operation | Result |
| --- | --- |
| `cartographer:index --root /Users/saint/dev/axia-os --out /tmp/ark-axia-codegraph` | 0.50s wall time, 310 MB max RSS |
| Graph size | 1,106 files, 5,093 nodes, 12,261 edges, 0 findings |
| Explicit edge baselines | 400 `TESTS`, 1 `GENERATED_BY`, 228 `SERVICE_QUERIES_TABLE`, 9 `SERVICE_CALLS_RPC`, 88 `TABLE_REFERENCES_TABLE` |
| Monorepo packages | 4 package nodes, 53 package script nodes |
| Supabase SQL facts | 66 tables, 33 functions, 112 policies, 98 triggers |
| Dirty state | 39 dirty artifact nodes |
| Ignored-path contamination | 0 paths under `node_modules`, `dist`, or generated state dirs |
| Bounded DB impact | `dbtable:public.agent_runs --depth 1`: 38 nodes, 60 edges with owner/ancestor validation scripts and safe DB schema/type/status scripts; unbounded: 431 nodes, 1,310 edges |

Observed gaps:

- Existing tests prove extraction and command shape, not agent adoption.
- Existing graph output has no gold task recall or precision score.
- Semantic overlay has request-shape coverage but no calibrated usefulness score.
- Cold repos need a completed `index` before read-only graph commands work.
- Axia stress run now emits explicit `GENERATED_BY`, `TESTS`, `SERVICE_QUERIES_TABLE`, `SERVICE_CALLS_RPC`, and `TABLE_REFERENCES_TABLE` edges; precision gates remain eval targets.
- Slice, impact, and context JSON now expose ranked affected packages and validation commands with both raw package-script bodies and root-executable `runCommand` values; the runner still needs gold-task scoring for affected-package accuracy and command recall.
- Local workspace package dependencies now emit package-to-package `DEPENDS_ON` edges, so a shared package impact can surface dependent app packages and their validation scripts. The runner still needs a monorepo fixture that scores dependency-edge recall, rejects external dependency false positives, and checks affected-package accuracy.
- Preflight JSON now includes command/timestamp metadata plus total and phase timings, so future reports can measure graph load, context build, and prompt render speed without parsing shell wall time.
- Dirty-worktree preflight includes untracked source and test files and now derives focused Bun test commands from direct source-to-test edges when the package test script is compatible. Focused path arguments are emitted as exact Bun paths such as `./src/...` or `./tests/...` instead of brittle substring filters. Future evals should preserve this behavior and extend command synthesis beyond simple root `bun test` scripts.

Manual contract checks now pass for fresh ARK and Axia snapshots:

- schema valid
- duplicate node IDs: 0
- duplicate edge IDs: 0
- dangling edges: 0
- ignored-path contamination: 0
- env-var metadata payloads: 0
- non-root nodes missing evidence: 0
- ARK edge baselines: 629 `TESTS`, 0 `GENERATED_BY`, 0 `SERVICE_QUERIES_TABLE`, 0 `SERVICE_CALLS_RPC`, 37 `TABLE_REFERENCES_TABLE`
- Axia edge baselines: 400 `TESTS`, 1 `GENERATED_BY`, 228 `SERVICE_QUERIES_TABLE`, 9 `SERVICE_CALLS_RPC`, 88 `TABLE_REFERENCES_TABLE`

Existing harness evidence:

| Surface | Current evidence | Gap |
| --- | --- | --- |
| Codex adapter | `bun test src/adapters/codex` passed: 20 pass, 1 skipped live test, 0 fail, 0.36s wall time | Does not test graph-command adoption or codebase-understanding tasks |
| Live Codex adapter | `LIVE_CODEX_E2E=1 bun test src/adapters/codex/__tests__/runner-live.test.ts --timeout 120000` passed: 1 pass, 0 fail, 5.31s wall time | Proves live Codex availability only; does not prove Cartographer graph adoption |
| Live graph-prompted Codex trace | `CODEX_E2E_TRACE_OUT=/tmp/ark-codex-cartographer-adoption-trace.json` plus `cartographer adoption --trace ... --json` produced `adopted: true`, first graph command offset 139ms, and 0 source reads before graph use | One manual research trace only; no repeatable profile, adoption-rate report, or codebase-understanding score |
| Live graph-first facade-test Codex trace | `CODEX_E2E_TRACE_OUT=/tmp/ark-codex-cartographer-tool-packs-trace.json` plus `cartographer adoption --trace ... --json --require-graph-first --expect-path src/core/__tests__/harness-tool-packs.test.ts --expect-command "bun test src/core/__tests__/harness-tool-packs.test.ts" --expect-executed-command "bun test src/core/__tests__/harness-tool-packs.test.ts"` produced `adopted: true`, graph-first gate passed, 0 source reads before graph use, and final/tool evidence for the focused test path and command | One manual research trace only; validates the inferred `__tests__` edge path but does not establish adoption rate or codebase-understanding lift |
| Live graph-first runtime runner Codex trace | `CODEX_E2E_TRACE_OUT=/tmp/ark-codex-runtime-graph-preflight-runner-trace.json` plus `cartographer adoption --trace ... --json --require-graph-first --expect-path src/core/runtime/graph-preflight-runner.ts --expect-path src/core/__tests__/runtime-graph-preflight-runner.test.ts --expect-command "bun test ./src/core/__tests__/runtime-graph-preflight-runner.test.ts --timeout 120000" --expect-executed-command "bun test ./src/core/__tests__/runtime-graph-preflight-runner.test.ts --timeout 120000"` produced `adopted: true`, graph-first gate passed, 0 source reads before graph use, and final/tool/executed-command evidence for the focused runner test | One manual research trace only; validates the newly extracted runtime graph-preflight runner boundary but does not establish adoption rate or codebase-understanding lift |
| Live baseline-direct Codex trace | `CODEX_E2E_TRACE_OUT=/tmp/ark-codex-cartographer-baseline-trace.json` plus `cartographer adoption --trace ... --json` produced `adopted: false`, 10 tool commands, and 2 source reads before graph use | One manual contrast trace only; not a distribution and not a baseline-vs-graph quality claim |
| Harness graph preflight hook | `TurnInput.graphPreflight` runs compact Cartographer preflight before adapter execution, injects prompt context, and emits adoption-compatible runtime events. Unit coverage now includes direct live/offline preflight, structured preflight failure context, mandatory runtime failures, optional skip behavior, and streamed `graphPreflight` error evidence. | Deterministic hook only; no generated Cartographer eval report or live adoption profile yet |
| Kernel graph preflight events | `src/kernel/graph-preflight-events.ts` isolates prompt append and synthetic `cartographer.preflight` `tool_use` / `tool_result` events before adapter events; focused kernel/runtime tests passed with 31 pass, 0 fail. | Deterministic hook substrate only; no generated Cartographer eval report or live adoption profile yet |
| Runtime completion substrate | `a346b06` extracts `RuntimeCompletion` for terminal claim completion, session persistence, terminal event persistence, sink completion, and telemetry; focused completion/session tests passed with 50 pass, 0 fail, and full `src/core` passed with 208 pass, 0 fail. | Improves harness navigability and durable trace/session behavior; still not a Cartographer eval runner or report |
| Live Codex workspace harness | `LIVE_WORKSPACE_HARNESS_E2E=1 LIVE_WORKSPACE_CASES=codex bun run scripts/live-workspace-checkpoint-harnesses.ts` passed and wrote `docs/reports/workspace-checkpoint-2026-05-11T10-31-47-611Z.json` | Proves snapshot/diff/revert durability; does not score Cartographer context recall or graph-command adoption |
| Worker runs | `bun test src/core/__tests__/worker-runs.test.ts` passed: 26 pass, 0 fail, 3.60s wall time | Does not score Cartographer context recall, precision, or first correct file |
| Live Codex | Opt-in via `LIVE_CODEX_E2E=1` and `LIVE_WORKSPACE_HARNESS_E2E=1 LIVE_WORKSPACE_CASES=codex` | Needs credentials and should be a separate non-default profile |

Focused verification across the relevant surfaces currently passes:

```bash
bun test src/code-graph src/adapters/codex src/core/__tests__/worker-runs.test.ts src/state/__tests__/store.test.ts src/state/__tests__/session-tuples.test.ts
```

Result: 104 pass, 1 skipped live Codex test, 0 fail, 1,213 assertions.

## Research Grounding

- CodeCompass / Navigation Paradox: graph navigation can surface hidden structural dependencies, but the graph only helps when the agent uses it. Track graph-call adoption and first correct context.
- Tree-sitter provides fast syntax trees, but the eval must not pretend syntax facts are ownership, workflow, runtime, or IaC facts. Track provenance by layer: syntax, compiler-backed, package/task, IaC/data, agent-inferred, and human-reviewed. Score deterministic graph recall/precision separately from semantic overlay usefulness.
- SCIP/precise navigation research and docs show why compiler-backed symbol/reference edges should be measured separately from parser-derived edges.
- Infrastructure graph tools reinforce the same split for IaC: config resources, dependency edges, drift, policy, and blast radius are different signals and should not collapse into one generic "related file" score.
- ContextBench: evaluate context recall, precision, F1, efficiency, redundancy, and evidence drop from agent trajectories instead of only final success.
- CodeScaleBench: keep auditable traces, task taxonomy, timing, cost, and tool/MCP usage evidence for large-codebase agent workflows.
- Codebase-Memory, Code Rosetta, and Code Atlas reinforce persistent graph memory, cross-language/IaC relationships, hybrid graph/search fallback, and edge-weighted impact traversal so containment edges do not inflate blast radius.
- CodeTracer reinforces trajectory-level scoring: graph adoption is not enough if the agent gathers useful evidence but fails to convert it into the correct edit, validation, or architectural conclusion.
- Theory of Code Space reinforces durable architectural belief scoring: an agent should not lose an earlier correct package/module hypothesis after reading new evidence.
- Codemap and Codemesh reinforce repo-local trust metadata, source-anchor freshness, and reviewable writeback prompts instead of automatic semantic memory truth.
- AgenticCodebase and Memtrace reinforce multi-context, cross-repo, temporal, and API-topology graph requirements as likely Cartographer v2 scale pressure.
- Codemesh's hook model reinforces measuring pre-read graph injection as behavior change, not assuming that a hook or skill caused better navigation.
- ARK Eval Integrity: reports are receipts. Do not compare runs across different hosts, profiles, credentials, runner definitions, or live-container modes without labeling them non-comparable.

## Suite Structure

### 1. Graph Contract

Purpose: prove the deterministic graph is structurally valid.

Tier: deterministic.

Checks:

- `schema-valid`: `graph.json` validates with `codeGraphSnapshotSchema`.
- `stable-node-ids`: every node id is stable, unique, and non-empty.
- `edge-endpoints-exist`: every edge endpoint references a real node.
- `evidence-paths-exist`: every evidence path exists in the indexed repo or is explicitly marked generated/deleted.
- `no-secret-values`: env-var nodes can include names, never raw secret values.
- `no-default-ignored-paths`: ignored paths such as `node_modules`, `dist`, `.git`, and `docs/codegraph` do not enter the graph.
- `provenance-confidence-valid`: source and confidence combinations are legal. Parser-lite or Tree-sitter facts cannot claim `compiler-backed`; agent annotations cannot claim `deterministic`.
- `precision-provider-receipt`: reports include compiler-backed provider availability and fallback reasons when TypeScript, SCIP, or LSP inputs are absent, stale, or skipped.

Why this matters:

Agents cannot trust slices if the graph can point to missing nodes, stale paths, ignored output, or secret-bearing artifacts.

### 2. Extraction Gold Fixtures

Purpose: measure recall and precision for supported fact types.

Tier: deterministic.

Fixture families:

- `tiny-ts-cli`: TypeScript imports, exports, package scripts, CLI entrypoint.
- `pnpm-monorepo`: package boundaries, local workspace dependency edges, cross-package imports, and package-script ownership.
- `supabase-app`: SQL tables, policies, migrations, generated DB type ownership, RPC functions, storage buckets, RLS, triggers, and grants.
- `terraform-service`: resources, modules, env var wiring, deploy boundaries.
- `generated-noise`: vendored/generated dirs, symlinks, large files, ignored outputs, generated-but-important source, and massive formal-state outputs.
- `temporal-monorepo-iac`: snapshot-pair fixture for package graph changes, migration history versus generated types, and plan/state or observed-resource drift when safe local data exists.
- `axia-live-stress`: read-only live stress profile for dirty monorepo/Supabase/workbench scale checks. This is not a deterministic frozen fixture.

Metrics:

- file inclusion recall and generated/vendor exclusion precision
- import/type-import edge F1
- exported symbol precision and recall
- package/workspace detection F1
- local workspace dependency edge precision and recall
- SQL and IaC resource extraction F1
- precision-edge availability by provider and fallback reason count
- generated-artifact classification F1
- dirty/deleted/live-vs-persisted mode accuracy
- temporal graph-diff recall for package/task/migration/resource changes
- runtime p50/p95/p99 and max RSS

Smoke targets:

- schema-valid: 100%
- dangling edges: 0
- ignored-path precision: 100% on fixtures
- import edge F1: at least 90% on smoke fixtures
- SQL/IaC resource extraction F1: at least 85% on smoke fixtures

Baseline targets:

- file inclusion recall: at least 99%
- generated/vendor exclusion precision: at least 99%
- import edge F1: at least 95% overall
- package/workspace detection F1: at least 98%
- local workspace dependency edge F1: at least 95%, with 0 external dependency false positives
- SQL/IaC resource extraction F1: at least 90%
- precision-edge provenance: 100% of compiler-backed edges must cite a compiler, SCIP, or LSP provider receipt
- generated-artifact classification F1: at least 95%
- temporal graph-diff recall: at least 90% on baseline snapshot-pair fixtures

### 3. Navigation Slices

Purpose: measure whether task-specific slices give agents the right starting context.

Tier: deterministic first, optional judge later.

Navigation slice scoring must run with semantic overlays disabled or ignored before any overlay-assisted score is reported. An overlay can improve explanation quality, but it cannot rescue missing deterministic graph recall for required files, packages, IaC resources, tests, or validation commands.

Each task fixture should include:

- task prompt
- named starting file or package
- gold files
- gold nodes or resources
- expected tests or validation commands
- forbidden claims
- expected risks or gotchas

Initial candidate tasks are researched in `.evals/research/cartographer-gold-task-candidates.md`. They are not runner fixtures yet; approval is still required before converting them into structured eval cases.

Metrics:

- top-10 gold-file recall
- top-20 gold-file recall
- slice precision
- hallucinated path count
- dependency-closure coverage
- edge-weighted impact precision
- test-command recall
- slice size in files, nodes, edges, and rendered characters
- p50/p95 slice latency

Smoke targets:

- hallucinated paths: 0
- top-10 gold-file recall: at least 85%
- slice precision: at least 60%

Baseline targets:

- hallucinated paths: 0
- top-10 gold-file recall: at least 90%
- top-20 gold-file recall: at least 95%
- slice precision: at least 70%
- p95 slice latency on local graph: under 500ms on ARK-sized repos

### 4. Agent Harness Navigation

Purpose: test whether Codex-style coding agents use the graph workflow and whether that improves codebase understanding.

Tier: live harness, opt-in profile.

Initial conditions:

- `baseline-direct`: agent has normal shell/filesystem tools and no graph mandate.
- `graph-prompted`: prompt instructs the agent to run `cartographer preflight --path <target>` before source reads. The runner may normalize this to the equivalent `cartographer context --path <target> --depth 1 --compact --json` call for scoring.
- `graph-mandated`: harness sets `graphPreflight: { path: <target> }`, then checks the first tool phase and fails if the agent reads source before graph context.

Future runner task records should make the harness executable without encoding task knowledge in the runner itself:

```ts
type CartographerHarnessTask = {
  id: string;
  workspaceRoot: string;
  graphMode: "persisted" | "live";
  condition: "baseline-direct" | "graph-prompted" | "graph-mandated";
  prompt: string;
  startSelector?: string;
  graphPreflight?: { path: string; required: boolean };
  expectedPaths: string[];
  expectedCommands: string[];
  expectedExecutedCommands?: string[];
  forbiddenPaths?: string[];
  expectedText?: string[];
  traceOut?: string;
};
```

The runner should record the normalized task record, prompt revision, graph mode, workspace root, trace path, and report path for every live-agent sample. That schema is a plan target only; it must not be scaffolded until approval.

Candidate tasks:

- Explain the code graph builder flow and list files needed before editing it.
- Identify what breaks if `CodeGraphNodeKind` changes.
- Find app code and infrastructure tied to an env var in a fixture repo.
- Find package boundaries affected by a shared type change in a monorepo fixture.
- Find dependent app packages and validation commands when a shared workspace package changes.
- Produce validation commands for a change touching SQL migrations and generated DB types.
- Axia-style task: answer "what changes for chat send?" with chat runtime router, stream/service paths, ping commit flow, worker/realtime touchpoints, `agent_runs` and `chat_messages`, and related tests/specs.
- Axia-style task: answer "what changes for AgentMail webhook?" with webhook route, HTTP handler, email services, AgentMail tables/storage/signature paths, and webhook tests.
- Axia-style task: start from `dbtable:public.agent_runs` and return app touchpoints, migrations/RPCs, integration tests, lifecycle docs, and safe validation commands.
- Axia-style task: surface deploy impact for a migration/API change, including CI, Supabase dry-run/push/type generation, schema-cache reload, DigitalOcean deploy surfaces, and env/secret names without secret values.

Metrics from traces:

- graph adoption rate
- first graph command latency
- graph preflight failure count
- first correct file step
- architectural coverage score
- context precision
- redundant reads
- tool-call count
- wall time
- final context list validity
- hallucinated path count
- validation-command recall
- affected-package accuracy
- evidence-to-action conversion: whether the agent uses retrieved graph/source evidence to choose the correct next edit, explanation, or validation step
- belief durability: whether retained package, module, dependency, and risk hypotheses stay coherent across follow-up probes
- writeback quality for any suggested semantic overlay note, including source-anchor freshness and stale-anchor handling

The deterministic trace summary should use `analyzeGraphCommandAdoption(events)`, `checkGraphFirstAdoption(summary)`, and `checkTraceExpectations(events, expectations)` from `src/code-graph/adoption.ts`. Before the runner exists, manual trace research can run `cartographer adoption --trace <runtime-events.json> --json` against the same raw event shape, add `--require-graph-first` for a strict manual gate, or add repeatable `--expect-text`, `--expect-path`, `--expect-command`, and `--expect-executed-command` flags for evidence checks. The summary includes command order, trace duration, first graph command offset, successful graph-preflight result count, preflight durations, first preflight result offset, first preflight phase timings, first source-read-before-graph offset, shell-wrapped source-read handling, skill-instruction read exclusions, and structured graph preflight failures when timestamps are present. Graph-command adoption recognizes both `cartographer preflight` and `cartographer context --json`, including full context follow-up commands emitted when prompt JSON is truncated. The strict gate also emits `graphFirstAdoption` in JSON when `--require-graph-first` is present, so manual traces carry the same pass/fail shape the future runner should persist. `finalResponseExpectation.metrics` carries aggregate expected/hit counts for text, path, recommended command, and executed-command checks so reports do not need to recompute deterministic scoring from raw evidence. Expected-path checks emit per-path evidence for final-response mention, any tool-command mention, and direct source-read mention. Expected-command checks emit per-command evidence for final-response mention and tool-command presence; executed-command checks require a matching tool command and fail when the agent only recommends validation in the final answer. This lets reports separate "agent never tried graph context" from "harness tried preflight and the graph was unavailable," separate "agent named a file" from "agent actually navigated to it," and separate "agent recommended validation" from "agent actually ran validation." The strict graph-first gate fails on missing graph use, graph preflight failures, or repo source reads before graph context. The final-response gate fails when the trace answer omits any expected marker, file, or validation command, and the executed-command gate fails when the trace never ran a required validation command. The suite still needs to store raw `RuntimeEvent[]` evidence because these classifiers only summarize the trajectory.

Pass conditions:

- The live profile records full trajectories, including commands and files read.
- Graph-mandated runs must show graph use before source reads.
- Graph-prompted runs record adoption as a metric instead of assuming prompt compliance.
- Any hallucinated path is a failure, not informational.
- Graph adoption alone is not a pass. A run that uses the graph, reads useful files, and then edits the wrong module or skips required validation fails the understanding check.
- Claims about speed must separate provider/model latency from local graph command latency.

### 5. Semantic Overlay Quality

Purpose: score whether agent annotations are useful, grounded, and separable from deterministic facts.

Tier: judge only after human calibration.

This suite is skipped until calibration exists. Semantic overlay quality must not be used to claim graph correctness, and an annotation cannot turn an unsupported parser guess into an accepted fact.

Binary rubric:

- cites only existing evidence paths
- cites at least one evidence path that anchors to the target node
- names the correct target node
- separates deterministic fact from inferred guidance
- avoids duplicating deterministic graph facts without adding actionable workflow meaning
- adds useful guidance that is absent from the deterministic graph but supported by source evidence
- explains why the file/resource matters
- includes relevant validation guidance when present in gold data
- identifies ownership, generated-file rules, or IaC/runtime links only when evidence supports them
- stays concise enough to be useful inside a future task slice
- avoids fabricated owners, files, tests, resources, or workflows
- flags important risks when present in gold data
- records reviewer decision metadata before an annotation is trusted as accepted
- rejects annotations that contradict deterministic graph facts or stale evidence receipts
- includes trace evidence that the annotator used graph preflight plus direct source reads before writeback

Judge requirements:

- Judge must use a different model family from the annotator.
- Judge output must be structured JSON and schema-validated.
- Judge must see the graph slice, the candidate annotations, and the gold task record.
- Judge must score review metadata separately from annotation text, so an accurate note without a review receipt cannot pass accepted-overlay quality.
- No semantic score is trusted until human agreement is above 90% and Cohen's kappa is above 0.8.

## Profiles

### Smoke

Target runtime: under 10 minutes without live agents.

Includes:

- graph contract checks
- 3 to 4 fixture repos
- 8 to 12 navigation tasks
- no live model calls by default
- optional local command-worker harness trace

Expected command after approval:

```bash
bun run eval:cartographer:smoke
```

### Baseline

Target runtime: under 90 minutes without live agents.

Includes:

- 8 to 12 fixture repos
- 75 to 150 navigation tasks
- monorepo and IaC fixtures required
- performance distributions, not single samples
- report comparison against previous baseline when available
- belief-durability follow-up probes for a subset of navigation tasks

Expected command after approval:

```bash
bun run eval:cartographer:baseline
```

### Live Codex

Target runtime: provider and host dependent.

Includes:

- a small set of graph-adoption tasks
- full worker or Codex adapter traces
- no claims about model quality unless credentials, model, host, and prompt version are recorded

Expected command after approval:

```bash
bun run eval:cartographer:codex
```

## Report Shape

Reports should land under:

```text
docs/reports/cartographer-code-graph-<profile>-<timestamp>.json
```

The report must follow the ARK eval shape:

- `runId`
- `profile`
- `status`
- `startedAt`
- `finishedAt`
- `durationMs`
- `options`
- `environment`
- `researchGrounding[]`
- `suites[]`
- `suites[].checks[]`
- `suites[].metrics`
- `suites[].notes`

Every agent-harness report must also include:

- model and runtime
- prompt revision
- task id
- condition id
- normalized task record
- workspace root and graph mode
- graph preflight request and whether it was required
- files read
- graph commands invoked
- source reads before graph use
- stage summaries or trace refs sufficient to distinguish useful exploration from correct state-changing action
- retained architectural belief snapshots when a task uses follow-up probes
- wall time and provider/model time when available
- output artifacts or trace refs

## Goodhart Controls

- Do not improve recall by returning huge slices.
- Do not reduce runtime by skipping graph validation.
- Do not hide failed, slow, or retried samples.
- Do not compare smoke runs to baseline runs.
- Do not use live-agent runs without model, credential source, host, and prompt metadata.
- Do not treat semantic overlay notes as graph facts.
- Do not let a passing judge replace human calibration.
- Do not make production code branch on eval labels, run IDs, command strings, or report paths.
- Do not treat graph-command adoption as codebase understanding by itself.
- Do not import public benchmark speed, cost, or quality numbers into Cartographer success claims unless the same benchmark is rerun locally with pinned model, host, prompt, and report metadata.

## Why This Suite Might Be Cut

- Live Codex evals will be slower and noisier than deterministic graph evals.
- Human gold tasks require up-front annotation time.
- Judge calibration is not worth doing until there are enough real candidate annotations.
- Fixture repos can become overfit if failures are not refreshed from real agent traces.

## Implementation Gate

This document is the plan. It does not add a runner, judge prompt, package scripts, or checked-in reports.

Approval needed before scaffolding:

- `scripts/cartographer-code-graph-evals.ts`
- fixture repo snapshots
- `eval:cartographer:*` package scripts
- judge prompt and calibration records
- generated JSON reports under `docs/reports`
