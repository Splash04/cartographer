# Cartographer Code Graph Eval Approval Request

Status: awaiting explicit approval
Date: 2026-05-12

This is the approval request for the next `$evals` step. It is not approval by itself and it does not scaffold the runner.

## Decision Summary

Approve a deterministic smoke runner for the standalone Cartographer CLI.

The first runner should turn the existing graph contract, preflight/context output, and adoption classifier into append-only JSON reports. It should measure local graph correctness, speed, focused navigation quality, validation-command recall, and read-only external target behavior against ARK.

It should not make live Codex quality-lift claims, semantic-overlay usefulness claims, or benchmark claims beyond the local host/report it writes.

## Proposed First Batch

Add:

- `scripts/cartographer-code-graph-evals.ts`
- `eval:cartographer`
- `eval:cartographer:smoke`
- `eval:cartographer:baseline`
- JSON reports under `docs/reports`

Smoke profile checks:

- schema-valid graph snapshots
- duplicate node IDs: 0
- dangling edges: 0
- ignored-path contamination: 0
- secret-value leakage in env metadata: 0
- self-index succeeds for this repo
- ARK read-only index succeeds to `/tmp` or a configured output dir outside ARK
- preflight for a known target returns the expected primary path
- preflight returns at least one relevant focused test path
- preflight returns focused validation commands before broad commands
- report records duration, graph size, host metadata, git state, and profile

Baseline profile can extend the same runner with larger task records and Axia-style monorepo/IaC targets later.

## Current Evidence

Standalone Cartographer verification:

- `bun run typecheck` passed.
- `bun test src/code-graph --timeout 120000` passed with 63 pass, 0 fail, 1,403 assertions.
- self-index passed with 61 files, 799 nodes, 1,121 edges, 0 findings.

Read-only ARK target evidence:

- command wrote to `/tmp/cartographer-ark-codegraph`, not to ARK
- index time: 0.41s wall
- max RSS: 227,573,760 bytes
- graph: 669 files, 4,620 nodes, 10,049 edges, 0 findings
- live preflight for `src/code-graph/commands.ts`: 368ms total
- preflight surfaced `src/code-graph/commands.ts`, `src/code-graph/__tests__/commands.test.ts`, `src/code-graph/__tests__/builder.test.ts`
- first validation commands included `bun test ./src/code-graph/__tests__/builder.test.ts`, `bun test ./src/code-graph/__tests__/commands.test.ts`, and `bun test ./src/code-graph`

## Goodhart Shield

- Do not optimize edge count alone. Score recall, precision, hallucinated paths, findings, slice size, and speed together.
- Do not treat graph-command adoption as codebase understanding. Understanding requires expected paths, tests, commands, and final-answer evidence.
- Do not count "the agent recommended a test" as "the agent ran a test." Use executed-command trace evidence for that.
- Do not compare live Codex runs across hosts, credentials, prompts, models, or runner versions unless labeled non-comparable.
- Do not let semantic overlay notes rescue missing deterministic graph facts.

## Explicitly Deferred

- Default live Codex runs.
- Semantic-overlay judge scoring.
- Human calibration labels.
- Axia as a frozen deterministic fixture.
- Claims that graph-first agents are better than baseline agents before repeated baseline-vs-graph distributions exist.

## Approval Language

Any of these is enough to proceed:

```text
approve
go
ship it
yes scaffold it
```

Without explicit approval, the correct next state is still plan and audit only.
