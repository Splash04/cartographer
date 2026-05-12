#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	analyzeGraphCommandAdoption,
	auditNotes,
	buildCodeGraph,
	buildBrief,
	buildRemovalAudit,
	checkGraphFirstAdoption,
	checkTraceExpectations,
	codeGraphSnapshotSchema,
	ingestNotesReport,
	isSourceReadCommand,
	reviewNote,
	runCartographerPreflight,
	verifyRemovalAudit,
	writeCodeGraphArtifacts,
	type CodeGraphSnapshot,
	type RemovalEvidenceClass,
	type TraceExpectationInput,
} from "../src/index.ts";
import type { RuntimeEvent } from "../src/core/types.ts";

type EvalStatus = "passed" | "failed" | "skipped" | "informational";

interface EvalCheck {
	readonly id: string;
	readonly status: EvalStatus;
	readonly summary: string;
	readonly metrics?: Record<string, unknown> | undefined;
	readonly evidence?: Record<string, unknown> | undefined;
}

interface EvalSuite {
	readonly id: string;
	readonly title: string;
	readonly status: EvalStatus;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly durationMs: number;
	readonly checks: readonly EvalCheck[];
	readonly metrics?: Record<string, unknown> | undefined;
	readonly notes?: readonly string[] | undefined;
}

interface EvalReport {
	readonly runId: string;
	readonly profile: string;
	readonly status: EvalStatus;
	readonly startedAt: string;
	readonly finishedAt: string;
	readonly durationMs: number;
	readonly options: EvalOptions;
	readonly environment: Record<string, unknown>;
	readonly researchGrounding: readonly string[];
	readonly suites: readonly EvalSuite[];
	readonly failures: readonly string[];
}

interface EvalOptions {
	readonly profile: string;
	readonly targetRoot: string;
	readonly reportDir: string;
	readonly outBase: string;
	readonly maxFileBytes: number;
	readonly traceSuite: string;
	readonly live: boolean;
	readonly codexPath: string;
	readonly codexModel?: string | undefined;
}

interface TimedResult<T> {
	readonly value: T;
	readonly durationMs: number;
}

interface CodexTraceSuite {
	readonly version: number;
	readonly description: string;
	readonly cases: readonly CodexTraceCase[];
}

interface CodexTraceCase {
	readonly id: string;
	readonly title: string;
	readonly condition: "baseline-direct" | "graph-prompted" | "graph-mandated";
	readonly comparisonGroup?: string | undefined;
	readonly trace: string;
	readonly expectedAdopted: boolean;
	readonly requireGraphFirst?: boolean | undefined;
	readonly expectedText?: readonly string[] | undefined;
	readonly expectedPaths?: readonly string[] | undefined;
	readonly expectedCommands?: readonly string[] | undefined;
	readonly expectedExecutedCommands?: readonly string[] | undefined;
}

const STATUS_ORDER: Record<EvalStatus, number> = {
	failed: 3,
	skipped: 2,
	informational: 1,
	passed: 0,
};

async function main(): Promise<void> {
	const options = evalOptions(Bun.argv.slice(2));
	const startedAtMs = Date.now();
	const startedAt = new Date(startedAtMs).toISOString();
	const runId = `cartographer-code-graph-${options.profile}-${timestampForRunId(startedAt)}`;
	const runOutDir = join(options.outBase, runId);
	const suites: EvalSuite[] = [];

	await mkdir(runOutDir, { recursive: true });
	await mkdir(options.reportDir, { recursive: true });

	suites.push(await graphContractSuite("self", process.cwd(), join(runOutDir, "self"), options.maxFileBytes));
	suites.push(await graphContractSuite("ark", options.targetRoot, join(runOutDir, "ark"), options.maxFileBytes));
	suites.push(await briefPacketSuite(process.cwd(), options.maxFileBytes));
	suites.push(await removalAuditSuite(runOutDir, options.maxFileBytes));
	suites.push(await notesLifecycleSuite(runOutDir, options.maxFileBytes));
	suites.push(await arkPreflightSuite(options, join(runOutDir, "ark")));
	if (options.profile === "codex") {
		suites.push(await codexTraceSuite(options));
		suites.push(await codexOutcomeSuite(options));
	}
	if (options.profile === "codex-live") {
		suites.push(await liveCodexSuite(options, runOutDir));
	}

	const finishedAtMs = Date.now();
	const report: EvalReport = {
		runId,
		profile: options.profile,
		status: aggregateStatus(suites.map((suite) => suite.status)),
		startedAt,
		finishedAt: new Date(finishedAtMs).toISOString(),
		durationMs: finishedAtMs - startedAtMs,
		options,
		environment: await environment(),
		researchGrounding: [
			"docs/evals/cartographer-code-graph-eval-suites.md",
			"docs/evals/cartographer-code-graph-completion-audit.md",
			"docs/evals/cartographer-code-graph-plan-integrity-audit.md",
			".evals/research/cartographer-code-graph-trace-survey.md",
			".evals/research/cartographer-axia-stress-run.md",
			".evals/fixtures/codex-traces/cases.json",
			"codex exec --json --ephemeral",
		],
		suites,
		failures: suites.flatMap((suite) =>
			suite.checks
				.filter((check) => check.status === "failed")
				.map((check) => `${suite.id}/${check.id}: ${check.summary}`),
		),
	};

	const reportPath = join(options.reportDir, `${runId}.json`);
	await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(`${report.status}: wrote ${reportPath}`);
	if (report.status === "failed") process.exitCode = 1;
}

