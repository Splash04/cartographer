import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runCartographer } from "../commands.ts";
import { writeAnnotationOverlay } from "./annotation-overlay-fixture.ts";
import { createCartographerFixture, removeCartographerFixture } from "./fixture.ts";

let tempDir: string;

beforeEach(async () => {
	tempDir = await createCartographerFixture("cartographer-command-test-");
});

afterEach(async () => {
	await removeCartographerFixture(tempDir);
});

describe("runCartographer", () => {
	test("indexes and reads graph artifacts", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);

		expect(await Bun.file(join(outDir, "schema.json")).exists()).toBe(true);
		expect(await Bun.file(join(outDir, "manifest.json")).exists()).toBe(true);
		expect(await Bun.file(join(outDir, "graph.json")).exists()).toBe(true);
		expect(await Bun.file(join(outDir, "CODEBASE_MAP.md")).exists()).toBe(true);

		const viewed = await runCartographer({
			command: "cartographer",
			positionals: ["view"],
			flags: { out: outDir },
		});
		expect(viewed.ok).toBe(true);
	});

	test("renders slice and impact JSON for harness consumers", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);

		const slice = await runCliJson([
			"cartographer",
			"slice",
			"--out",
			outDir,
			"--selector",
			"path:src/index.ts",
			"--json",
		]);
		const impact = await runCliJson([
			"cartographer",
			"impact",
			"--out",
			outDir,
			"--path",
			"src/index.ts",
			"--depth",
			"0",
			"--json",
		]);

		expect(slice["selector"]).toBe("path:src/index.ts");
		expect(Array.isArray(slice["nodes"])).toBe(true);
		expect(nodeIds(slice)).toContain("file:src/index.ts");
		expect(nodeIds(slice)).toContain("package:.");
		expect(nodeIds(slice)).toContain("script:.:test");
		expect(edgeKinds(slice)).toContain("DEFINES");
		expect(packageIds(slice)).toContain("package:.");
		expect(validationCommandNames(slice)).toContain("test");
		expectValidationCommand(slice, {
			packageId: "package:.",
			scriptId: "script:.:test",
			name: "test",
			command: "bun test",
			runCommand: "bun run test",
			path: "package.json",
		});
		expect(impact["selector"]).toBe("impact:src/index.ts");
		expect(nodeIds(impact)).toContain("file:src/index.ts");
		expect(nodeIds(impact)).toContain("package:.");
		expect(nodeIds(impact)).toContain("script:.:test");
		expect(packageIds(impact)).toContain("package:.");
		expect(validationCommandNames(impact)).toContain("test");
		expectValidationCommand(impact, {
			packageId: "package:.",
			scriptId: "script:.:test",
			name: "test",
			command: "bun test",
			runCommand: "bun run test",
			path: "package.json",
		});

		const compact = await runCliJson([
			"cartographer",
			"context",
			"--out",
			outDir,
			"--path",
			"src/index.ts",
			"--depth",
			"0",
			"--compact",
			"--json",
		]);
		const summary = recordField(compact, "summary");
		const totals = recordField(compact, "totals");
		expect(compact["slice"]).toBeUndefined();
		expect(compact["impact"]).toBeUndefined();
		expect(stringArrayField(summary, "primaryPaths")).toContain("src/index.ts");
		expect(stringArrayField(summary, "testPaths")).toContain("src/index.test.ts");
		expect(numberField(recordField(totals, "slice"), "nodes")).toBeGreaterThan(0);
		expect(numberField(recordField(totals, "impact"), "nodes")).toBeGreaterThan(0);
	});

	test("keeps package selector CLI slices bounded to one workspace package", async () => {
		await mkdir(join(tempDir, "repo/apps/web/src"), { recursive: true });
		await mkdir(join(tempDir, "repo/apps/web-admin/src"), { recursive: true });
		await writeFile(
			join(tempDir, "repo/package.json"),
			JSON.stringify({ name: "workspace", workspaces: ["apps/*"], scripts: { test: "bun test" } }),
		);
		await writeFile(join(tempDir, "repo/apps/web/package.json"), JSON.stringify({ name: "@fixture/web" }));
		await writeFile(join(tempDir, "repo/apps/web-admin/package.json"), JSON.stringify({ name: "@fixture/web-admin" }));
		await writeFile(join(tempDir, "repo/apps/web/src/index.ts"), "export const web = true;\n");
		await writeFile(join(tempDir, "repo/apps/web-admin/src/index.ts"), "export const admin = true;\n");

		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);

		for (const selector of ["package:apps/web", "package:@fixture/web"]) {
			const slice = await runCliJson(["cartographer", "slice", "--out", outDir, "--selector", selector, "--json"]);

			expect(slice["selector"]).toBe(selector);
			expect(nodeIds(slice)).toContain("package:apps/web");
			expect(nodeIds(slice)).toContain("file:apps/web/src/index.ts");
			expect(nodeIds(slice)).not.toContain("package:apps/web-admin");
			expect(nodeIds(slice)).not.toContain("file:apps/web-admin/src/index.ts");
			expect(packageIds(slice)).toContain("package:apps/web");
			expect(packageIds(slice)).not.toContain("package:apps/web-admin");
		}
	});

	test("renders combined context JSON for agent preflight", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);
		await writeAnnotationOverlay(outDir, [
			annotationRecord({
				id: "annotation:file:src/index.ts:purpose:accepted",
				status: "accepted",
				summary: "Use src/index.test.ts when changing the fixture entrypoint.",
			}),
			annotationRecord({
				id: "annotation:file:src/index.ts:purpose:candidate",
				status: "candidate",
				summary: "Candidate note should stay out of normal preflight context.",
			}),
			annotationRecord({
				id: "annotation:file:src/index.ts:risk:stale",
				kind: "risk",
				status: "accepted",
				summary: "This accepted note should be stale when its evidence hash changes.",
				evidence: [{ path: "src/index.ts", hash: "stale-hash" }],
			}),
		]);

		const context = await runCliJson([
			"cartographer",
			"context",
			"--out",
			outDir,
			"--path",
			"src/index.ts",
			"--depth",
			"0",
			"--json",
		]);
		const slice = recordField(context, "slice");
		const impact = recordField(context, "impact");
		const manifest = recordField(context, "manifest");
		const summary = recordField(context, "summary");
		const annotationNotes = arrayField(summary, "annotationNotes");
		const sliceAnnotations = arrayField(slice, "annotations");
		const findings = arrayField(summary, "findings");

		expect(context["path"]).toBe("src/index.ts");
		expect(context["selector"]).toBe("path:src/index.ts");
		expect(context["depth"]).toBe(0);
		expect(manifest["root"]).toBe(join(tempDir, "repo"));
		expect(stringArrayField(summary, "primaryPaths")).toContain("src/index.ts");
		expect(stringArrayField(summary, "impactPaths")).toContain("src/index.ts");
		expect(stringArrayField(summary, "testPaths")).toContain("src/index.test.ts");
		expect(annotationNotes.length).toBe(2);
		expect(recordAt(annotationNotes, 0)["summary"]).toBe("Use src/index.test.ts when changing the fixture entrypoint.");
		expect(recordAt(annotationNotes, 1)["status"]).toBe("stale");
		expect(sliceAnnotations.length).toBe(2);
		expect(recordAt(sliceAnnotations, 0)["status"]).toBe("accepted");
		expect(recordAt(sliceAnnotations, 1)["status"]).toBe("stale");
		expect(findings.map((finding) => stringField(recordValue(finding), "message"))).toContain(
			"Evidence hash changed for src/index.ts",
		);
		expect(packageIds(context)).toContain("package:.");
		expect(validationCommandNames(context)).toContain("test");
		expect(nodeIds(slice)).toContain("file:src/index.ts");
		expect(nodeIds(impact)).toContain("file:src/index.ts");
		expect(packageIds(slice)).toContain("package:.");
		expect(packageIds(impact)).toContain("package:.");
		expectValidationCommand(slice, {
			packageId: "package:.",
			scriptId: "script:.:test",
			name: "test",
			command: "bun test",
			runCommand: "bun run test",
			path: "package.json",
		});
		expectValidationCommand(impact, {
			packageId: "package:.",
			scriptId: "script:.:test",
			name: "test",
			command: "bun test",
			runCommand: "bun run test",
			path: "package.json",
		});
	});

	test("renders compact preflight JSON with agent-safe defaults", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);

		const preflight = await runCliJson(["cartographer", "preflight", "--out", outDir, "--path", "src/index.ts"]);
		const summary = recordField(preflight, "summary");
		const totals = recordField(preflight, "totals");
		const omissions = recordField(preflight, "omissions");
		const limits = recordField(preflight, "limits");
		const preflightMetadata = recordField(preflight, "preflight");
		const timings = recordField(preflightMetadata, "timings");

		expect(preflight["path"]).toBe("src/index.ts");
		expect(preflight["selector"]).toBe("path:src/index.ts");
		expect(preflight["depth"]).toBe(1);
		expect(preflight["slice"]).toBeUndefined();
		expect(preflight["impact"]).toBeUndefined();
		expect(preflightMetadata["targetPath"]).toBe("src/index.ts");
		expect(preflightMetadata["live"]).toBe(false);
		expect(stringField(preflightMetadata, "command")).toContain("cartographer preflight");
		expect(numberField(preflightMetadata, "durationMs")).toBeGreaterThanOrEqual(0);
		expect(numberField(timings, "loadGraphMs")).toBeGreaterThanOrEqual(0);
		expect(numberField(timings, "buildContextMs")).toBeGreaterThanOrEqual(0);
		expect(numberField(timings, "renderPromptMs")).toBeGreaterThanOrEqual(0);
		expect(stringArrayField(summary, "primaryPaths")).toContain("src/index.ts");
		expect(stringArrayField(summary, "impactPaths")).toContain("src/index.ts");
		expect(stringArrayField(summary, "testPaths")).toContain("src/index.test.ts");
		expect(numberField(recordField(totals, "slice"), "nodes")).toBeGreaterThan(0);
		expect(numberField(recordField(totals, "impact"), "nodes")).toBeGreaterThan(0);
		expect(numberField(omissions, "validationCommands")).toBeGreaterThanOrEqual(0);
		expect(numberField(limits, "validationCommands")).toBeGreaterThan(0);
		expect(validationCommandNames(preflight)).toContain("test");
		expect(validationCommandNames(preflight).at(0)).toBe("test:src/index.test.ts");
		expectValidationCommand(preflight, {
			packageId: "package:.",
			scriptId: "script:.:test#src/index.test.ts",
			name: "test:src/index.test.ts",
			command: "bun test ./src/index.test.ts",
			runCommand: "bun test ./src/index.test.ts",
			path: "package.json",
		});

		const overridden = await runCliJson([
			"cartographer",
			"preflight",
			"--out",
			outDir,
			"--path",
			"src/index.ts",
			"--depth",
			"0",
		]);
		expect(overridden["depth"]).toBe(0);
	});

	test("summarizes graph-command adoption from a runtime trace", async () => {
		const tracePath = join(tempDir, "trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([
				runtimeEvent({ name: "shell", input: { command: ["rg", "CodeGraphNodeKind", "src"] } }),
				runtimeEvent({
					status: "started",
					item: {
						type: "commandExecution",
						command: ["bun", "run", "cartographer:preflight", "--", "--path", "src/index.ts"],
					},
				}),
				runtimeToolResultEvent(
					{
						name: "cartographer.preflight",
						command: "bun run cartographer:preflight -- --path src/index.ts",
						durationMs: 120,
						timings: { loadGraphMs: 90, buildContextMs: 20, renderPromptMs: 10 },
					},
					"2026-05-11T00:00:00.120Z",
				),
			]),
		);

		const summary = await runCliJson(["cartographer", "adoption", "--trace", tracePath, "--json"]);

		expect(summary["adopted"]).toBe(true);
		expect(summary["eventCount"]).toBe(3);
		expect(summary["traceDurationMs"]).toBe(120);
		expect(summary["firstGraphCommandIndex"]).toBe(1);
		expect(summary["firstGraphCommandOffsetMs"]).toBe(0);
		expect(summary["graphPreflightResultCount"]).toBe(1);
		expect(summary["graphPreflightDurationsMs"]).toEqual([120]);
		expect(summary["firstGraphPreflightResultIndex"]).toBe(2);
		expect(summary["firstGraphPreflightResultOffsetMs"]).toBe(120);
		expect(summary["firstGraphPreflightDurationMs"]).toBe(120);
		expect(summary["firstGraphPreflightTimings"]).toEqual({
			loadGraphMs: 90,
			buildContextMs: 20,
			renderPromptMs: 10,
		});
		expect(summary["graphPreflightFailureCount"]).toBe(0);
		expect(summary["graphPreflightFailureCommands"]).toEqual([]);
		expect(summary["toolCommandCount"]).toBe(2);
		expect(summary["sourceReadBeforeGraphCount"]).toBe(1);
		expect(summary["sourceReadCommandsBeforeGraph"]).toEqual(["rg CodeGraphNodeKind src"]);
		expect(summary["firstSourceReadBeforeGraphIndex"]).toBe(0);
		expect(summary["firstSourceReadBeforeGraphOffsetMs"]).toBe(0);
	});

	test("summarizes graph-preflight failures from a runtime trace", async () => {
		const tracePath = join(tempDir, "preflight-failure-trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([
				runtimeEvent({ name: "shell", input: { command: ["git", "status", "--short"] } }),
				runtimeErrorEvent(
					{
						code: "INTERNAL",
						message: "Cartographer preflight failed",
						graphPreflight: {
							command: "cartographer preflight --path src/index.ts --out docs/codegraph",
							root: join(tempDir, "repo"),
							path: "src/index.ts",
							live: false,
							depth: 1,
							outDir: "docs/codegraph",
						},
					},
					"2026-05-11T00:00:02.000Z",
				),
			]),
		);

		const summary = await runCliJson(["cartographer", "adoption", "--trace", tracePath, "--json"]);

		expect(summary["adopted"]).toBe(false);
		expect(summary["graphPreflightFailureCount"]).toBe(1);
		expect(summary["graphPreflightFailureCommands"]).toEqual([
			"cartographer preflight --path src/index.ts --out docs/codegraph",
		]);
		expect(summary["firstGraphPreflightFailureIndex"]).toBe(1);
		expect(summary["firstGraphPreflightFailureCommand"]).toBe(
			"cartographer preflight --path src/index.ts --out docs/codegraph",
		);
		expect(summary["firstGraphPreflightFailureOffsetMs"]).toBe(2000);
		expect(summary["sourceReadBeforeGraphCount"]).toBe(0);
	});

	test("passes strict graph-first adoption when graph context is first", async () => {
		const tracePath = join(tempDir, "graph-first-trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([
				runtimeEvent({
					status: "started",
					item: {
						type: "commandExecution",
						command: ["bun", "run", "cartographer:preflight", "--", "--path", "src/index.ts"],
					},
				}),
				runtimeEvent({ name: "shell", input: { command: ["sed", "-n", "1,40p", "src/index.ts"] } }),
			]),
		);

		const summary = await runCliJson([
			"cartographer",
			"adoption",
			"--trace",
			tracePath,
			"--require-graph-first",
			"--json",
		]);
		const graphFirst = recordField(summary, "graphFirstAdoption");

		expect(graphFirst["passed"]).toBe(true);
		expect(graphFirst["failures"]).toEqual([]);
	});

	test("fails strict graph-first adoption when no graph command was used", async () => {
		const tracePath = join(tempDir, "no-graph-trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([
				runtimeEvent({ name: "shell", input: { command: ["rg", "CodeGraphNodeKind", "src"] } }),
				runtimeEvent({ name: "shell", input: { command: ["sed", "-n", "1,40p", "src/code-graph/types.ts"] } }),
			]),
		);

		const message = await expectStrictAdoptionFailure(tracePath);
		expect(message).toContain("graph-first adoption failed");
		expect(message).toContain("no graph command was used");
		expect(message).toContain("2 source read(s) before graph context");
	});

	test("emits graph-first gate details before failing strict adoption JSON", async () => {
		const tracePath = join(tempDir, "no-graph-json-trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([runtimeEvent({ name: "shell", input: { command: ["rg", "CodeGraphNodeKind", "src"] } })]),
		);

		const { stdout, stderr, exitCode } = runCli([
			"cartographer",
			"adoption",
			"--trace",
			tracePath,
			"--require-graph-first",
			"--json",
		]);
		const summary = parseCliJson(stdout);
		const graphFirst = recordField(summary, "graphFirstAdoption");

		expect(exitCode).not.toBe(0);
		expect(stderr).toContain("graph-first adoption failed");
		expect(graphFirst["passed"]).toBe(false);
		expect(graphFirst["failures"]).toEqual(["no graph command was used", "1 source read(s) before graph context"]);
	});

	test("fails strict graph-first adoption when preflight failed", async () => {
		const tracePath = join(tempDir, "strict-preflight-failure-trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([
				runtimeErrorEvent({
					code: "INTERNAL",
					message: "Cartographer preflight failed",
					graphPreflight: {
						command: "cartographer preflight --path src/index.ts --out docs/codegraph",
						root: join(tempDir, "repo"),
						path: "src/index.ts",
						live: false,
						depth: 1,
						outDir: "docs/codegraph",
					},
				}),
			]),
		);

		const message = await expectStrictAdoptionFailure(tracePath);
		expect(message).toContain("1 graph preflight failure(s)");
		expect(message).toContain("no graph command was used");
	});

	test("checks final response expectations for understanding traces", async () => {
		const tracePath = join(tempDir, "understanding-trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([
				runtimeEvent({
					status: "started",
					item: {
						type: "commandExecution",
						command: ["bun", "run", "cartographer:preflight", "--", "--path", "src/code-graph/adoption.ts"],
					},
				}),
				runtimeResultEvent({
					text: '{"marker":"CODEX_UNDERSTANDING_OK","file":"src/code-graph/adoption.ts","validationCommand":"bun test"}',
				}),
			]),
		);

		const summary = await runCliJson([
			"cartographer",
			"adoption",
			"--trace",
			tracePath,
			"--json",
			"--require-graph-first",
			"--expect-text",
			"CODEX_UNDERSTANDING_OK",
			"--expect-path",
			"src/code-graph/adoption.ts",
			"--expect-command",
			"bun test",
		]);

		const expectation = recordField(summary, "finalResponseExpectation");
		expect(expectation["passed"]).toBe(true);
		expect(expectation["expectedPath"]).toBe("src/code-graph/adoption.ts");
		expect(expectation["expectedCommand"]).toBe("bun test");
		const metrics = recordField(expectation, "metrics");
		expect(metrics["expectedPathCount"]).toBe(1);
		expect(metrics["finalPathHitCount"]).toBe(1);
		expect(metrics["toolPathHitCount"]).toBe(1);
		expect(metrics["expectedCommandCount"]).toBe(1);
		expect(metrics["finalCommandHitCount"]).toBe(1);
		expect(metrics["toolCommandHitCount"]).toBe(0);
		const pathEvidence = arrayField(expectation, "pathEvidence");
		expect(recordAt(pathEvidence, 0)["observedInFinalResponse"]).toBe(true);
		expect(recordAt(pathEvidence, 0)["observedInToolCommand"]).toBe(true);
		expect(recordAt(pathEvidence, 0)["observedInSourceReadCommand"]).toBe(false);
		const commandEvidence = arrayField(expectation, "commandEvidence");
		expect(recordAt(commandEvidence, 0)["observedInFinalResponse"]).toBe(true);
		expect(recordAt(commandEvidence, 0)["observedInToolCommand"]).toBe(false);
	});

	test("checks repeated final response expectations from CLI flags", async () => {
		const tracePath = join(tempDir, "understanding-repeated-trace.json");
		await writeUnderstandingTrace(
			tracePath,
			[
				"CODEX_UNDERSTANDING_OK",
				"src/code-graph/adoption.ts",
				"src/code-graph/commands.ts",
				"bun test src/code-graph",
				"bun run typecheck",
			].join("\n"),
		);

		const summary = await runCliJson([
			"cartographer",
			"adoption",
			"--trace",
			tracePath,
			"--json",
			"--require-graph-first",
			"--expect-path",
			"src/code-graph/adoption.ts",
			"--expect-path",
			"src/code-graph/commands.ts",
			"--expect-command",
			"bun test src/code-graph",
			"--expect-command",
			"bun run typecheck",
		]);

		const expectation = recordField(summary, "finalResponseExpectation");
		expect(expectation["passed"]).toBe(true);
		expect(expectation["expectedPath"]).toEqual(["src/code-graph/adoption.ts", "src/code-graph/commands.ts"]);
		expect(expectation["expectedCommand"]).toEqual(["bun test src/code-graph", "bun run typecheck"]);
		const metrics = recordField(expectation, "metrics");
		expect(metrics["expectedPathCount"]).toBe(2);
		expect(metrics["finalPathHitCount"]).toBe(2);
		expect(metrics["toolPathHitCount"]).toBe(1);
		expect(metrics["expectedCommandCount"]).toBe(2);
		expect(metrics["finalCommandHitCount"]).toBe(2);
		expect(metrics["toolCommandHitCount"]).toBe(1);
		expect(arrayField(expectation, "pathEvidence").length).toBe(2);
		const commandEvidence = arrayField(expectation, "commandEvidence");
		expect(recordAt(commandEvidence, 0)["observedInToolCommand"]).toBe(true);
		expect(recordAt(commandEvidence, 1)["observedInToolCommand"]).toBe(false);
	});

	test("checks executed command expectations from CLI flags", async () => {
		const tracePath = join(tempDir, "understanding-executed-command-trace.json");
		await writeUnderstandingTrace(
			tracePath,
			"CODEX_UNDERSTANDING_OK\nsrc/code-graph/adoption.ts\nValidation completed.",
		);

		const summary = await runCliJson([
			"cartographer",
			"adoption",
			"--trace",
			tracePath,
			"--json",
			"--require-graph-first",
			"--expect-path",
			"src/code-graph/adoption.ts",
			"--expect-executed-command",
			"bun test src/code-graph",
		]);

		const expectation = recordField(summary, "finalResponseExpectation");
		expect(expectation["passed"]).toBe(true);
		expect(expectation["expectedExecutedCommand"]).toBe("bun test src/code-graph");
		const metrics = recordField(expectation, "metrics");
		expect(metrics["expectedExecutedCommandCount"]).toBe(1);
		expect(metrics["executedCommandHitCount"]).toBe(1);
		const executedCommandEvidence = arrayField(expectation, "executedCommandEvidence");
		expect(recordAt(executedCommandEvidence, 0)["observedInFinalResponse"]).toBe(false);
		expect(recordAt(executedCommandEvidence, 0)["observedInToolCommand"]).toBe(true);
		expect(recordAt(executedCommandEvidence, 0)["firstToolCommand"]).toBe("bun test src/code-graph");
	});

	test("fails final response expectations when expected evidence is absent", async () => {
		const tracePath = join(tempDir, "understanding-failure-trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([
				runtimeEvent({
					status: "started",
					item: {
						type: "commandExecution",
						command: ["bun", "run", "cartographer:preflight", "--", "--path", "src/code-graph/adoption.ts"],
					},
				}),
				runtimeResultEvent({ text: '{"file":"src/code-graph/commands.ts"}' }),
			]),
		);

		const result = await runCartographer({
			command: "cartographer",
			positionals: ["adoption"],
			flags: { trace: tracePath, "expect-path": "src/code-graph/adoption.ts" },
		});

		expectValidationFailure(result, "final response did not include expected path: src/code-graph/adoption.ts");
	});

	test("fails executed command expectations when no matching tool command ran", async () => {
		const tracePath = join(tempDir, "understanding-executed-command-failure-trace.json");
		await writeFile(
			tracePath,
			JSON.stringify([runtimeResultEvent({ text: "Recommended validation: bun test src/code-graph" })]),
		);

		const result = await runCartographer({
			command: "cartographer",
			positionals: ["adoption"],
			flags: { trace: tracePath, "expect-executed-command": "bun test src/code-graph" },
		});

		expectValidationFailure(result, "trace did not execute expected command: bun test src/code-graph");
	});

	test("uses path selectors for both context slice and impact", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);

		const context = await runCliJson([
			"cartographer",
			"context",
			"--out",
			outDir,
			"--path",
			"path:src/index.ts",
			"--depth",
			"0",
			"--json",
		]);
		const impact = recordField(context, "impact");

		expect(context["selector"]).toBe("path:src/index.ts");
		expect(nodeIds(impact)).toContain("file:src/index.ts");
	});

	test("treats symbol node ids as exact context selectors", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);

		const context = await runCliJson([
			"cartographer",
			"context",
			"--out",
			outDir,
			"--path",
			"symbol:src/index.ts:value",
			"--depth",
			"0",
			"--json",
		]);
		const slice = recordField(context, "slice");

		expect(context["selector"]).toBe("symbol:src/index.ts:value");
		expect(nodeIds(slice)).toContain("symbol:src/index.ts:value");
		expect(nodeIds(slice)).toContain("file:src/index.ts");
	});

	test("requires an OpenRouter key for non-dry-run annotation", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);

		const previous = Bun.env["OPENROUTER_API_KEY"];
		delete Bun.env["OPENROUTER_API_KEY"];
		const result = await runCartographer({
			command: "cartographer",
			positionals: ["annotate"],
			flags: { out: outDir },
		});
		if (previous !== undefined) Bun.env["OPENROUTER_API_KEY"] = previous;

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("AUTH_FAILED");
	});

	test("audits annotation overlays against the current graph", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);
		const overlayDir = join(outDir, "overlays");
		await mkdir(overlayDir, { recursive: true });
		await writeFile(
			join(overlayDir, "agent-notes.jsonl"),
			[
				JSON.stringify(annotationRecord({ id: "annotation:file:src/index.ts:purpose:0" })),
				JSON.stringify(
					annotationRecord({
						id: "annotation:file:src/index.ts:workflow:1",
						kind: "workflow",
						status: "accepted",
						evidence: [{ path: "src/index.ts", hash: "stale-hash" }],
					}),
				),
				JSON.stringify(
					annotationRecord({
						id: "annotation:file:src/missing.ts:risk:2",
						targetNodeId: "file:src/missing.ts",
						kind: "risk",
						evidence: [{ path: "src/missing.ts" }],
					}),
				),
				"{not-json",
				"",
			].join("\n"),
		);

		const audit = await runCliJson(["cartographer", "annotations", "--out", outDir, "--json"]);
		const summary = recordField(audit, "summary");
		const issues = arrayField(audit, "issues");
		const parseIssues = arrayField(audit, "parseIssues");

		expect(summary["totalAnnotations"]).toBe(3);
		expect(summary["candidateCount"]).toBe(2);
		expect(summary["acceptedCount"]).toBe(1);
		expect(summary["reviewReadyCandidateCount"]).toBe(1);
		expect(summary["usableAcceptedCount"]).toBe(0);
		expect(summary["staleRecommendedCount"]).toBe(2);
		expect(summary["issueCount"]).toBe(3);
		expect(summary["parseIssueCount"]).toBe(1);
		expect(issues.map((issue) => stringField(recordValue(issue), "code"))).toEqual([
			"evidence-hash-mismatch",
			"target-missing",
			"evidence-missing",
		]);
		expect(recordAt(parseIssues, 0)["code"]).toBe("json-invalid");
	});

	test("rejects duplicate annotation ids before review", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);
		const annotationId = "annotation:file:src/index.ts:purpose:duplicate";
		await writeAnnotationOverlay(outDir, [
			annotationRecord({ id: annotationId }),
			annotationRecord({
				id: annotationId,
				kind: "workflow",
				summary: "Use the fixture test when changing the entrypoint.",
			}),
		]);

		const audit = await runCliJson(["cartographer", "annotations", "--out", outDir, "--json"]);
		const summary = recordField(audit, "summary");
		const issues = arrayField(audit, "issues");

		expect(summary["totalAnnotations"]).toBe(2);
		expect(summary["reviewReadyCandidateCount"]).toBe(0);
		expect(summary["staleRecommendedCount"]).toBe(2);
		expect(summary["issueCount"]).toBe(2);
		expect(issues.map((issue) => stringField(recordValue(issue), "code"))).toEqual(["duplicate-id", "duplicate-id"]);

		const result = await runCartographer({
			command: "cartographer",
			positionals: ["annotations"],
			flags: { out: outDir, accept: annotationId, reviewer: "Saint" },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("VALIDATION_FAILED");
		expect(result.error.message).toContain("cannot accept annotation with audit issues");
		expect(result.error.message).toContain("duplicate-id");
	});

	test("rejects annotation evidence that does not anchor to the target node", async () => {
		await writeFile(join(tempDir, "repo/src/other.ts"), "export const other = true;\n");
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);
		const annotationId = "annotation:file:src/index.ts:workflow:unanchored";
		await writeAnnotationOverlay(outDir, [
			annotationRecord({
				id: annotationId,
				kind: "workflow",
				summary: "This note cites a real file but not the file it annotates.",
				evidence: [{ path: "src/other.ts" }],
			}),
		]);

		const audit = await runCliJson(["cartographer", "annotations", "--out", outDir, "--json"]);
		const summary = recordField(audit, "summary");
		const issues = arrayField(audit, "issues");

		expect(summary["totalAnnotations"]).toBe(1);
		expect(summary["reviewReadyCandidateCount"]).toBe(0);
		expect(summary["staleRecommendedCount"]).toBe(1);
		expect(summary["issueCount"]).toBe(1);
		expect(issues.map((issue) => stringField(recordValue(issue), "code"))).toEqual(["target-evidence-missing"]);

		const result = await runCartographer({
			command: "cartographer",
			positionals: ["annotations"],
			flags: { out: outDir, accept: annotationId, reviewer: "Saint" },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("VALIDATION_FAILED");
		expect(result.error.message).toContain("cannot accept annotation with audit issues");
		expect(result.error.message).toContain("target-evidence-missing");
	});

	test("audits annotation overlays against a live graph without persisted graph artifacts", async () => {
		const outDir = join(tempDir, "repo/docs/live-codegraph");
		await writeAnnotationOverlay(outDir, [
			annotationRecord({
				id: "annotation:file:src/index.ts:purpose:live",
				status: "accepted",
			}),
		]);

		expect(await Bun.file(join(outDir, "graph.json")).exists()).toBe(false);
		const audit = await runCliJson([
			"cartographer",
			"annotations",
			"--root",
			join(tempDir, "repo"),
			"--out",
			outDir,
			"--live",
			"--json",
		]);
		const summary = recordField(audit, "summary");

		expect(summary["totalAnnotations"]).toBe(1);
		expect(summary["acceptedCount"]).toBe(1);
		expect(summary["usableAcceptedCount"]).toBe(1);
		expect(summary["issueCount"]).toBe(0);
		expect(summary["parseIssueCount"]).toBe(0);
		expect(await Bun.file(join(outDir, "graph.json")).exists()).toBe(false);
	});

	test("accepts review-ready annotation overlay candidates with a reviewer stamp", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);
		const annotationId = "annotation:file:src/index.ts:purpose:review";
		await writeAnnotationOverlay(outDir, [
			annotationRecord({
				id: annotationId,
				evidence: [{ path: "src/index.ts" }],
			}),
		]);

		const result = await runCliJson([
			"cartographer",
			"annotations",
			"--out",
			outDir,
			"--accept",
			annotationId,
			"--reviewer",
			"Saint",
			"--json",
		]);
		const annotation = recordField(result, "annotation");
		const author = recordField(annotation, "author");
		const audit = recordField(result, "audit");
		const summary = recordField(audit, "summary");
		const persisted = JSON.parse(
			(await readFile(join(outDir, "overlays", "agent-notes.jsonl"), "utf8")).trim(),
		) as Record<string, unknown>;

		expect(result["action"]).toBe("accept");
		expect(annotation["id"]).toBe(annotationId);
		expect(annotation["status"]).toBe("accepted");
		expect(annotation["confidence"]).toBe("human-reviewed");
		expect(author["type"]).toBe("human");
		expect(author["name"]).toBe("Saint");
		expect(persisted["status"]).toBe("accepted");
		expect(recordField(persisted, "author")["name"]).toBe("Saint");
		expect(summary["candidateCount"]).toBe(0);
		expect(summary["acceptedCount"]).toBe(1);
		expect(summary["usableAcceptedCount"]).toBe(1);
	});

	test("rejects accepting annotations with current audit issues", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);
		const annotationId = "annotation:file:src/index.ts:risk:stale";
		await writeAnnotationOverlay(outDir, [
			annotationRecord({
				id: annotationId,
				kind: "risk",
				evidence: [{ path: "src/index.ts", hash: "stale-hash" }],
			}),
		]);

		const result = await runCartographer({
			command: "cartographer",
			positionals: ["annotations"],
			flags: { out: outDir, accept: annotationId, reviewer: "Saint" },
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("VALIDATION_FAILED");
		expect(result.error.message).toContain("cannot accept annotation with audit issues");
		expect(result.error.message).toContain("evidence-hash-mismatch");
	});

	test("retires annotations with a reviewer stamp even when evidence is stale", async () => {
		const { indexed, outDir } = await indexFixtureRepo();
		expect(indexed.ok).toBe(true);
		const annotationId = "annotation:file:src/index.ts:risk:retire";
		await writeAnnotationOverlay(outDir, [
			annotationRecord({
				id: annotationId,
				kind: "risk",
				evidence: [{ path: "src/index.ts", hash: "stale-hash" }],
			}),
		]);

		const result = await runCliJson([
			"cartographer",
			"annotations",
			"--out",
			outDir,
			"--retire",
			annotationId,
			"--reviewer",
			"Saint",
			"--json",
		]);
		const annotation = recordField(result, "annotation");
		const author = recordField(annotation, "author");
		const audit = recordField(result, "audit");
		const summary = recordField(audit, "summary");

		expect(result["action"]).toBe("retire");
		expect(annotation["status"]).toBe("retired");
		expect(annotation["confidence"]).toBe("human-reviewed");
		expect(author["type"]).toBe("human");
		expect(author["name"]).toBe("Saint");
		expect(summary["retiredCount"]).toBe(1);
		expect(summary["staleRecommendedCount"]).toBe(0);
	});
});

