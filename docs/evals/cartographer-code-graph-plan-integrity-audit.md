# Cartographer Code Graph Plan Integrity Audit

Status: plan audited, runner still blocked on approval
Date: 2026-05-12

## Synthesis

The Cartographer eval plan is trustworthy as a plan, but not yet valid as eval evidence.

The plan is now scoped to the standalone Cartographer repo. It is grounded in a real read-only ARK target run, includes graph-speed and navigation evidence, separates deterministic graph facts from semantic overlay guidance, and names the Goodhart traps. The single most important missing piece is still a deterministic smoke runner that writes append-only JSON reports.

This audit does not approve or scaffold:

- `scripts/cartographer-code-graph-evals.ts`
- `eval:cartographer:*` package scripts
- fixture snapshots
- judge prompts or calibration labels
- `docs/reports/cartographer-code-graph-*.json`

## Current Repository Evidence

- branch: `main`
- remote status: `main...origin/main`
- latest commits:
  - `479e8b6 feat: report compact context omissions`
  - `0126cff fix: focus compact cartographer validation commands`
  - `9f31212 docs: refresh cartographer eval audit`
  - `149581a feat: add standalone cartographer graph cli`

Current package scripts include Cartographer graph commands and normal checks:

- `cartographer`
- `cartographer:index`
- `cartographer:update`
- `cartographer:view`
- `cartographer:slice`
- `cartographer:impact`
- `cartographer:context`
- `cartographer:preflight`
- `cartographer:adoption`
- `cartographer:annotate`
- `cartographer:annotations`
- `typecheck`
- `test`

Current package scripts do not include:

- `eval:cartographer`
- `eval:cartographer:smoke`
- `eval:cartographer:baseline`
- `eval:cartographer:codex`

Current report state:

- no `docs/reports/cartographer-code-graph-*.json` reports exist
- no `scripts/cartographer-code-graph-evals.ts` runner exists

## Read-Only ARK Target Evidence

The standalone CLI was run against `/Users/saint/dev/agent-runtime-kernel` with output under `/tmp`, not inside ARK.

Index evidence:

- command: `bun run cartographer:index -- --root /Users/saint/dev/agent-runtime-kernel --out /tmp/cartographer-ark-codegraph --max-file-bytes 500000`
- graph: 669 files, 4,620 nodes, 10,049 edges, 0 findings
- edge highlights: 835 `TESTS`, 2,000 `IMPORTS`, 1,177 `TYPE_IMPORTS`, 1,351 `EXPORTS`, 111 `USES_ENV`, 37 `TABLE_REFERENCES_TABLE`
- timing: 0.41s wall, 227,573,760 bytes max RSS

Preflight evidence:

- command: `bun run cartographer:preflight -- --root /Users/saint/dev/agent-runtime-kernel --live --path src/code-graph/commands.ts --out /tmp/cartographer-ark-codegraph --json`
- duration: 335ms
- graph load: 321ms
- context build: 13ms
- prompt render: 1ms
- primary paths: 17
- test paths: 2
- compact validation commands: 11
- omitted validation commands: 102
- findings: 0
- first validation commands:
  - `bun test ./src/code-graph/__tests__/builder.test.ts`
  - `bun test ./src/code-graph/__tests__/commands.test.ts`
  - `bun test ./src/code-graph`

## Score

Pass: 19
Fail: 10
N/A: 6

Most failures are expected because this is still a pre-implementation plan audit. They become invalidators only if Cartographer claims runnable eval coverage before the runner, package scripts, reports, and calibration artifacts exist.

## Structural Checks

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Suite has a written plan before code | pass | `docs/evals/cartographer-code-graph-eval-suites.md` exists and remains plan-first. |
| 2 | Report shape matches the required schema | fail | The plan names the report shape, but no Cartographer runner or report exists to validate. |
| 3 | Reports land in `docs/reports` | fail | No `docs/reports/cartographer-code-graph-*.json` report exists. |
| 4 | Run IDs encode profile and timestamp | fail | No generated `runId` exists. |
| 5 | Status vocabulary is fixed | fail | No runner enforces `passed`, `failed`, `skipped`, or `informational`. |
| 6 | Package scripts exist for smoke and baseline | fail | `package.json` has no `eval:cartographer:*` scripts. |