async function liveCodexSuite(options: EvalOptions, runOutDir: string): Promise<EvalSuite> {
	return timedSuite("codex-live-adoption", "live Codex graph adoption run", async () => {
		if (!options.live) {
			return [
				failed(
					"live-flag-required",
					"codex-live profile requires --live so provider-backed Codex runs never execute by accident",
				),
			];
		}
		const liveRun = await runLiveCodex(options, join(runOutDir, "codex-live.jsonl"));
		const summary = analyzeGraphCommandAdoption(liveRun.events);
		const graphFirst = checkGraphFirstAdoption(summary);
		const expectations = checkTraceExpectations(liveRun.events, {
			text: "CODEX_LIVE_CARTOGRAPHER_OK",
			path: "src/kernel/turn-executor.ts",
			command: "bun test src/code-graph/__tests__/adoption.test.ts",
			executedCommand: "bun test src/code-graph/__tests__/adoption.test.ts",
		});
		return [
			check("codex-exit", () =>
				liveRun.exitCode === 0
					? passed("codex exec exited successfully", {
							exitCode: liveRun.exitCode,
							rawJsonlPath: liveRun.rawJsonlPath,
							stderrLength: liveRun.stderr.length,
						})
					: failed("codex-exit", "codex exec failed", {
							exitCode: liveRun.exitCode,
							stderr: liveRun.stderr.slice(0, 2000),
							rawJsonlPath: liveRun.rawJsonlPath,
						}),
			),
			check("live-graph-adoption", () =>
				summary.adopted
					? passed("live Codex used Cartographer graph context", {
							eventCount: summary.eventCount,
							toolCommandCount: summary.toolCommandCount,
							sourceReadBeforeGraphCount: summary.sourceReadBeforeGraphCount,
							firstGraphCommand: summary.firstGraphCommand,
							firstGraphCommandOffsetMs: summary.firstGraphCommandOffsetMs,
							graphPreflightResultCount: summary.graphPreflightResultCount,
							firstGraphPreflightDurationMs: summary.firstGraphPreflightDurationMs,
							firstGraphPreflightTimings: summary.firstGraphPreflightTimings,
						})
					: failed("live-graph-adoption", "live Codex did not use Cartographer graph context", {
							toolCommandCount: summary.toolCommandCount,
							sourceReadCommandsBeforeGraph: summary.sourceReadCommandsBeforeGraph,
						}),
			),
			check("live-graph-first", () =>
				graphFirst.passed
					? passed("live Codex used graph context before source reads")
					: failed("live-graph-first", "live Codex graph-first gate failed", {
							failures: graphFirst.failures,
							sourceReadCommandsBeforeGraph: summary.sourceReadCommandsBeforeGraph,
						}),
			),
			check("live-expectations", () =>
				expectations.passed
					? passed("live Codex final answer and executed validation expectations passed", {
							...expectations.metrics,
						})
					: failed("live-expectations", "live Codex trace expectation failed", {
							failures: expectations.failures,
							metrics: expectations.metrics,
						}),
			),
		];
	});
}