async function indexFixtureRepo() {
	const outDir = join(tempDir, "repo/docs/codegraph");
	const indexed = await runCartographer({
		command: "cartographer",
		positionals: ["index"],
		flags: { root: join(tempDir, "repo"), out: outDir },
	});
	return { indexed, outDir };
}

async function writeUnderstandingTrace(tracePath: string, finalText: string): Promise<void> {
	await writeFile(
		tracePath,
		JSON.stringify([
			runtimeEvent({
				status: "started",
				item: {
					type: "commandExecution",
					command: ["bun", "run", "cartographer:preflight", "--", "--path", "src/code-graph/adoption.ts"],
				},
			}),
			runtimeEvent({
				status: "started",
				item: {
					type: "commandExecution",
					command: ["bun", "test", "src/code-graph"],
				},
			}),
			runtimeResultEvent({ text: finalText }),
		]),
	);
}

function expectValidationFailure(result: Awaited<ReturnType<typeof runCartographer>>, expectedMessage: string): void {
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error("expected validation to fail");
	expect(result.error.code).toBe("VALIDATION_FAILED");
	expect(result.error.message).toContain("trace expectation failed");
	expect(result.error.message).toContain(expectedMessage);
}

async function expectStrictAdoptionFailure(tracePath: string): Promise<string> {
	const result = await runCartographer({
		command: "cartographer",
		positionals: ["adoption"],
		flags: { trace: tracePath, "require-graph-first": true },
	});
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error("expected strict adoption to fail");
	expect(result.error.code).toBe("VALIDATION_FAILED");
	return result.error.message;
}

