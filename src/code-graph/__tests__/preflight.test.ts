import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeCodeGraphArtifacts } from "../artifacts.ts";
import { buildCodeGraph } from "../builder.ts";
import { runCartographerPreflight } from "../preflight.ts";
import { writeAnnotationOverlay } from "./annotation-overlay-fixture.ts";
import { createCartographerFixture, removeCartographerFixture } from "./fixture.ts";

let tempDir: string;

beforeEach(async () => {
	tempDir = await createCartographerFixture("cartographer-preflight-test-");
});

afterEach(async () => {
	await removeCartographerFixture(tempDir);
});

describe("runCartographerPreflight", () => {
	test("builds live compact graph context for agent turns", async () => {
		const result = await runCartographerPreflight({
			root: join(tempDir, "repo"),
			path: "src/index.ts",
			depth: 0,
			maxPromptChars: 5_000,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw result.error;
		expect(result.data.live).toBe(true);
		expect(result.data.depth).toBe(0);
		expect(result.data.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.data.timings.loadGraphMs).toBeGreaterThanOrEqual(0);
		expect(result.data.timings.buildContextMs).toBeGreaterThanOrEqual(0);
		expect(result.data.timings.renderPromptMs).toBeGreaterThanOrEqual(0);
		expect(result.data.command).toContain("cartographer preflight");
		expect(result.data.command).toContain("--live");
		expect(result.data.targetPath).toBe("src/index.ts");
		expect(result.data.context.path).toBe("src/index.ts");
		expect(result.data.context.selector).toBe("path:src/index.ts");
		expect(result.data.context.summary.primaryPaths).toContain("src/index.ts");
		expect(result.data.context.summary.testPaths).toContain("src/index.test.ts");
		expect(result.data.context.summary.validationCommands.map((item) => item.name)).toContain("test");
		expect(result.data.context.summary.validationCommands).toContainEqual({
			packageId: "package:.",
			scriptId: "script:.:test",
			name: "test",
			command: "bun test",
			runCommand: "bun run test",
			path: "package.json",
		});
		expect(result.data.context.totals.slice.nodes).toBeGreaterThan(0);
		expect(result.data.context.totals.impact.nodes).toBeGreaterThan(0);
		expect(result.data.promptText).toContain('type="cartographer-preflight"');
		expect(result.data.promptText).toContain("<navigation-brief>");
		expect(result.data.promptText).toContain("Primary paths:");
		expect(result.data.promptText).toContain("- src/index.ts");
		expect(result.data.promptText).toContain("- src/index.test.ts");
		expect(result.data.promptText).toContain("test:src/index.test.ts: bun test ./src/index.test.ts");
		expect(result.data.promptText).toContain("&quot;primaryPaths&quot;");
		expect(result.data.promptText).toContain('<context-json truncated="false"');
		expect(result.data.promptText).not.toContain("<truncation-guidance>");
	});

	test("marks truncated context JSON in the prompt", async () => {
		const result = await runCartographerPreflight({
			root: join(tempDir, "repo"),
			path: "src/index.ts",
			depth: 0,
			maxPromptChars: 80,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw result.error;
		expect(result.data.promptText).toContain('<context-json truncated="true"');
		expect(result.data.promptText).toContain('max-chars="80"');
		expect(result.data.promptText).toContain('emitted-chars="80"');
		expect(result.data.promptText).toContain("Primary paths:");
		expect(result.data.promptText).toContain("<truncation-guidance>");
		expect(result.data.promptText).toContain("cartographer context");
		expect(result.data.promptText).toContain("--live");
		expect(result.data.promptText).toContain("--path src/index.ts");
		expect(result.data.promptText).toContain("--depth 0");
	});

	test("marks omitted navigation brief entries", async () => {
		const root = join(tempDir, "repo");
		const imports = Array.from({ length: 20 }, (_, index) => `import { dep${index} } from './dep-${index}';`);
		const values = Array.from({ length: 20 }, (_, index) => `dep${index}`).join(" + ");
		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				writeFile(join(root, `src/dep-${index}.ts`), `export const dep${index} = ${index};\n`),
			),
		);
		await writeFile(join(root, "src/index.ts"), `${imports.join("\n")}\nexport const value = ${values};\n`);

		const result = await runCartographerPreflight({
			root,
			path: "src/index.ts",
			depth: 0,
			maxPromptChars: 5_000,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw result.error;
		expect(result.data.promptText).toContain("- ... ");
		expect(result.data.promptText).toContain("more");
	});

	test("keeps focused validation commands visible when the brief is capped", async () => {
		const root = join(tempDir, "repo");
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "fixture",
				scripts: {
					test: "bun test",
					"test:e2e": "bun test e2e",
					"test:all": "bun test --all",
					"test:watch": "bun test --watch",
					lint: "bunx biome check src",
					"lint:eslint": "bunx eslint src",
					"lint:types": "tsc --noEmit",
					typecheck: "tsc --noEmit",
					"typecheck:web": "tsc --noEmit -p tsconfig.web.json",
					build: "bun build src/index.ts",
					"build:web": "bun build src/index.ts --outdir dist",
					verify: "bun run typecheck && bun test",
					"verify:web": "bun run typecheck:web && bun test",
					"check:format": "bunx biome check .",
				},
			}),
		);

		const result = await runCartographerPreflight({
			root,
			path: "src/index.ts",
			depth: 0,
			maxPromptChars: 5_000,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw result.error;
		const focusedCommand = "test:src/index.test.ts: bun test ./src/index.test.ts";
		const safePackageCommand = "typecheck: bun run typecheck";
		expect(result.data.context.summary.validationCommands.map((item) => item.name).at(0)).toBe(
			"test:src/index.test.ts",
		);
		expect(result.data.context.summary.validationCommands.length).toBeLessThanOrEqual(20);
		expect(result.data.context.summary.validationCommands).toContainEqual({
			packageId: "package:.",
			scriptId: "script:.:typecheck",
			name: "typecheck",
			command: "tsc --noEmit",
			runCommand: "bun run typecheck",
			path: "package.json",
		});
		expect(result.data.promptText).toContain(focusedCommand);
		expect(result.data.promptText).toContain(safePackageCommand);
		expect(result.data.promptText).not.toContain("test:e2e: bun run test:e2e");
		expect(result.data.promptText.indexOf(focusedCommand)).toBeLessThan(
			result.data.promptText.indexOf(safePackageCommand),
		);
	});

	test("reads persisted graph artifacts when live mode is disabled", async () => {
		const root = join(tempDir, "repo");
		const outDir = join(tempDir, "codegraph");
		await writeCodeGraphArtifacts(await buildCodeGraph({ root }), { outDir });
		await writeAnnotationOverlay(outDir, [
			{
				id: "annotation:file:src/index.ts:test-guidance:accepted",
				targetNodeId: "file:src/index.ts",
				kind: "test-guidance",
				summary: "Run the fixture test when changing src/index.ts.",
				evidence: [{ path: "src/index.test.ts" }],
				author: { type: "human", name: "test" },
				confidence: "human-reviewed",
				status: "accepted",
				createdAt: "2026-05-11T00:00:00.000Z",
				updatedAt: "2026-05-11T00:00:00.000Z",
			},
			{
				id: "annotation:file:src/index.ts:risk:stale",
				targetNodeId: "file:src/index.ts",
				kind: "risk",
				summary: "This accepted note should be stale when its evidence hash changes.",
				evidence: [{ path: "src/index.ts", hash: "stale-hash" }],
				author: { type: "human", name: "test" },
				confidence: "human-reviewed",
				status: "accepted",
				createdAt: "2026-05-11T00:00:00.000Z",
				updatedAt: "2026-05-11T00:00:00.000Z",
			},
		]);

		const result = await runCartographerPreflight({
			root,
			outDir,
			live: false,
			path: "src/index.ts",
			depth: 1,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw result.error;
		expect(result.data.live).toBe(false);
		expect(result.data.command).not.toContain("--live");
		expect(result.data.context.summary.primaryPaths).toContain("src/index.ts");
		expect(result.data.context.summary.testPaths).toContain("src/index.test.ts");
		expect(result.data.context.summary.validationCommands.map((item) => item.command)).toContain("bun test");
		expect(result.data.context.summary.annotationNotes.map((item) => item.summary)).toContain(
			"Run the fixture test when changing src/index.ts.",
		);
		expect(result.data.context.summary.annotationNotes.map((item) => item.status)).toContain("stale");
		expect(result.data.context.summary.findings.map((item) => item.message)).toContain(
			"Evidence hash changed for src/index.ts",
		);
	});

	test("returns structured preflight failure context", async () => {
		const root = join(tempDir, "repo");
		const result = await runCartographerPreflight({
			root,
			outDir: "missing-codegraph",
			live: false,
			path: "src/index.ts",
			depth: 1,
		});

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected preflight failure");
		expect(result.error.code).toBe("INTERNAL");
		expect(result.error.context).toMatchObject({
			operation: "cartographer.preflight",
			root,
			path: "src/index.ts",
			live: false,
			depth: 1,
			outDir: join(root, "missing-codegraph"),
		});
		expect(String(result.error.context["command"])).toContain("cartographer preflight");
	});
});