async function runLiveCodex(
	options: EvalOptions,
	rawJsonlPath: string,
): Promise<{
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly rawJsonlPath: string;
	readonly events: readonly RuntimeEvent[];
}> {
	const prompt = [
		"Do not edit files.",
		"First run exactly this command:",
		"bun run cartographer:preflight -- --root /Users/saint/dev/agent-runtime-kernel --live --path src/kernel/turn-executor.ts --out /tmp/cartographer-live-codex-adoption",
		"Then run exactly this validation command:",
		"bun test src/code-graph/__tests__/adoption.test.ts",
		"Then reply with exactly one compact line containing CODEX_LIVE_CARTOGRAPHER_OK, src/kernel/turn-executor.ts, and bun test src/code-graph/__tests__/adoption.test.ts.",
	].join(" ");
	const args = [
		"exec",
		"--json",
		"--ephemeral",
		"-s",
		"read-only",
		"-c",
		'approval_policy="never"',
		"-C",
		process.cwd(),
		...(options.codexModel === undefined ? [] : ["-m", options.codexModel]),
		prompt,
	];
	const proc = Bun.spawn([options.codexPath, ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	await writeFile(rawJsonlPath, stdout);
	return {
		exitCode,
		stdout,
		stderr,
		rawJsonlPath,
		events: codexExecJsonlToRuntimeEvents(stdout),
	};
}

function codexExecJsonlToRuntimeEvents(jsonl: string): readonly RuntimeEvent[] {
	return jsonl
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.flatMap((line, index) => codexExecEventToRuntimeEvents(JSON.parse(line) as unknown, index));
}

function codexExecEventToRuntimeEvents(value: unknown, index: number): readonly RuntimeEvent[] {
	if (!isRecord(value)) return [];
	const type = typeof value.type === "string" ? value.type : "";
	const item = isRecord(value.item) ? value.item : undefined;
	const timestamp = new Date(Date.now() + index).toISOString();
	if ((type === "item.started" || type === "item.completed") && item?.type === "command_execution") {
		const command = typeof item.command === "string" ? item.command : undefined;
		if (command === undefined) return [];
		const base: RuntimeEvent = {
			type: "tool_use",
			turnId: "codex-live",
			timestamp,
			data: { status: type === "item.started" ? "started" : "completed", item: { type: "commandExecution", command } },
		};
		const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
		const preflight = preflightResultFromCommandOutput(command, output, timestamp);
		return preflight === undefined ? [base] : [base, preflight];
	}
	if (type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
		return [{ type: "result", turnId: "codex-live", timestamp, data: { text: item.text } }];
	}
	return [];
}

function preflightResultFromCommandOutput(
	command: string,
	output: string,
	timestamp: string,
): RuntimeEvent | undefined {
	if (!command.includes("cartographer:preflight") && !command.includes("cartographer preflight")) return undefined;
	const parsed = parseJsonObject(output);
	if (!isRecord(parsed.preflight)) return undefined;
	const preflight = parsed.preflight;
	return {
		type: "tool_result",
		turnId: "codex-live",
		timestamp,
		data: {
			name: "cartographer.preflight",
			command,
			durationMs: typeof preflight.durationMs === "number" ? preflight.durationMs : undefined,
			timings: isRecord(preflight.timings) ? preflight.timings : undefined,
		},
	};
}

function parseJsonObject(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

async function codexTraceSuite(options: EvalOptions): Promise<EvalSuite> {
	return timedSuite("codex-trace-adoption", "recorded Codex-style graph adoption traces", async () => {
		const suite = await readCodexTraceSuite(options.traceSuite);
		return suite.cases.flatMap((traceCase) => codexTraceChecks(traceCase, options.traceSuite));
	});
}

async function codexOutcomeSuite(options: EvalOptions): Promise<EvalSuite> {
	return timedSuite("codex-trace-outcomes", "recorded graph-vs-baseline outcome comparisons", async () => {
		const suite = await readCodexTraceSuite(options.traceSuite);
		const groups = groupedComparisonCases(suite.cases);
		if (groups.length === 0) return [failed("comparison-groups", "no comparison groups were configured")];
		return groups.flatMap((group) => codexOutcomeChecks(group, options.traceSuite));
	});
}

interface CodexComparisonGroup {
	readonly id: string;
	readonly baseline: CodexTraceCase;
	readonly graph: CodexTraceCase;
}

function groupedComparisonCases(cases: readonly CodexTraceCase[]): readonly CodexComparisonGroup[] {
	const grouped = new Map<string, CodexTraceCase[]>();
	for (const traceCase of cases) {
		if (traceCase.comparisonGroup === undefined) continue;
		grouped.set(traceCase.comparisonGroup, [...(grouped.get(traceCase.comparisonGroup) ?? []), traceCase]);
	}
	return [...grouped.entries()].flatMap(([id, groupCases]) => {
		const baseline = groupCases.find((traceCase) => traceCase.condition === "baseline-direct");
		const graph = groupCases.find((traceCase) => traceCase.condition !== "baseline-direct");
		return baseline === undefined || graph === undefined ? [] : [{ id, baseline, graph }];
	});
}

function codexOutcomeChecks(group: CodexComparisonGroup, suitePath: string): readonly EvalCheck[] {
	const baseline = traceOutcomeMetrics(group.baseline, suitePath);
	const graph = traceOutcomeMetrics(group.graph, suitePath);
	return [
		check(`${group.id}:expected-evidence-non-regression`, () =>
			graph.expectations.passed &&
			baseline.expectations.passed &&
			graph.expectations.metrics.finalPathHitCount >= baseline.expectations.metrics.finalPathHitCount &&
			graph.expectations.metrics.executedCommandHitCount >= baseline.expectations.metrics.executedCommandHitCount
				? passed("graph-assisted trace preserved expected file and validation evidence", {
						baseline: baseline.expectations.metrics,
						graph: graph.expectations.metrics,
					})
				: failed(`${group.id}:expected-evidence-non-regression`, "graph-assisted trace regressed expected evidence", {
						baseline: baseline.expectations,
						graph: graph.expectations,
					}),
		),
		check(`${group.id}:source-read-noise`, () =>
			graph.irrelevantSourceReadCount <= baseline.irrelevantSourceReadCount &&
			graph.sourceReadCount <= baseline.sourceReadCount
				? passed("graph-assisted trace did not increase source-read noise", {
						baseline: sourceReadMetrics(baseline),
						graph: sourceReadMetrics(graph),
					})
				: failed(`${group.id}:source-read-noise`, "graph-assisted trace increased source-read noise", {
						baseline: sourceReadMetrics(baseline),
						graph: sourceReadMetrics(graph),
					}),
		),
		check(`${group.id}:unsupported-path-claims`, () =>
			graph.unsupportedPathClaimCount <= baseline.unsupportedPathClaimCount
				? passed("graph-assisted trace did not increase unsupported path claims", {
						baseline: unsupportedPathMetrics(baseline),
						graph: unsupportedPathMetrics(graph),
					})
				: failed(`${group.id}:unsupported-path-claims`, "graph-assisted trace increased unsupported path claims", {
						baseline: unsupportedPathMetrics(baseline),
						graph: unsupportedPathMetrics(graph),
					}),
		),
	];
}

interface TraceOutcomeMetrics {
	readonly expectations: ReturnType<typeof checkTraceExpectations>;
	readonly sourceReadCount: number;
	readonly irrelevantSourceReadCount: number;
	readonly unsupportedPathClaimCount: number;
	readonly sourceReadCommands: readonly string[];
	readonly irrelevantSourceReadCommands: readonly string[];
	readonly unsupportedPathClaims: readonly string[];
}

function traceOutcomeMetrics(traceCase: CodexTraceCase, suitePath: string): TraceOutcomeMetrics {
	const events = readRuntimeEventsSync(resolve(dirname(suitePath), traceCase.trace));
	const expectationInput = traceExpectationInput(traceCase) ?? {};
	const expectedPaths = expectedPathClaims(traceCase);
	const sourceReadCommands = toolCommands(events).filter(isSourceReadCommand);
	const irrelevantSourceReadCommands = sourceReadCommands.filter((command) => !containsAnyExpectedPath(command, expectedPaths));
	const unsupportedPathClaims = finalPathClaims(events).filter((path) => !expectedPaths.has(path));
	return {
		expectations: checkTraceExpectations(events, expectationInput),
		sourceReadCount: sourceReadCommands.length,
		irrelevantSourceReadCount: irrelevantSourceReadCommands.length,
		unsupportedPathClaimCount: unsupportedPathClaims.length,
		sourceReadCommands,
		irrelevantSourceReadCommands,
		unsupportedPathClaims,
	};
}

function sourceReadMetrics(metrics: TraceOutcomeMetrics): Record<string, unknown> {
	return {
		sourceReadCount: metrics.sourceReadCount,
		irrelevantSourceReadCount: metrics.irrelevantSourceReadCount,
		irrelevantSourceReadCommands: metrics.irrelevantSourceReadCommands,
	};
}

function unsupportedPathMetrics(metrics: TraceOutcomeMetrics): Record<string, unknown> {
	return {
		unsupportedPathClaimCount: metrics.unsupportedPathClaimCount,
		unsupportedPathClaims: metrics.unsupportedPathClaims,
	};
}

function containsAnyExpectedPath(command: string, expectedPaths: ReadonlySet<string>): boolean {
	return [...expectedPaths].some((path) => command.includes(path));
}

function expectedPathClaims(traceCase: CodexTraceCase): ReadonlySet<string> {
	return new Set([
		...(traceCase.expectedPaths ?? []),
		...(traceCase.expectedCommands ?? []).flatMap(pathClaimsFromText),
		...(traceCase.expectedExecutedCommands ?? []).flatMap(pathClaimsFromText),
	]);
}

function pathClaimsFromText(text: string): readonly string[] {
	return [...text.matchAll(/\b(?:src|apps|packages|infra|supabase|\.github)\/[A-Za-z0-9_./:-]+/g)].map(
		(match) => match[0],
	);
}

function toolCommands(events: readonly RuntimeEvent[]): readonly string[] {
	return events.flatMap((event) => {
		if (event.type !== "tool_use") return [];
		const command = commandTextFromRuntimeData(event.data);
		return command === undefined ? [] : [command];
	});
}

function commandTextFromRuntimeData(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined;
	const command = value["command"];
	if (typeof command === "string") return command;
	if (Array.isArray(command)) return command.join(" ");
	const item = value["item"];
	if (!isRecord(item)) return undefined;
	const itemCommand = item["command"];
	if (typeof itemCommand === "string") return itemCommand;
	if (Array.isArray(itemCommand)) return itemCommand.join(" ");
	return undefined;
}

function finalPathClaims(events: readonly RuntimeEvent[]): readonly string[] {
	const text = events.flatMap((event) => {
		if (event.type !== "result") return [];
		const data = isRecord(event.data) ? event.data : {};
		return typeof data["text"] === "string" ? [data["text"]] : [];
	}).join("\n");
	return [...new Set(pathClaimsFromText(text))];
}

function codexTraceChecks(traceCase: CodexTraceCase, suitePath: string): readonly EvalCheck[] {
	const tracePath = resolve(dirname(suitePath), traceCase.trace);
	return [
		check(`${traceCase.id}:adoption`, () => {
			const events = readRuntimeEventsSync(tracePath);
			const summary = analyzeGraphCommandAdoption(events);
			return summary.adopted === traceCase.expectedAdopted
				? passed(`${traceCase.id} adoption matched expected condition`, {
						condition: traceCase.condition,
						adopted: summary.adopted,
						eventCount: summary.eventCount,
						traceDurationMs: summary.traceDurationMs,
						toolCommandCount: summary.toolCommandCount,
						sourceReadBeforeGraphCount: summary.sourceReadBeforeGraphCount,
						firstGraphCommandOffsetMs: summary.firstGraphCommandOffsetMs,
						graphPreflightResultCount: summary.graphPreflightResultCount,
						firstGraphPreflightDurationMs: summary.firstGraphPreflightDurationMs,
						firstGraphPreflightTimings: summary.firstGraphPreflightTimings,
					})
				: failed(`${traceCase.id}:adoption`, `${traceCase.id} adoption did not match expected condition`, {
						expectedAdopted: traceCase.expectedAdopted,
						actualAdopted: summary.adopted,
						firstGraphCommand: summary.firstGraphCommand,
						sourceReadCommandsBeforeGraph: summary.sourceReadCommandsBeforeGraph,
					});
		}),
		...(traceCase.requireGraphFirst === true
			? [
					check(`${traceCase.id}:graph-first`, () => {
						const summary = analyzeGraphCommandAdoption(readRuntimeEventsSync(tracePath));
						const graphFirst = checkGraphFirstAdoption(summary);
						return graphFirst.passed
							? passed(`${traceCase.id} used graph context before source reads`)
							: failed(`${traceCase.id}:graph-first`, `${traceCase.id} graph-first gate failed`, {
									failures: graphFirst.failures,
									sourceReadCommandsBeforeGraph: summary.sourceReadCommandsBeforeGraph,
								});
					}),
				]
			: []),
		check(`${traceCase.id}:expectations`, () => {
			const expectationInput = traceExpectationInput(traceCase);
			if (expectationInput === undefined) {
				return passed(`${traceCase.id} has no final-response expectations`);
			}
			const expectation = checkTraceExpectations(readRuntimeEventsSync(tracePath), expectationInput);
			return expectation.passed
				? passed(`${traceCase.id} final response and executed command expectations passed`, {
						...expectation.metrics,
					})
				: failed(`${traceCase.id}:expectations`, `${traceCase.id} trace expectation failed`, {
						failures: expectation.failures,
						metrics: expectation.metrics,
					});
		}),
	];
}

async function readCodexTraceSuite(path: string): Promise<CodexTraceSuite> {
	const value = JSON.parse(await readFile(path, "utf8")) as unknown;
	if (!isRecord(value) || !Array.isArray(value.cases)) {
		throw new Error(`Codex trace suite is invalid: ${path}`);
	}
	return value as CodexTraceSuite;
}

function readRuntimeEventsSync(path: string): readonly RuntimeEvent[] {
	const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
	if (!Array.isArray(value)) throw new Error(`trace must be a RuntimeEvent[]: ${path}`);
	return value.map((event, index) => {
		if (isRuntimeEvent(event)) return event;
		throw new Error(`trace event ${index} is not a RuntimeEvent: ${path}`);
	});
}

function traceExpectationInput(traceCase: CodexTraceCase): TraceExpectationInput | undefined {
	const input: TraceExpectationInput = {
		...(traceCase.expectedText === undefined ? {} : { text: traceCase.expectedText }),
		...(traceCase.expectedPaths === undefined ? {} : { path: traceCase.expectedPaths }),
		...(traceCase.expectedCommands === undefined ? {} : { command: traceCase.expectedCommands }),
		...(traceCase.expectedExecutedCommands === undefined
			? {}
			: { executedCommand: traceCase.expectedExecutedCommands }),
	};
	return Object.keys(input).length === 0 ? undefined : input;
}

async function graphContractSuite(
	id: string,
	root: string,
	outDir: string,
	maxFileBytes: number,
): Promise<EvalSuite> {
	return timedSuite(`graph-contract:${id}`, `${id} graph contract`, async () => {
		const timedGraph = await timed(() => buildCodeGraph({ root, maxFileBytes }));
		await writeCodeGraphArtifacts(timedGraph.value, { outDir });
		return [
			check("schema-valid", () => {
				codeGraphSnapshotSchema.parse(timedGraph.value);
				return passed("graph snapshot validates", graphMetrics(timedGraph.value, timedGraph.durationMs));
			}),
			check("unique-node-ids", () => duplicateIdCheck("node", timedGraph.value.nodes.map((node) => node.id))),
			check("unique-edge-ids", () => duplicateIdCheck("edge", timedGraph.value.edges.map((edge) => edge.id))),
			check("edge-endpoints-exist", () => edgeEndpointCheck(timedGraph.value)),
			check("no-default-ignored-paths", () => ignoredPathCheck(timedGraph.value)),
			check("no-env-secret-values", () => envSecretValueCheck(timedGraph.value)),
		];
	});
}

async function briefPacketSuite(root: string, maxFileBytes: number): Promise<EvalSuite> {
	return timedSuite("brief-packet:self", "bounded brief packet", async () => {
		const graph = await buildCodeGraph({ root, maxFileBytes });
		const packet = buildBrief(graph, {
			path: "src/code-graph/commands.ts",
			requestedTokens: 8_000,
			depth: 1,
		});
		const firstPath = packet.readFirst[0];
		return [
			check("schema-version", () =>
				packet.schemaVersion === "cartographer.brief.v1" && packet.kind === "brief"
					? passed("brief packet has expected schema")
					: failed("schema-version", "brief packet schema was unexpected", {
							schemaVersion: packet.schemaVersion,
							kind: packet.kind,
						}),
			),
			check("budget-compliance", () =>
				packet.budget.estimatedTokens <= packet.budget.requestedTokens
					? passed("brief stayed under requested token budget", {
							estimatedTokens: packet.budget.estimatedTokens,
							requestedTokens: packet.budget.requestedTokens,
							omissions: packet.omissions.length,
						})
					: failed("budget-compliance", "brief exceeded requested token budget", { budget: packet.budget }),
			),
			check("anchor-first", () =>
				firstPath?.path === "src/code-graph/commands.ts"
					? passed("path brief ranks the selected path first", {
							nodeId: firstPath.nodeId,
							kind: firstPath.kind,
						})
					: failed("anchor-first", "path brief did not rank selected path first", { firstPath }),
			),
			check("bounded-sections", () =>
				packet.readFirst.length <= 15 && packet.impact.length <= 25 && packet.validation.length <= 12
					? passed("brief sections are bounded", {
							readFirst: packet.readFirst.length,
							impact: packet.impact.length,
							validation: packet.validation.length,
						})
					: failed("bounded-sections", "brief sections exceeded default bounds", {
							readFirst: packet.readFirst.length,
							impact: packet.impact.length,
							validation: packet.validation.length,
						}),
			),
		];
	});
}

async function removalAuditSuite(runOutDir: string, maxFileBytes: number): Promise<EvalSuite> {
	return timedSuite("removal-audit:fixture", "removal audit fixture", async () => {
		const root = await writeSupabaseRemovalFixture();
		const graph = await buildCodeGraph({ root, maxFileBytes });
		const ledger = await buildRemovalAudit(graph, { target: "supabase" });
		const verified = await verifyRemovalAudit(graph, ledger, { failOnLeftovers: true });
		const classes = new Map(ledger.classes.map((classEntry) => [classEntry.class, classEntry]));
		return [
			check("ledger-schema", () =>
				ledger.schemaVersion === "cartographer.audit-ledger.v1" && ledger.kind === "removal"
					? passed("removal ledger has expected schema")
					: failed("ledger-schema", "removal ledger schema was unexpected", {
							schemaVersion: ledger.schemaVersion,
							kind: ledger.kind,
						}),
			),
			check("evidence-class-recall", () =>
				(["package-dependency", "import-or-sdk-client", "env-var", "rls-policy", "ci-secret-name"] as const).every(
					(className: RemovalEvidenceClass) => (classes.get(className)?.active.length ?? 0) > 0,
				)
					? passed("fixture audit found seeded evidence classes")
					: failed("evidence-class-recall", "fixture audit missed seeded evidence classes", {
							classes: [...classes.values()].map((entry) => ({
								class: entry.class,
								active: entry.active.length,
								status: entry.status,
							})),
						}),
			),
			check("fail-on-leftovers", () =>
				verified.verdict.status === "failed" && verified.verdict.blockers.length > 0
					? passed("audit verify fails closed when leftovers remain", {
							blockers: verified.verdict.blockers,
						})
					: failed("fail-on-leftovers", "audit verify did not fail closed for leftovers", {
							verdict: verified.verdict,
						}),
			),
		];
	});
}

async function notesLifecycleSuite(runOutDir: string, maxFileBytes: number): Promise<EvalSuite> {
	return timedSuite("notes-lifecycle:fixture", "notes lifecycle fixture", async () => {
		const root = await writeNotesFixture();
		const graph = await buildCodeGraph({ root, maxFileBytes });
		const outDir = join(runOutDir, "notes-artifacts");
		await writeCodeGraphArtifacts(graph, { outDir });
		const reportPath = join(runOutDir, "notes-report.json");
		await writeFile(
			reportPath,
			JSON.stringify({
				target: "notes-fixture",
				claims: [
					{
						kind: "test-guidance",
						summary: "Use the colocated test when changing the fixture entrypoint.",
						evidence: [{ path: "src/index.ts" }],
					},
				],
			}),
		);
		const ingest = await ingestNotesReport(graph, { outDir, reportPath, authorName: "eval" });
		const noteId = ingest.annotations[0]?.id;
		const accepted = noteId === undefined ? undefined : await reviewNote(graph, outDir, { action: "accept", noteId, reviewer: "eval" });
		await writeFile(join(root, "src/index.ts"), "export const value = 2;\n");
		const staleAudit = await auditNotes(await buildCodeGraph({ root, maxFileBytes }), outDir);
		return [
			check("ingest-candidate", () =>
				ingest.ingestedCount === 1 && ingest.annotations[0]?.status === "candidate"
					? passed("notes ingest creates candidate notes", { noteId })
					: failed("ingest-candidate", "notes ingest did not create one candidate note", {
							ingestedCount: ingest.ingestedCount,
							annotations: ingest.annotations,
						}),
			),
			check("accept-grounded", () =>
				accepted?.annotation.status === "accepted" && accepted.audit.summary.usableAcceptedCount === 1
					? passed("audit-clean candidate can be accepted", { noteId })
					: failed("accept-grounded", "accepted note was not usable", { accepted }),
			),
			check("stale-after-drift", () =>
				staleAudit.issues.some(
					(issue) => issue.annotationId === noteId && issue.code === "evidence-hash-mismatch",
				)
					? passed("accepted note becomes stale after evidence hash drift", { noteId })
					: failed("stale-after-drift", "note audit did not detect evidence hash drift", {
							noteId,
							issues: staleAudit.issues,
						}),
			),
		];
	});
}

async function writeSupabaseRemovalFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "cartographer-removal-eval-"));
	await mkdir(join(root, "src/auth"), { recursive: true });
	await mkdir(join(root, "supabase/migrations"), { recursive: true });
	await mkdir(join(root, ".github/workflows"), { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "removal-fixture",
			scripts: { test: "bun test", typecheck: "tsc --noEmit" },
			dependencies: { "@supabase/supabase-js": "2.0.0" },
		}),
	);
	await writeFile(
		join(root, "src/auth/client.ts"),
		"import { createClient } from '@supabase/supabase-js';\nexport const supabase = createClient(Bun.env.SUPABASE_URL!, Bun.env.SUPABASE_ANON_KEY!);\n",
	);
	await writeFile(
		join(root, "supabase/migrations/0001_policy.sql"),
		"create policy user_policy on public.users using (auth.uid() = user_id);\n",
	);
	await writeFile(
		join(root, ".github/workflows/ci.yml"),
		"name: ci\njobs:\n  test:\n    steps:\n      - run: echo ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}\n",
	);
	return root;
}