async function runCliJson(args: readonly string[]): Promise<Record<string, unknown>> {
	const { stdout, stderr, exitCode } = runCli(args);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	return parseCliJson(stdout);
}

function annotationRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const now = "2026-05-11T00:00:00.000Z";
	return {
		id: "annotation:file:src/index.ts:purpose:0",
		targetNodeId: "file:src/index.ts",
		kind: "purpose",
		summary: "src/index.ts is the fixture source entrypoint.",
		evidence: [{ path: "src/index.ts" }],
		author: { type: "agent", name: "test" },
		confidence: "agent-inferred",
		status: "candidate",
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function runCli(args: readonly string[]): {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
} {
	const proc = Bun.spawnSync(["bun", "run", "src/cli/index.ts", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = new TextDecoder().decode(proc.stdout);
	const stderr = new TextDecoder().decode(proc.stderr);
	return { stdout, stderr, exitCode: proc.exitCode };
}

function parseCliJson(stdout: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(stdout);
	expect(typeof parsed).toBe("object");
	expect(parsed).not.toBeNull();
	expect(Array.isArray(parsed)).toBe(false);
	return parsed as Record<string, unknown>;
}

function nodeIds(slice: Record<string, unknown>): string[] {
	const nodes = slice["nodes"];
	if (!Array.isArray(nodes)) throw new Error("expected slice.nodes to be an array");
	return nodes.map((node) => {
		expect(typeof node).toBe("object");
		expect(node).not.toBeNull();
		const id = (node as Record<string, unknown>)["id"];
		expect(typeof id).toBe("string");
		return id as string;
	});
}

function edgeKinds(slice: Record<string, unknown>): string[] {
	const edges = slice["edges"];
	if (!Array.isArray(edges)) throw new Error("expected slice.edges to be an array");
	return edges.map((edge) => {
		expect(typeof edge).toBe("object");
		expect(edge).not.toBeNull();
		const kind = (edge as Record<string, unknown>)["kind"];
		expect(typeof kind).toBe("string");
		return kind as string;
	});
}

function packageIds(slice: Record<string, unknown>): string[] {
	return summaryArray(slice, "affectedPackages").map((summary) => {
		const packageId = summary["packageId"];
		expect(typeof packageId).toBe("string");
		return packageId as string;
	});
}

function validationCommandNames(slice: Record<string, unknown>): string[] {
	return summaryArray(slice, "validationCommands").map((command) => {
		const name = command["name"];
		expect(typeof name).toBe("string");
		return name as string;
	});
}

function expectValidationCommand(slice: Record<string, unknown>, expected: Record<string, string>): void {
	const command = summaryArray(slice, "validationCommands").find((item) => item["scriptId"] === expected["scriptId"]);
	expect(command).toBeDefined();
	if (command === undefined) return;
	for (const [key, value] of Object.entries(expected)) expect(command[key]).toBe(value);
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
	const field = value[key];
	expect(typeof field).toBe("object");
	expect(field).not.toBeNull();
	expect(Array.isArray(field)).toBe(false);
	return field as Record<string, unknown>;
}

function arrayField(value: Record<string, unknown>, key: string): readonly unknown[] {
	const field = value[key];
	expect(Array.isArray(field)).toBe(true);
	return field as readonly unknown[];
}

function recordAt(values: readonly unknown[], index: number): Record<string, unknown> {
	const value = values[index];
	return recordValue(value);
}

function recordValue(value: unknown): Record<string, unknown> {
	expect(typeof value).toBe("object");
	expect(value).not.toBeNull();
	expect(Array.isArray(value)).toBe(false);
	return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, key: string): string {
	const field = value[key];
	expect(typeof field).toBe("string");
	return field as string;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
	const field = value[key];
	if (!Array.isArray(field)) throw new Error(`expected ${key} to be an array`);
	return field.map((item) => {
		expect(typeof item).toBe("string");
		return item as string;
	});
}

function numberField(value: Record<string, unknown>, key: string): number {
	const field = value[key];
	expect(typeof field).toBe("number");
	return field as number;
}

function runtimeEvent(data: unknown): Record<string, unknown> {
	return {
		type: "tool_use",
		turnId: "turn-test",
		timestamp: "2026-05-11T00:00:00.000Z",
		data,
	};
}

function runtimeToolResultEvent(data: unknown, timestamp = "2026-05-11T00:00:00.000Z"): Record<string, unknown> {
	return {
		type: "tool_result",
		turnId: "turn-test",
		timestamp,
		data,
	};
}

function runtimeErrorEvent(data: unknown, timestamp = "2026-05-11T00:00:00.000Z"): Record<string, unknown> {
	return {
		type: "error",
		turnId: "turn-test",
		timestamp,
		data,
	};
}

function runtimeResultEvent(data: unknown): Record<string, unknown> {
	return {
		type: "result",
		turnId: "turn-test",
		timestamp: "2026-05-11T00:00:00.000Z",
		data,
	};
}

function summaryArray(slice: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const summary = slice["summary"];
	expect(typeof summary).toBe("object");
	expect(summary).not.toBeNull();
	const value = (summary as Record<string, unknown>)[key];
	if (!Array.isArray(value)) throw new Error(`expected slice.summary.${key} to be an array`);
	return value.map((item) => {
		expect(typeof item).toBe("object");
		expect(item).not.toBeNull();
		return item as Record<string, unknown>;
	});
}
