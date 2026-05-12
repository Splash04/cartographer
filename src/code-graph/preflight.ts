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
	const outDir = input.outDir === undefined ? resolve(input.root, ".cartographer") : resolve(input.root, input.outDir);
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