async function writeNotesFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "cartographer-notes-eval-"));
	await mkdir(join(root, "src"), { recursive: true });
	await writeFile(join(root, "package.json"), JSON.stringify({ name: "notes-fixture", scripts: { test: "bun test" } }));
	await writeFile(join(root, "src/index.ts"), "export const value = 1;\n");
	await writeFile(join(root, "src/index.test.ts"), "import { value } from './index';\ntest('value', () => value);\n");
	return root;
}

async function arkPreflightSuite(options: EvalOptions, outDir: string): Promise<EvalSuite> {
	return timedSuite("ark-preflight", "ARK read-only preflight navigation", async () => {
		const targetPath = "src/kernel/turn-executor.ts";
		const result = await runCartographerPreflight({
			root: options.targetRoot,
			outDir,
			path: targetPath,
			live: true,
			maxFileBytes: options.maxFileBytes,
		});
		if (!result.ok) {
			return [failed("preflight-runs", result.error.message, { code: result.error.code })];
		}
		const context = result.data.context;
		const validationCommands = context.summary.validationCommands.map((command) => command.runCommand ?? command.command);
		return [
			check("target-path-present", () =>
				expectIncludes(context.summary.primaryPaths, targetPath, "target path appears in primary paths"),
			),
			check("focused-tests-present", () =>
				expectAllIncluded(
					context.summary.testPaths,
					["src/kernel/__tests__/turn-executor.test.ts"],
					"focused test paths are present",
				),
			),
			check("focused-commands-first", () =>
				expectAllIncluded(
					validationCommands.slice(0, 3).filter((item): item is string => item !== undefined),
					["bun test ./src/kernel/__tests__/turn-executor.test.ts"],
					"focused validation commands lead compact context",
				),
			),
			check("compact-command-limit-recorded", () =>
				context.limits.validationCommands > 0
					? passed("compact validation command limit is recorded", {
							limit: context.limits.validationCommands,
							omitted: context.omissions.validationCommands,
							emitted: context.summary.validationCommands.length,
						})
					: failed("compact-command-limit-recorded", "compact validation command limit was not positive"),
			),
			check("preflight-timings-recorded", () =>
				passed("preflight timing phases recorded", {
					durationMs: result.data.durationMs,
					...result.data.timings,
				}),
			),
		];
	});
}