## Tier 1 Deterministic Checks

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 7 | Tier 1 exists and does cheap checks | fail | Graph-contract and navigation checks are planned, but not runnable as an eval suite. |
| 8 | Zero LLM calls in Tier 1 | pass | The proposed smoke profile explicitly excludes live model calls. |
| 9 | Tier 1 failures block before Tier 2 | fail | No runner exists to enforce fail-fast ordering. |
| 10 | Graph modes are explicit | pass | Docs distinguish live, persisted, and fixture modes; ARK target evidence records live mode and `/tmp` output. |
| 11 | Compact output records omissions | pass | `GraphContextCompact.omissions.validationCommands` is implemented and tested; ARK preflight reports 102 omitted validation commands. |

## Tier 2 Judge Checks

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 12 | Rubric is binary decomposed | pass | Semantic overlay criteria are binary in the plan, not a 1-5 quality score. |
| 13 | Judge uses a different model family | pass | Judge requirements state a different model family from the annotator. |
| 14 | Judge output is structured JSON | pass | Judge requirements state structured JSON with validation. |
| 15 | Full trace is passed to judge where trajectory matters | pass | Agent-harness scoring is planned around raw trace evidence, not final-only answers. |
| 16 | Pairwise comparisons swap order and average | n/a | The current semantic-overlay plan is not pairwise. |
| 17 | Calibration gold set exists | fail | No gold labels or calibration records exist. |
| 18 | Judge-human agreement is documented above threshold | fail | No judge prompt, calibration run, Cohen's kappa, or agreement report exists. |

## Tier 3 Human Review

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 19 | Human review cadence exists | fail | Calibration and human review are deferred. |
| 20 | New failures feed back into Tier 1 or Tier 2 | fail | No runner/report/failure queue exists yet. |

## Integrity Checks

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 21 | No easier flag is used for safety or scale claims | pass | The plan separates deterministic smoke, baseline, and opt-in live Codex profiles. |
| 22 | Mandatory live suites are not silently skipped | n/a | Live Codex is explicitly opt-in. |
| 23 | Safety checks are not downgraded to informational | pass | Hallucinated paths and graph-mandated violations are planned failures. |
| 24 | Sample counts and concurrency match documented defaults | pass | The runner does not exist, so no implementation can weaken them yet. |
| 25 | Image changes are scoped in the claim | n/a | The suite is local graph/navigation first, not container-image performance. |
| 26 | Reports are not manually edited | n/a | No reports exist. |
| 27 | Failed, slow, and retried samples are recorded | pass | The plan requires failed, slow, and retried evidence to be recorded. |
| 28 | Production code does not special-case eval labels or run IDs | pass | Current production code has no `eval:cartographer` runner labels or report-path special cases. |
| 29 | Claims do not rely on stubbed provider metrics | pass | Current claims are local CLI/manual ARK target evidence only. |

## Lifecycle Checks

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 30 | Pass rate is not saturated at 100% | n/a | No Cartographer eval report exists. |
| 31 | Suite changes over time | pass | The plan/audit docs changed as standalone CLI and ARK target evidence landed. |
| 32 | Single-signal optimization risk is addressed | pass | The plan scores recall, precision, hallucinated paths, slice size, adoption, validation recall, omissions, and timings together. |

## Hard Findings

- HARD GAP: There is no runnable Cartographer eval suite.
- HARD GAP: There are no Cartographer eval reports under `docs/reports`.
- HARD GAP: There are no `eval:cartographer:*` package scripts.
- HARD GAP: The ARK target evidence is manual `/tmp` evidence, not an append-only eval report.
- HARD GAP: Semantic-overlay usefulness remains unsupported until gold labels, judge prompts, and agreement metrics exist.
- HARD GAP: Codex-style harness adoption can be scored by `cartographer adoption`, but there is no repeatable standalone live Codex eval profile in this repo yet.

## Anti-Pattern Findings

- No mock-echo eval pattern found in the plan.
- No numeric 1-5 rubric found for semantic overlay scoring.
- No same-family judge usage is planned.
- No trace-opaque scoring is planned.
- No single-signal edge-count-only optimization is planned.

## Current Gate

The approval gate remains valid.

The next implementation step is to approve the deterministic smoke runner, then create the runner, package scripts, structured smoke tasks, and first JSON report. Until that approval exists, planning/audit work can continue, but no eval runner, fixture snapshots, judge prompt, package scripts, approval receipt, or Cartographer eval report should be scaffolded.
