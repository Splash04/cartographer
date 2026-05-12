# Cartographer Code Graph Completion Audit

Status: incomplete - runner implementation still approval-gated
Last updated: 2026-05-12

## Objective

Strengthen the standalone Cartographer CLI with `$evals`, using `/Users/saint/dev/agent-runtime-kernel` as a read-only test target, and measure whether agent workflows can navigate codebases faster and more durably.

The objective is complete only when Cartographer itself has:

- a standalone graph CLI and library in this repo
- a master PRD for Cartographer v2
- documented eval targets for graph correctness, speed, navigation, and agent adoption
- read-only external target evidence from ARK
- runnable eval commands that emit append-only JSON reports
- at least one generated report proving the smoke profile actually ran
- a clear boundary between deterministic graph facts and agent semantic overlay guidance

## Prompt-To-Artifact Checklist

| Requirement | Evidence | Status |
| --- | --- | --- |
| Focus only on Cartographer/tooling | Core code now lives in this repo under `src/code-graph`, `src/cli`, `src/core/types.ts`, and `src/shared`. ARK is not the implementation home. | Done |
| Standalone CLI tool | `package.json` exposes `cartographer` plus `cartographer:index`, `view`, `slice`, `impact`, `context`, `preflight`, `adoption`, `annotate`, and `annotations`. | Done |
| Master PRD focused on Cartographer v2 | `docs/prds/cartographer-v2-code-graph.md` is now scoped to standalone Cartographer, with ARK and Axia treated only as test repositories. | Done |
| Include eval targets | `docs/prds/cartographer-v2-code-graph.md` and `docs/evals/cartographer-code-graph-eval-suites.md` define graph correctness, navigation, adoption, task outcome, monorepo, IaC, and semantic overlay targets. | Done as plan |
| Use ARK as test target base | On 2026-05-12, the standalone CLI indexed `/Users/saint/dev/agent-runtime-kernel` read-only and wrote artifacts to `/tmp/cartographer-ark-codegraph`. No graph artifacts were written inside ARK. | Done as read-only evidence |
| Measure graph speed | ARK index: 0.41s wall time, 227,573,760 bytes max RSS. ARK live preflight: 368ms total, 353ms graph load, 13ms context build, 2ms prompt render. | Partial - manual evidence only |
| Measure codebase understanding | ARK preflight for `src/code-graph/commands.ts` surfaced 17 primary paths, 2 focused test paths, 0 findings, and a compact 11-command validation list led by `builder.test.ts`, `commands.test.ts`, and module-level `bun test ./src/code-graph`. | Partial - one manual target only |
| Use coding-agent harnesses such as Codex | Existing docs describe adoption and trace checks, and `cartographer adoption` can score runtime traces. There is no standalone repeatable Codex eval profile in this repo yet. | Partial |
| Produce runnable eval reports | No `scripts/cartographer-code-graph-evals.ts`, no `eval:cartographer:*` scripts, and no `docs/reports/cartographer-code-graph-*.json` reports exist. | Missing |
| Keep deterministic graph separate from semantic overlay | CLI supports deterministic graph artifacts plus candidate/reviewed overlay annotations. PRD and feature docs state that overlays cannot rescue missing graph facts. | Done |
| Verify current implementation | `bun run typecheck`, `bun test src/code-graph --timeout 120000`, and standalone self-index passed after the repo split. | Done |

## Current Read-Only ARK Evidence

Command:

```bash
/usr/bin/time -l bun run cartographer:index -- \
  --root /Users/saint/dev/agent-runtime-kernel \
  --out /tmp/cartographer-ark-codegraph \
  --max-file-bytes 500000
```

Result:

- root: `/Users/saint/dev/agent-runtime-kernel`
- output: `/tmp/cartographer-ark-codegraph`
- git: dirty at `02e1d424803e`
- files: 669
- nodes: 4,620
- edges: 10,049
- findings: 0
- wall time: 0.41s
- max RSS: 227,573,760 bytes

Edge highlights:

- `TESTS`: 835
- `IMPORTS`: 2,000
- `TYPE_IMPORTS`: 1,177
- `EXPORTS`: 1,351
- `USES_ENV`: 111
- `TABLE_REFERENCES_TABLE`: 37

Latest compact live preflight command:

```bash
bun run cartographer:preflight -- \
  --root /Users/saint/dev/agent-runtime-kernel \
  --live \
  --path src/code-graph/commands.ts \
  --out /tmp/cartographer-ark-codegraph \
  --json
```

Result after compact validation-command filtering:

- duration: 327ms
- graph load: 314ms
- context build: 11ms
- prompt render: 1ms
- primary paths: 17
- test paths: 2
- validation commands: 11, down from the earlier 114-command compact list
- findings: 0

Focused paths surfaced:

- `src/code-graph/commands.ts`
- `src/code-graph/builder.ts`
- `src/code-graph/context.ts`
- `src/code-graph/preflight.ts`
- `src/code-graph/query.ts`
- `src/code-graph/types.ts`
- `src/code-graph/__tests__/commands.test.ts`
- `src/code-graph/__tests__/builder.test.ts`

Focused validation commands surfaced first:

- `bun test ./src/code-graph/__tests__/builder.test.ts`
- `bun test ./src/code-graph/__tests__/commands.test.ts`
- `bun test ./src/code-graph`

Safe broad validation commands retained:

- `bun run test`
- `bun run typecheck`
- `bun run lint`
- `bun run lint:eslint`
- `bun run verify`

Long-running or environment-heavy broad commands such as watch/live variants are omitted from compact preflight context. Full context still retains complete command data for tooling that needs it.

Important note: ARK was already dirty on branch `garden/wave-2e-broker-context` before and after this read-only test-target run. The Cartographer command wrote to `/tmp`, not to the ARK repo.

## Current Cartographer Verification

Latest verified commands in the standalone Cartographer repo:

```bash
bun run typecheck
bun test src/code-graph --timeout 120000
bun run cartographer:index -- --root . --out /tmp/cartographer-plugin-codegraph --max-file-bytes 500000
```

Results:

- TypeScript typecheck passed.
- Graph tests passed: 63 pass, 0 fail, 1,403 assertions.
- Self-index passed: 61 files, 799 nodes, 1,121 edges, 0 findings.

## Missing Work

The objective is not complete. The strongest remaining gap is the approval-gated runnable eval runner:

- `scripts/cartographer-code-graph-evals.ts`
- `eval:cartographer`
- `eval:cartographer:smoke`
- `eval:cartographer:baseline`
- `docs/reports/cartographer-code-graph-*.json`
- structured smoke task records converted from `.evals/research/cartographer-gold-task-candidates.md`
- repeatable ARK target profile that writes a report instead of only manual `/tmp` evidence
- repeatable Codex/adoption profile for graph-first codebase-understanding traces
- calibrated judge prompt and human labels for semantic overlay usefulness

## Completion Verdict

Incomplete.

The standalone CLI and PRD are in place, and the CLI has proven it can index ARK as a read-only external test target. The eval plan exists, but it is still not executable eval evidence because no runner, package scripts, or report artifacts exist.

Per the `$evals` workflow, the next implementation step is to approve the deterministic smoke runner before scaffolding code outside planning docs.