async function timedSuite(
	id: string,
	title: string,
	buildChecks: () => Promise<readonly EvalCheck[]>,
): Promise<EvalSuite> {
	const startedAtMs = Date.now();
	const startedAt = new Date(startedAtMs).toISOString();
	const checks = await buildChecks();
	const finishedAtMs = Date.now();
	return {
		id,
		title,
		status: aggregateStatus(checks.map((check) => check.status)),
		startedAt,
		finishedAt: new Date(finishedAtMs).toISOString(),
		durationMs: finishedAtMs - startedAtMs,
		checks,
	};
}

async function timed<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
	const startedAt = Date.now();
	const value = await fn();
	return { value, durationMs: Date.now() - startedAt };
}

function check(id: string, fn: () => EvalCheck): EvalCheck {
	try {
		return { ...fn(), id };
	} catch (cause) {
		return failed(id, cause instanceof Error ? cause.message : String(cause));
	}
}

function passed(summary: string, metrics?: Record<string, unknown>): EvalCheck {
	return { id: "", status: "passed", summary, ...(metrics === undefined ? {} : { metrics }) };
}

function failed(id: string, summary: string, evidence?: Record<string, unknown>): EvalCheck {
	return { id, status: "failed", summary, ...(evidence === undefined ? {} : { evidence }) };
}

function duplicateIdCheck(kind: string, ids: readonly string[]): EvalCheck {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) duplicates.add(id);
		seen.add(id);
	}
	return duplicates.size === 0
		? passed(`no duplicate ${kind} ids`, { count: ids.length })
		: failed(`unique-${kind}-ids`, `duplicate ${kind} ids found`, { duplicates: [...duplicates] });
}

function edgeEndpointCheck(graph: CodeGraphSnapshot): EvalCheck {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const dangling = graph.edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));
	return dangling.length === 0
		? passed("all edge endpoints exist", { edgeCount: graph.edges.length })
		: failed("edge-endpoints-exist", "dangling edges found", { dangling: dangling.slice(0, 20) });
}

function ignoredPathCheck(graph: CodeGraphSnapshot): EvalCheck {
	const contaminated = graph.nodes
		.map((node) => node.path)
		.filter((path): path is string => path !== undefined)
		.filter((path) => ignoredPath(path));
	return contaminated.length === 0
		? passed("ignored output paths are excluded")
		: failed("no-default-ignored-paths", "ignored paths entered graph", { paths: contaminated.slice(0, 20) });
}

function envSecretValueCheck(graph: CodeGraphSnapshot): EvalCheck {
	const offenders = graph.nodes
		.filter((node) => node.kind === "EnvVar")
		.filter((node) =>
			Object.entries(node.metadata).some(([key, value]) => key.toLowerCase().includes("value") && value !== undefined),
		)
		.map((node) => node.id);
	return offenders.length === 0
		? passed("env var nodes do not expose raw values")
		: failed("no-env-secret-values", "env var metadata contains value-like fields", { offenders });
}

function expectIncludes(items: readonly string[], expected: string, summary: string): EvalCheck {
	return items.includes(expected) ? passed(summary) : failed(summaryId(summary), `${summary}: missing ${expected}`, { items });
}

function expectAllIncluded(items: readonly string[], expected: readonly string[], summary: string): EvalCheck {
	const missing = expected.filter((item) => !items.includes(item));
	return missing.length === 0 ? passed(summary) : failed(summaryId(summary), `${summary}: missing expected items`, { missing, items });
}

function graphMetrics(graph: CodeGraphSnapshot, durationMs: number): Record<string, unknown> {
	return {
		durationMs,
		files: graph.manifest.totals.files,
		nodes: graph.nodes.length,
		edges: graph.edges.length,
		findings: graph.findings.length,
		gitDirty: graph.manifest.git.dirty,
	};
}

function ignoredPath(path: string): boolean {
	return (
		path === "node_modules" ||
		path.startsWith("node_modules/") ||
		path.includes("/node_modules/") ||
		path === "dist" ||
		path.startsWith("dist/") ||
		path.includes("/dist/") ||
		path === ".git" ||
		path.startsWith(".git/") ||
		path.includes("/.git/") ||
		path === ".cartographer" ||
		path.startsWith(".cartographer/") ||
		path.includes("/.cartographer/") ||
		path === "docs/codegraph" ||
		path.startsWith("docs/codegraph/")
	);
}

function aggregateStatus(statuses: readonly EvalStatus[]): EvalStatus {
	if (statuses.length === 0) return "skipped";
	return statuses.toSorted((left, right) => STATUS_ORDER[right] - STATUS_ORDER[left])[0] ?? "skipped";
}

async function environment(): Promise<Record<string, unknown>> {
	return {
		cwd: process.cwd(),
		platform: process.platform,
		arch: process.arch,
		bunVersion: Bun.version,
		git: {
			commit: await commandText(["git", "rev-parse", "HEAD"]),
			dirty: (await commandText(["git", "status", "--short"])).length > 0,
		},
	};
}

async function commandText(command: readonly string[]): Promise<string> {
	const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
	const output = await new Response(proc.stdout).text();
	await proc.exited;
	return output.trim();
}

function evalOptions(argv: readonly string[]): EvalOptions {
	const flags = flagsFor(argv);
	return {
		profile: flags.get("profile") ?? "smoke",
		targetRoot: resolve(flags.get("target-root") ?? "/Users/saint/dev/agent-runtime-kernel"),
		reportDir: resolve(flags.get("report-dir") ?? "docs/reports"),
		outBase: resolve(flags.get("out-base") ?? "/tmp/cartographer-code-graph-evals"),
		maxFileBytes: Number.parseInt(flags.get("max-file-bytes") ?? "500000", 10),
		traceSuite: resolve(flags.get("trace-suite") ?? ".evals/fixtures/codex-traces/cases.json"),
		live: flags.get("live") === "true",
		codexPath: flags.get("codex-path") ?? "codex",
		codexModel: flags.get("codex-model"),
	};
}

function flagsFor(argv: readonly string[]): ReadonlyMap<string, string> {
	const flags = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg?.startsWith("--")) continue;
		const name = arg.slice(2);
		const next = argv[index + 1];
		if (next !== undefined && !next.startsWith("--")) {
			flags.set(name, next);
			index += 1;
		} else {
			flags.set(name, "true");
		}
	}
	return flags;
}

function timestampForRunId(iso: string): string {
	return iso.replaceAll(":", "-").replaceAll(".", "-");
}

function summaryId(summary: string): string {
	return summary.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
	return (
		isRecord(value) &&
		typeof value.type === "string" &&
		typeof value.turnId === "string" &&
		typeof value.timestamp === "string" &&
		"data" in value
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

await main();
