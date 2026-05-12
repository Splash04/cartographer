import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HarnessError } from "../shared/errors.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { ParsedArgs } from "../cli/args.ts";
import { flagString, hasFlag } from "../cli/args.ts";
import { writeOut } from "../cli/io.ts";
import type { RuntimeEvent } from "../core/types.ts";
import {
	analyzeGraphCommandAdoption,
	checkGraphFirstAdoption,
	checkTraceExpectations,
	type GraphCommandAdoptionSummary,
	type GraphFirstAdoptionCheck,
	type TraceExpectedValue,
	type TraceExpectationCheck,
	type TraceExpectationInput,
} from "./adoption.ts";
import {
	checkCodeGraphArtifacts,
	readCodeGraph,
	writeCodeGraphArtifacts,
	writeDebugJsonGraph,
	writeJsonlGraphExports,
	type CodeGraphArtifactCompatibility,
} from "./artifacts.ts";
import {
	buildRemovalAudit,
	readAuditLedger,
	renderAuditLedgerMarkdown,
	verifyRemovalAudit,
	writeAuditLedger,
	type AuditLedger,
} from "./audit.ts";
import { buildBrief, renderBriefPrompt, type BriefFormat, type BriefMode } from "./brief.ts";
import { buildCodeGraph } from "./builder.ts";
import {
	buildGraphContext,
	compactGraphContext,
	contextSelectorFor,
	renderGraphContextList,
	renderGraphContextSummary,
} from "./context.ts";
import { diffCodeGraphs, renderCodeGraphDiff } from "./diff.ts";
import type { CodeGraphDiff } from "./diff.ts";
import { runCartographerMcpServer } from "./mcp.ts";
import { annotateSliceWithOpenRouter, DEFAULT_OPENROUTER_MODEL } from "./openrouter.ts";
import {
	auditAnnotationOverlay,
	graphWithAnnotationOverlay,
	readAnnotationOverlay,
	renderAnnotationOverlayAudit,
	type AnnotationOverlayAudit,
	type AnnotationOverlayLoadResult,
} from "./overlays.ts";
import {
	auditNotes,
	ingestNotesReport,
	reviewNote,
	type NoteReviewResult,
	type NotesIngestResult,
} from "./notes.ts";
import { impactGraph, renderSlice, sliceGraph, summarizeGraph } from "./query.ts";
import { runCartographerPreflight, type CartographerPreflightResult } from "./preflight.ts";
import type { AgentAnnotation, GraphContext, GraphContextCompact, GraphSlice } from "./types.ts";

type CartographerHandler = (args: ParsedArgs) => Promise<Result<void, HarnessError>>;

interface AdoptionTraceAnalysis {
	readonly events: readonly RuntimeEvent[];
	readonly summary: GraphCommandAdoptionSummary;
}

const cartographerHandlers: Record<string, CartographerHandler> = {
	help: runHelp,
	mcp: runMcp,
	index: runIndex,
	update: runIndex,
	verify: runVerify,
	view: runView,
	brief: runBrief,
	audit: runAudit,
	notes: runNotes,
	export: runExport,
	diff: runDiff,
	slice: runSlice,
	impact: runImpact,
	context: runContext,
	preflight: runPreflight,
	adoption: runAdoption,
	annotate: runAnnotate,
	annotations: runAnnotations,
};

export async function runCartographer(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	const subcommand = args.positionals[0] ?? "help";
	const handler = cartographerHandlers[subcommand];
	return handler === undefined
		? err(new HarnessError("VALIDATION_FAILED", `unknown cartographer subcommand: ${subcommand}`))
		: handler(args);
}

async function runHelp(): Promise<Result<void, HarnessError>> {
	await writeOut(cartographerHelp());
	return ok(undefined);
}

async function runMcp(): Promise<Result<void, HarnessError>> {
	try {
		await runCartographerMcpServer();
		return ok(undefined);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runIndex(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const root = flagString(args, "root", ".");
		const outDir = graphOutDir(args);
		const maxFileBytes = numberFlag(args, "max-file-bytes", 750_000);
		const graph = await buildCodeGraph({ root, maxFileBytes });
		await writeCodeGraphArtifacts(graph, { outDir, mapPath: mapPath(args, outDir), debugJson: hasFlag(args, "debug-json") });
		await writeOut(`${summarizeGraph(graph)}Artifacts: ${outDir}\n`);
		return ok(undefined);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runView(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const graph = await loadGraph(args);
		if (hasFlag(args, "json")) {
			await writeOut(`${JSON.stringify(graph.manifest, null, 2)}\n`);
			return ok(undefined);
		}
		await writeOut(summarizeGraph(graph));
		return ok(undefined);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runVerify(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const outDir = graphOutDir(args);
		const compatibility = await checkCodeGraphArtifacts(outDir);
		const freshness = hasFlag(args, "fresh") ? await graphFreshnessCheck(args, outDir) : undefined;
		const output = verifyOutput(compatibility, freshness);
		await writeOut(
			hasFlag(args, "json")
				? `${JSON.stringify(output, null, 2)}\n`
				: renderArtifactCompatibility(output),
		);
		if (!output.ok) {
			return err(new HarnessError("VALIDATION_FAILED", `code graph artifacts are incompatible: ${outDir}`));
		}
		return ok(undefined);
	} catch (cause) {
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runBrief(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const graph = await loadGraph(args);
		const auditRef = optionalFlagString(args, "audit");
		const auditLedger = auditRef === undefined ? undefined : await resolveAuditLedger(args, auditRef);
		const packet = buildBrief(graph, {
			mode: modeFlag(args),
			path: optionalFlagString(args, "path"),
			packageId: optionalFlagString(args, "package"),
			env: optionalFlagString(args, "env"),
			db: optionalFlagString(args, "db"),
			iac: optionalFlagString(args, "iac"),
			audit: auditRef,
			auditLedger,
			changed: hasFlag(args, "changed"),
			depth: optionalNumberFlag(args, "depth") ?? 1,
			requestedTokens: numberFlag(args, "budget", 8_000),
			live: hasFlag(args, "live"),
			limits: briefLimitsFromArgs(args),
		});
		const format = briefFormat(args);
		await writeOut(format === "json" ? `${JSON.stringify(packet, null, 2)}\n` : renderBriefPrompt(packet));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function resolveAuditLedger(args: ParsedArgs, auditRef: string): Promise<AuditLedger> {
	const direct = Bun.file(auditRef);
	if (await direct.exists()) return readAuditLedger(auditRef);
	const outDir = graphOutDir(args);
	const filename = auditRef.endsWith(".json") ? auditRef : `${auditRef}.json`;
	const path = join(outDir, "audits", filename);
	if (await Bun.file(path).exists()) return readAuditLedger(path);
	throw new HarnessError("VALIDATION_FAILED", `audit ledger not found: ${auditRef}`);
}

async function runExport(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const target = args.positionals[1] ?? "graph";
		if (target !== "graph") throw new HarnessError("VALIDATION_FAILED", "usage: cartographer export graph --format debug-json|jsonl");
		const graph = await readCodeGraph(flagString(args, "from", DEFAULT_OUT_DIR));
		const format = flagString(args, "format", "debug-json");
		const out = flagString(args, "out", defaultExportOut(format));
		if (format === "debug-json") {
			await writeDebugJsonGraph(graph, out);
			await writeOut(`Exported debug graph JSON to ${out}\n`);
			return ok(undefined);
		}
		if (format === "jsonl") {
			await writeJsonlGraphExports(graph, out);
			await writeOut(`Exported graph JSONL to ${out}\n`);
			return ok(undefined);
		}
		throw new HarnessError("VALIDATION_FAILED", `unsupported export format: ${format}`);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runAudit(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const action = args.positionals[1] ?? "help";
		if (action === "removal") return runRemovalAudit(args);
		if (action === "verify") return runAuditVerify(args);
		throw new HarnessError(
			"VALIDATION_FAILED",
			"usage: cartographer audit removal --target <target> | cartographer audit verify --ledger <ledger>",
		);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runRemovalAudit(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	const graph = await loadBaseGraph(args);
	const target = requiredFlag(args, "target", "usage: cartographer audit removal --target supabase");
	const ledger = await buildRemovalAudit(graph, {
		target,
		id: optionalFlagString(args, "id"),
		expectedAuthReplacement: optionalFlagString(args, "auth-replacement"),
		expectedDbReplacement: optionalFlagString(args, "db-replacement"),
	});
	await maybeWriteLedger(args, ledger);
	await writeAuditOutput(args, ledger);
	return ok(undefined);
}

async function runAuditVerify(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	const graph = await loadBaseGraph(args);
	const ledgerPath = requiredFlag(args, "ledger", "usage: cartographer audit verify --ledger .cartographer/audits/<id>.json");
	const verified = await verifyRemovalAudit(graph, await readAuditLedger(ledgerPath), {
		failOnLeftovers: hasFlag(args, "fail-on-leftovers"),
	});
	await maybeWriteLedger(args, verified);
	await writeAuditOutput(args, verified);
	if (verified.verdict.status === "failed") {
		return err(
			new HarnessError("VALIDATION_FAILED", `audit verification failed: ${verified.verdict.blockers.join("; ")}`),
		);
	}
	return ok(undefined);
}

async function maybeWriteLedger(args: ParsedArgs, ledger: AuditLedger): Promise<void> {
	const writePath = optionalFlagString(args, "write");
	if (writePath === undefined) return;
	await writeAuditLedger(writePath, ledger);
}

async function writeAuditOutput(args: ParsedArgs, ledger: AuditLedger): Promise<void> {
	const format = auditFormat(args);
	await writeOut(format === "json" ? `${JSON.stringify(ledger, null, 2)}\n` : renderAuditLedgerMarkdown(ledger));
}

function auditFormat(args: ParsedArgs): "json" | "markdown" {
	if (hasFlag(args, "json")) return "json";
	const format = flagString(args, "format", "markdown");
	return format === "json" ? "json" : "markdown";
}

async function runNotes(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const action = args.positionals[1] ?? "audit";
		if (action === "ingest") return runNotesIngest(args);
		if (action === "audit") return runNotesAudit(args);
		if (action === "accept" || action === "retire") return runNotesReview(args, action);
		throw new HarnessError(
			"VALIDATION_FAILED",
			"usage: cartographer notes ingest <report.json> | notes audit | notes accept <id> --reviewer <name> | notes retire <id> --reviewer <name>",
		);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runNotesIngest(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	const reportPath = args.positionals[2] ?? optionalFlagString(args, "report");
	if (reportPath === undefined) {
		throw new HarnessError("VALIDATION_FAILED", "usage: cartographer notes ingest <report.json>");
	}
	const graph = await loadBaseGraph(args);
	const result = await ingestNotesReport(graph, {
		outDir: graphOutDir(args),
		reportPath,
		authorName: optionalFlagString(args, "author"),
		runId: optionalFlagString(args, "run-id"),
	});
	await writeNotesIngestResult(args, result);
	return ok(undefined);
}

async function runNotesAudit(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	const graph = await loadBaseGraph(args);
	const audit = await auditNotes(graph, graphOutDir(args));
	await writeOut(hasFlag(args, "json") ? `${JSON.stringify(audit, null, 2)}\n` : renderAnnotationOverlayAudit(audit));
	return ok(undefined);
}

async function runNotesReview(args: ParsedArgs, action: "accept" | "retire"): Promise<Result<void, HarnessError>> {
	const noteId = args.positionals[2];
	if (noteId === undefined) {
		throw new HarnessError("VALIDATION_FAILED", `usage: cartographer notes ${action} <note-id> --reviewer <name>`);
	}
	const reviewer = optionalFlagString(args, "reviewer");
	if (reviewer === undefined) {
		throw new HarnessError("VALIDATION_FAILED", "--reviewer is required when reviewing notes");
	}
	const result = await reviewNote(await loadBaseGraph(args), graphOutDir(args), { action, noteId, reviewer });
	await writeNoteReviewResult(args, result);
	return ok(undefined);
}

async function writeNotesIngestResult(args: ParsedArgs, result: NotesIngestResult): Promise<void> {
	if (hasFlag(args, "json")) {
		await writeOut(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	await writeOut(
		[
			`Ingested ${result.ingestedCount} candidate note(s)`,
			`Skipped: ${result.skippedCount}`,
			`Notes: ${result.notesPath}`,
			`Audit issues: ${result.audit.summary.issueCount}`,
			"",
		].join("\n"),
	);
}

async function writeNoteReviewResult(args: ParsedArgs, result: NoteReviewResult): Promise<void> {
	if (hasFlag(args, "json")) {
		await writeOut(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}
	await writeOut(
		[
			`Reviewed note ${result.noteId}`,
			`Action: ${result.action}`,
			`Reviewer: ${result.reviewer}`,
			`Notes: ${result.notesPath}`,
			"",
		].join("\n"),
	);
}

interface CodeGraphVerifyOutput extends CodeGraphArtifactCompatibility {
	readonly freshness?: CodeGraphFreshnessCheck | undefined;
}

interface CodeGraphFreshnessCheck {
	readonly ok: boolean;
	readonly root: string;
	readonly diffSummary: CodeGraphDiff["summary"];
	readonly persisted: CodeGraphDiff["base"];
	readonly live: CodeGraphDiff["head"];
}

async function graphFreshnessCheck(args: ParsedArgs, outDir: string): Promise<CodeGraphFreshnessCheck> {
	const root = flagString(args, "root", ".");
	const persisted = await readCodeGraph(outDir);
	const live = await buildCodeGraph({ root, maxFileBytes: numberFlag(args, "max-file-bytes", 750_000) });
	const diff = diffCodeGraphs(persisted, live);
	return {
		ok: diffIsEmpty(diff),
		root,
		diffSummary: diff.summary,
		persisted: diff.base,
		live: diff.head,
	};
}

function diffIsEmpty(diff: CodeGraphDiff): boolean {
	return Object.values(diff.summary).every(
		(summary) => summary.added === 0 && summary.removed === 0 && summary.changed === 0,
	);
}

function verifyOutput(
	compatibility: CodeGraphArtifactCompatibility,
	freshness: CodeGraphFreshnessCheck | undefined,
): CodeGraphVerifyOutput {
	return { ...compatibility, ok: compatibility.ok && (freshness?.ok ?? true), freshness };
}

async function runDiff(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const base = requiredFlag(args, "base", "usage: cartographer diff --base docs/codegraph.before --head docs/codegraph.after");
		const head = requiredFlag(args, "head", "usage: cartographer diff --base docs/codegraph.before --head docs/codegraph.after");
		const diff = diffCodeGraphs(await readCodeGraph(base), await readCodeGraph(head));
		await writeOut(hasFlag(args, "json") ? `${JSON.stringify(diff, null, 2)}\n` : renderCodeGraphDiff(diff));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runSlice(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const selector = requiredFlag(
			args,
			"selector",
			"usage: cartographer slice --selector path:src/index.ts",
		);
		rejectBroadSelector(args, selector);
		const graph = await loadGraph(args);
		await writeSlice(args, sliceGraph(graph, selector));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runImpact(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const path = requiredFlag(args, "path", "usage: cartographer impact --path src/index.ts");
		rejectLargeImpact(args);
		const graph = await loadGraph(args);
		await writeSlice(args, impactGraph(graph, path, { maxDepth: optionalNumberFlag(args, "depth") }));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runContext(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const path = requiredFlag(args, "path", "usage: cartographer context --path src/index.ts");
		const graph = await loadGraph(args);
		const depth = optionalNumberFlag(args, "depth");
		const selector = flagString(args, "selector", contextSelectorFor(path));
		rejectBroadSelector(args, selector);
		await writeContext(args, buildGraphContext(graph, { path, selector, depth }));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runPreflight(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const path = requiredFlag(args, "path", "usage: cartographer preflight --path src/index.ts");
		const result = await runCartographerPreflight({
			root: flagString(args, "root", "."),
			outDir: graphOutDir(args),
			live: hasFlag(args, "live"),
			path,
			depth: optionalNumberFlag(args, "depth") ?? 1,
			maxFileBytes: numberFlag(args, "max-file-bytes", 750_000),
		});
		if (!result.ok) return err(result.error);
		await writeOut(`${JSON.stringify(preflightJson(result.data), null, 2)}\n`);
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runAdoption(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const analysis = await adoptionTraceAnalysisFromArgs(args);
		const expectationCheck = traceExpectationCheck(args, analysis.events);
		const graphFirstCheck = graphFirstAdoptionCheck(args, analysis.summary);
		await writeAdoptionSummary(args, analysis.summary, expectationCheck, graphFirstCheck);
		const graphFirst = enforceGraphFirstAdoption(args, analysis.summary, graphFirstCheck);
		if (!graphFirst.ok) return graphFirst;
		return enforceTraceExpectations(expectationCheck);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function adoptionTraceAnalysisFromArgs(args: ParsedArgs): Promise<AdoptionTraceAnalysis> {
	const tracePath = requiredFlag(args, "trace", "usage: cartographer adoption --trace trace.json");
	const events = await readRuntimeEvents(tracePath);
	return { events, summary: analyzeGraphCommandAdoption(events) };
}

async function writeAdoptionSummary(
	args: ParsedArgs,
	summary: GraphCommandAdoptionSummary,
	expectationCheck: TraceExpectationCheck | undefined,
	graphFirstCheck: GraphFirstAdoptionCheck | undefined,
): Promise<void> {
	await writeOut(
		hasFlag(args, "json")
			? `${JSON.stringify(adoptionJson(summary, expectationCheck, graphFirstCheck), null, 2)}\n`
			: renderAdoptionSummary(summary, expectationCheck, graphFirstCheck),
	);
}

function adoptionJson(
	summary: GraphCommandAdoptionSummary,
	expectationCheck: TraceExpectationCheck | undefined,
	graphFirstCheck: GraphFirstAdoptionCheck | undefined,
): Record<string, unknown> {
	return {
		...summary,
		...(graphFirstCheck === undefined ? {} : { graphFirstAdoption: graphFirstCheck }),
		...(expectationCheck === undefined ? {} : { finalResponseExpectation: expectationCheck }),
	};
}

function preflightJson(result: CartographerPreflightResult): Record<string, unknown> {
	return {
		...result.context,
		preflight: {
			command: result.command,
			root: result.root,
			targetPath: result.targetPath,
			live: result.live,
			startedAt: result.startedAt,
			finishedAt: result.finishedAt,
			durationMs: result.durationMs,
			timings: result.timings,
		},
	};
}

function traceExpectationCheck(args: ParsedArgs, events: readonly RuntimeEvent[]): TraceExpectationCheck | undefined {
	const expectations = traceExpectationInput(args);
	return expectations === undefined ? undefined : checkTraceExpectations(events, expectations);
}

function traceExpectationInput(args: ParsedArgs): TraceExpectationInput | undefined {
	const expectations = {
		...optionalStringFlag(args, "expect-text", "text"),
		...optionalStringFlag(args, "expect-path", "path"),
		...optionalStringFlag(args, "expect-command", "command"),
		...optionalStringFlag(args, "expect-executed-command", "executedCommand"),
	};
	return Object.keys(expectations).length === 0 ? undefined : expectations;
}

function optionalStringFlag(
	args: ParsedArgs,
	flag: string,
	key: keyof TraceExpectationInput,
): Partial<TraceExpectationInput> {
	const value = args.flags[flag];
	if (typeof value === "string" && value.length > 0) {
		return { [key]: value };
	}
	const values = Array.isArray(value) ? value.filter((entry) => entry.length > 0) : [];
	return values.length > 0 ? { [key]: values } : {};
}

function graphFirstAdoptionCheck(
	args: ParsedArgs,
	summary: GraphCommandAdoptionSummary,
): GraphFirstAdoptionCheck | undefined {
	return hasFlag(args, "require-graph-first") ? checkGraphFirstAdoption(summary) : undefined;
}

function enforceGraphFirstAdoption(
	args: ParsedArgs,
	summary: GraphCommandAdoptionSummary,
	graphFirst: GraphFirstAdoptionCheck | undefined,
): Result<void, HarnessError> {
	if (!hasFlag(args, "require-graph-first") || graphFirst === undefined) return ok(undefined);
	if (graphFirst.passed) return ok(undefined);
	return err(
		new HarnessError("VALIDATION_FAILED", `graph-first adoption failed: ${graphFirst.failures.join("; ")}`, {
			context: {
				adopted: summary.adopted,
				graphPreflightFailureCount: summary.graphPreflightFailureCount,
				sourceReadBeforeGraphCount: summary.sourceReadBeforeGraphCount,
				failures: [...graphFirst.failures],
			},
		}),
	);
}

function enforceTraceExpectations(expectationCheck: TraceExpectationCheck | undefined): Result<void, HarnessError> {
	if (expectationCheck === undefined || expectationCheck.passed) return ok(undefined);
	return err(
		new HarnessError("VALIDATION_FAILED", `trace expectation failed: ${expectationCheck.failures.join("; ")}`, {
			context: {
				finalTextLength: expectationCheck.finalTextLength,
				failures: [...expectationCheck.failures],
				expectedText: expectationCheck.expectedText,
				expectedPath: expectationCheck.expectedPath,
				expectedCommand: expectationCheck.expectedCommand,
				expectedExecutedCommand: expectationCheck.expectedExecutedCommand,
			},
		}),
	);
}

async function writeSlice(args: ParsedArgs, slice: ReturnType<typeof sliceGraph>): Promise<void> {
	if (hasFlag(args, "json")) {
		await writeOut(`${JSON.stringify(hasFlag(args, "debug-graph") ? slice : compactSliceOutput(slice), null, 2)}\n`);
		return;
	}
	await writeOut(renderSlice(slice));
}

async function writeContext(args: ParsedArgs, context: GraphContext): Promise<void> {
	if (hasFlag(args, "compact") || !hasFlag(args, "debug-graph")) {
		const compact = compactGraphContext(context);
		await writeOut(hasFlag(args, "json") ? `${JSON.stringify(compact, null, 2)}\n` : renderCompactContext(compact));
		return;
	}
	if (hasFlag(args, "json")) {
		await writeOut(`${JSON.stringify(context, null, 2)}\n`);
		return;
	}
	await writeOut(renderContext(context));
}

function renderContext(context: GraphContext): string {
	return [
		`# Context for ${context.path}`,
		"",
		`Graph: \`${context.manifest.root}\``,
		`Generated: ${context.manifest.generatedAt}`,
		`Git: ${context.manifest.git.dirty ? "dirty" : "clean"}${context.manifest.git.commit ? ` @ ${context.manifest.git.commit.slice(0, 12)}` : ""}`,
		`Selector: \`${context.selector}\``,
		`Impact depth: ${context.depth ?? "unbounded"}`,
		"",
		...renderGraphContextSummary(context.summary),
		"## Selected Slice",
		renderSlice(context.slice).trim(),
		"",
		"## Impact",
		renderSlice(context.impact).trim(),
		"",
	].join("\n");
}

function renderCompactContext(context: GraphContextCompact): string {
	return [
		`# Context for ${context.path}`,
		"",
		`Graph: \`${context.manifest.root}\``,
		`Generated: ${context.manifest.generatedAt}`,
		`Git: ${context.manifest.git.dirty ? "dirty" : "clean"}${context.manifest.git.commit ? ` @ ${context.manifest.git.commit.slice(0, 12)}` : ""}`,
		`Selector: \`${context.selector}\``,
		`Impact depth: ${context.depth ?? "unbounded"}`,
		`Slice totals: ${context.totals.slice.nodes} nodes, ${context.totals.slice.edges} edges, ${context.totals.slice.findings} findings`,
		`Impact totals: ${context.totals.impact.nodes} nodes, ${context.totals.impact.edges} edges, ${context.totals.impact.findings} findings`,
		"",
		...renderGraphContextSummary(context.summary),
	].join("\n");
}

function renderArtifactCompatibility(compatibility: CodeGraphVerifyOutput): string {
	return [
		"# Code Graph Artifact Compatibility",
		"",
		`Artifacts: \`${compatibility.outDir}\``,
		`Compatible: ${yesNo(compatibility.ok)}`,
		`Schema version: ${compatibility.schemaVersion ?? "unknown"}`,
		`Generated: ${compatibility.generatedAt ?? "unknown"}`,
		"",
		"Totals:",
		...renderCompatibilityTotals(compatibility),
		"",
		"Issues:",
		...renderCompatibilityIssues(compatibility),
		"",
		...renderFreshnessCheck(compatibility.freshness),
		"",
	].join("\n");
}

function renderCompatibilityTotals(compatibility: CodeGraphArtifactCompatibility): readonly string[] {
	if (compatibility.totals === undefined) return ["- Unknown"];
	return [
		`- Files: ${compatibility.totals.files}`,
		`- Packages: ${compatibility.totals.packages}`,
		`- Nodes: ${compatibility.totals.nodes}`,
		`- Edges: ${compatibility.totals.edges}`,
		`- Findings: ${compatibility.totals.findings}`,
	];
}

function renderCompatibilityIssues(compatibility: CodeGraphArtifactCompatibility): readonly string[] {
	if (compatibility.issues.length === 0) return ["- None"];
	return compatibility.issues.map((issue) =>
		[
			`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`,
			issue.path === undefined ? "" : `(${issue.path})`,
		]
			.filter((part) => part.length > 0)
			.join(" "),
	);
}

function renderFreshnessCheck(freshness: CodeGraphFreshnessCheck | undefined): readonly string[] {
	if (freshness === undefined) return [];
	return [
		"Freshness:",
		`- Root: \`${freshness.root}\``,
		`- Fresh: ${yesNo(freshness.ok)}`,
		`- Node changes: +${freshness.diffSummary.nodes.added} -${freshness.diffSummary.nodes.removed} ~${freshness.diffSummary.nodes.changed}`,
		`- Edge changes: +${freshness.diffSummary.edges.added} -${freshness.diffSummary.edges.removed} ~${freshness.diffSummary.edges.changed}`,
		`- Finding changes: +${freshness.diffSummary.findings.added} -${freshness.diffSummary.findings.removed} ~${freshness.diffSummary.findings.changed}`,
		`- Annotation changes: +${freshness.diffSummary.annotations.added} -${freshness.diffSummary.annotations.removed} ~${freshness.diffSummary.annotations.changed}`,
	];
}

function renderAdoptionSummary(
	summary: GraphCommandAdoptionSummary,
	expectationCheck: TraceExpectationCheck | undefined,
	graphFirstCheck: GraphFirstAdoptionCheck | undefined,
): string {
	return [
		"# Graph Command Adoption",
		"",
		`Adopted: ${yesNo(summary.adopted)}`,
		`Trace events: ${summary.eventCount}`,
		`Trace duration: ${msOrUnknown(summary.traceDurationMs)}`,
		`Tool commands: ${summary.toolCommandCount}`,
		`Graph preflight results: ${summary.graphPreflightResultCount}`,
		`First graph preflight duration: ${msOrUnknown(summary.firstGraphPreflightDurationMs)}`,
		`Graph preflight failures: ${summary.graphPreflightFailureCount}`,
		`Source reads before graph: ${summary.sourceReadBeforeGraphCount}`,
		`First graph command: ${textOrNone(summary.firstGraphCommand)}`,
		`First graph command offset: ${msOrUnknown(summary.firstGraphCommandOffsetMs)}`,
		`First graph preflight failure: ${textOrNone(summary.firstGraphPreflightFailureCommand)}`,
		`First graph preflight failure offset: ${msOrUnknown(summary.firstGraphPreflightFailureOffsetMs)}`,
		`First source read before graph: ${textOrNone(summary.firstSourceReadBeforeGraph)}`,
		`First source read before graph offset: ${msOrUnknown(summary.firstSourceReadBeforeGraphOffsetMs)}`,
		"",
		"Graph preflight failure commands:",
		...renderGraphContextList(summary.graphPreflightFailureCommands),
		"",
		"Source reads before graph:",
		...renderGraphContextList(summary.sourceReadCommandsBeforeGraph),
		"",
		...renderGraphFirstAdoptionSummary(graphFirstCheck),
		"",
		...renderTraceExpectationSummary(expectationCheck),
		"",
	].join("\n");
}

function renderGraphFirstAdoptionSummary(graphFirstCheck: GraphFirstAdoptionCheck | undefined): readonly string[] {
	if (graphFirstCheck === undefined) return [];
	return [
		"Graph-first gate:",
		`Passed: ${yesNo(graphFirstCheck.passed)}`,
		"Gate failures:",
		...renderGraphContextList(graphFirstCheck.failures),
	];
}

function renderTraceExpectationSummary(expectationCheck: TraceExpectationCheck | undefined): readonly string[] {
	if (expectationCheck === undefined) return [];
	return [
		"Final response expectation:",
		`Passed: ${yesNo(expectationCheck.passed)}`,
		`Final text length: ${expectationCheck.finalTextLength}`,
		`Expected text: ${expectedValueOrNone(expectationCheck.expectedText)}`,
		`Expected path: ${expectedValueOrNone(expectationCheck.expectedPath)}`,
		`Expected command: ${expectedValueOrNone(expectationCheck.expectedCommand)}`,
		`Expected executed command: ${expectedValueOrNone(expectationCheck.expectedExecutedCommand)}`,
		"Expectation metrics:",
		...renderTraceExpectationMetrics(expectationCheck.metrics),
		"Path evidence:",
		...renderPathEvidence(expectationCheck.pathEvidence),
		"Command evidence:",
		...renderCommandEvidence(expectationCheck.commandEvidence),
		"Executed command evidence:",
		...renderCommandEvidence(expectationCheck.executedCommandEvidence),
		"Expectation failures:",
		...renderGraphContextList(expectationCheck.failures),
	];
}

function renderTraceExpectationMetrics(metrics: TraceExpectationCheck["metrics"]): readonly string[] {
	return [
		`- Text final hits: ${metrics.finalTextHitCount}/${metrics.expectedTextCount}`,
		`- Path final/tool/source-read hits: ${metrics.finalPathHitCount}/${metrics.toolPathHitCount}/${metrics.sourceReadPathHitCount} of ${metrics.expectedPathCount}`,
		`- Command final/tool hits: ${metrics.finalCommandHitCount}/${metrics.toolCommandHitCount} of ${metrics.expectedCommandCount}`,
		`- Executed command hits: ${metrics.executedCommandHitCount}/${metrics.expectedExecutedCommandCount}`,
	];
}

function renderPathEvidence(pathEvidence: TraceExpectationCheck["pathEvidence"]): readonly string[] {
	if (pathEvidence === undefined || pathEvidence.length === 0) return ["- None"];
	return pathEvidence.map((item) =>
		[
			`- ${item.path}: final=${yesNo(item.observedInFinalResponse)}`,
			`tool=${yesNo(item.observedInToolCommand)}`,
			`source-read=${yesNo(item.observedInSourceReadCommand)}`,
			`first-tool=${textOrNone(item.firstToolCommand)}`,
			`first-source-read=${textOrNone(item.firstSourceReadCommand)}`,
		].join("; "),
	);
}

function renderCommandEvidence(commandEvidence: TraceExpectationCheck["commandEvidence"]): readonly string[] {
	if (commandEvidence === undefined || commandEvidence.length === 0) return ["- None"];
	return commandEvidence.map((item) =>
		[
			`- ${item.command}: final=${yesNo(item.observedInFinalResponse)}`,
			`tool=${yesNo(item.observedInToolCommand)}`,
			`first-tool=${textOrNone(item.firstToolCommand)}`,
		].join("; "),
	);
}

function yesNo(value: boolean): string {
	return value ? "yes" : "no";
}

function textOrNone(value: string | undefined): string {
	return value ?? "None";
}

function expectedValueOrNone(value: TraceExpectedValue | undefined): string {
	if (value === undefined) return "None";
	return typeof value === "string" ? value : value.join(", ");
}

function msOrUnknown(value: number | undefined): string {
	return `${value ?? "unknown"} ms`;
}

async function readRuntimeEvents(path: string): Promise<readonly RuntimeEvent[]> {
	const text = await readFile(path, "utf8");
	return runtimeEventsFromJson(parseTraceJson(text)).map(runtimeEventAtIndex);
}

function parseTraceJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch (cause) {
		throw new HarnessError(
			"VALIDATION_FAILED",
			`trace is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
}

function runtimeEventsFromJson(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) return value;
	if (!isRecord(value)) throw invalidTraceShapeError();
	return runtimeEventArrayFromRecord(value) ?? raiseTraceShapeError();
}

function runtimeEventArrayFromRecord(value: Record<string, unknown>): readonly unknown[] | undefined {
	const events = value["events"];
	if (Array.isArray(events)) return events;
	const runtimeEvents = value["runtimeEvents"];
	return Array.isArray(runtimeEvents) ? runtimeEvents : undefined;
}

function runtimeEventAtIndex(event: unknown, index: number): RuntimeEvent {
	if (isRuntimeEvent(event)) return event;
	throw new HarnessError("VALIDATION_FAILED", `trace event at index ${index} is not a RuntimeEvent`);
}

function raiseTraceShapeError(): never {
	throw invalidTraceShapeError();
}

function invalidTraceShapeError(): HarnessError {
	return new HarnessError(
		"VALIDATION_FAILED",
		"trace JSON must be a RuntimeEvent[] or an object with events/runtimeEvents",
	);
}

function isRuntimeEvent(value: unknown): value is RuntimeEvent {
	return isRecord(value) && hasRuntimeEventHeader(value) && "data" in value;
}

function hasRuntimeEventHeader(value: Record<string, unknown>): boolean {
	return (
		runtimeEventTypes.has(value["type"]) &&
		typeof value["timestamp"] === "string" &&
		typeof value["turnId"] === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runAnnotate(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const graph = await loadGraph(args);
		const selector = flagString(args, "selector", "all");
		const slice = sliceGraph(graph, selector);
		if (hasFlag(args, "dry-run")) {
			await writeOut(renderSlice(slice));
			return ok(undefined);
		}
		const apiKey = requireOpenRouterApiKey();
		const annotations = await annotateSliceWithOpenRouter({
			apiKey,
			model: flagString(args, "model", DEFAULT_OPENROUTER_MODEL),
			slice,
		});
		const overlayPath = await writeAnnotationOverlay(args, annotations);
		await writeOut(`Wrote ${annotations.length} candidate annotations to ${overlayPath}\n`);
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

async function runAnnotations(args: ParsedArgs): Promise<Result<void, HarnessError>> {
	try {
		const graph = await loadBaseGraph(args);
		const overlay = await loadAnnotationOverlay(args);
		const audit = auditAnnotationOverlay(graph, overlay);
		const review = annotationReviewFromArgs(args);
		if (review !== undefined) {
			const result = applyAnnotationReview(overlay, audit, review);
			await writeAnnotationOverlayRecords(overlay.overlayPath, result.annotations);
			const nextAudit = auditAnnotationOverlay(graph, { ...overlay, annotations: result.annotations, parseIssues: [] });
			await writeAnnotationReviewResult(args, { ...result, audit: nextAudit });
			return ok(undefined);
		}
		await writeOut(hasFlag(args, "json") ? `${JSON.stringify(audit, null, 2)}\n` : renderAnnotationOverlayAudit(audit));
		return ok(undefined);
	} catch (cause) {
		if (cause instanceof HarnessError) return err(cause);
		return err(HarnessError.from("INTERNAL", cause));
	}
}

interface AnnotationReviewInput {
	readonly action: "accept" | "retire";
	readonly annotationId: string;
	readonly reviewer: string;
	readonly now: Date;
}

interface AnnotationReviewResult {
	readonly overlayPath: string;
	readonly action: AnnotationReviewInput["action"];
	readonly annotationId: string;
	readonly reviewer: string;
	readonly annotation: AgentAnnotation;
	readonly annotations: readonly AgentAnnotation[];
}

interface AnnotationReviewOutput extends AnnotationReviewResult {
	readonly audit: AnnotationOverlayAudit;
}

function annotationReviewFromArgs(args: ParsedArgs): AnnotationReviewInput | undefined {
	const accept = optionalFlagString(args, "accept");
	const retire = optionalFlagString(args, "retire");
	if (accept !== undefined && retire !== undefined) {
		throw new HarnessError("VALIDATION_FAILED", "use only one of --accept or --retire");
	}
	const annotationId = accept ?? retire;
	if (annotationId === undefined) return undefined;
	const reviewer = optionalFlagString(args, "reviewer");
	if (reviewer === undefined) {
		throw new HarnessError("VALIDATION_FAILED", "--reviewer is required when reviewing annotations");
	}
	return { action: accept !== undefined ? "accept" : "retire", annotationId, reviewer, now: new Date() };
}

function optionalFlagString(args: ParsedArgs, name: string): string | undefined {
	const value = args.flags[name];
	if (Array.isArray(value)) return value.at(-1);
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function applyAnnotationReview(
	overlay: AnnotationOverlayLoadResult,
	audit: AnnotationOverlayAudit,
	review: AnnotationReviewInput,
): AnnotationReviewResult {
	if (audit.parseIssues.length > 0) {
		throw new HarnessError("VALIDATION_FAILED", "cannot rewrite annotation overlay while parse issues are present");
	}
	const annotation = overlay.annotations.find((candidate) => candidate.id === review.annotationId);
	if (annotation === undefined) {
		throw new HarnessError("VALIDATION_FAILED", `annotation not found: ${review.annotationId}`);
	}
	const updated = updateReviewedAnnotation(annotation, review, issuesForAnnotation(audit, review.annotationId));
	return {
		overlayPath: overlay.overlayPath,
		action: review.action,
		annotationId: review.annotationId,
		reviewer: review.reviewer,
		annotation: updated,
		annotations: overlay.annotations.map((candidate) => (candidate.id === review.annotationId ? updated : candidate)),
	};
}

function issuesForAnnotation(audit: AnnotationOverlayAudit, annotationId: string) {
	return audit.issues.filter((issue) => issue.annotationId === annotationId);
}

function updateReviewedAnnotation(
	annotation: AgentAnnotation,
	review: AnnotationReviewInput,
	issues: ReturnType<typeof issuesForAnnotation>,
): AgentAnnotation {
	if (review.action === "accept" && issues.length > 0) {
		throw new HarnessError(
			"VALIDATION_FAILED",
			`cannot accept annotation with audit issues: ${issues.map((issue) => issue.code).join(", ")}`,
		);
	}
	return {
		...annotation,
		author: { type: "human", name: review.reviewer },
		confidence: "human-reviewed",
		status: review.action === "accept" ? "accepted" : "retired",
		updatedAt: review.now.toISOString(),
	};
}

async function writeAnnotationReviewResult(args: ParsedArgs, result: AnnotationReviewOutput): Promise<void> {
	if (hasFlag(args, "json")) {
		await writeOut(
			`${JSON.stringify(
				{
					overlayPath: result.overlayPath,
					action: result.action,
					annotationId: result.annotationId,
					reviewer: result.reviewer,
					annotation: result.annotation,
					audit: result.audit,
				},
				null,
				2,
			)}\n`,
		);
		return;
	}
	await writeOut(
		[
			`Reviewed annotation ${result.annotationId}`,
			`Action: ${result.action}`,
			`Reviewer: ${result.reviewer}`,
			`Overlay: ${result.overlayPath}`,
			"",
		].join("\n"),
	);
}

function requireOpenRouterApiKey(): string {
	const apiKey = Bun.env["OPENROUTER_API_KEY"];
	if (apiKey !== undefined && apiKey.length > 0) return apiKey;
	throw new HarnessError("AUTH_FAILED", "OPENROUTER_API_KEY is required for cartographer annotate");
}

async function writeAnnotationOverlay(args: ParsedArgs, annotations: readonly unknown[]): Promise<string> {
	const outDir = graphOutDir(args);
	const overlayDir = join(outDir, "overlays");
	await mkdir(overlayDir, { recursive: true });
	const overlayPath = join(overlayDir, "agent-notes.jsonl");
	if (annotations.length > 0) {
		await appendFile(overlayPath, `${annotations.map((annotation) => JSON.stringify(annotation)).join("\n")}\n`);
	}
	return overlayPath;
}

async function writeAnnotationOverlayRecords(
	overlayPath: string,
	annotations: readonly AgentAnnotation[],
): Promise<void> {
	await mkdir(dirname(overlayPath), { recursive: true });
	await writeFile(
		overlayPath,
		annotations.length === 0 ? "" : `${annotations.map((annotation) => JSON.stringify(annotation)).join("\n")}\n`,
	);
}

async function loadGraph(args: ParsedArgs) {
	return graphWithAnnotationOverlay(await loadBaseGraph(args), await loadAnnotationOverlay(args));
}

async function loadBaseGraph(args: ParsedArgs) {
	const outDir = graphOutDir(args);
	if (hasFlag(args, "live")) {
		return buildCodeGraph({
			root: flagString(args, "root", "."),
			maxFileBytes: numberFlag(args, "max-file-bytes", 750_000),
		});
	}
	return readCodeGraph(outDir);
}

async function loadAnnotationOverlay(args: ParsedArgs) {
	return readAnnotationOverlay(graphOutDir(args));
}

function mapPath(args: ParsedArgs, outDir: string): string | undefined {
	const value = args.flags["map"];
	if (value === false) return undefined;
	if (typeof value === "string") return value;
	return join(outDir, "CODEBASE_MAP.md");
}

function graphOutDir(args: ParsedArgs): string {
	return flagString(args, "out", DEFAULT_OUT_DIR);
}

function defaultExportOut(format: string): string {
	return format === "jsonl" ? `${DEFAULT_OUT_DIR}/exports` : `${DEFAULT_OUT_DIR}/exports/graph.debug.json`;
}

function briefFormat(args: ParsedArgs): BriefFormat {
	if (hasFlag(args, "json")) return "json";
	const format = flagString(args, "format", "prompt");
	return format === "json" ? "json" : "prompt";
}

function modeFlag(args: ParsedArgs): BriefMode {
	const mode = flagString(args, "mode", "implementation");
	if (mode === "planning" || mode === "implementation" || mode === "review" || mode === "prd") return mode;
	throw new HarnessError("VALIDATION_FAILED", `unsupported brief mode: ${mode}`);
}

function briefLimitsFromArgs(args: ParsedArgs) {
	return {
		primaryPaths: numberFlag(args, "max-paths", 15),
		impactPaths: numberFlag(args, "max-impact", 25),
		testPaths: numberFlag(args, "max-tests", 20),
		packages: numberFlag(args, "max-packages", 10),
		validationCommands: numberFlag(args, "max-validation", 12),
		notes: numberFlag(args, "max-notes", 10),
		findings: numberFlag(args, "max-findings", 20),
	};
}

function rejectBroadSelector(args: ParsedArgs, selector: string): void {
	if (hasFlag(args, "allow-broad") || hasFlag(args, "debug-graph")) return;
	if (!isBroadSelector(selector)) return;
	throw new HarnessError(
		"VALIDATION_FAILED",
		`selector "${selector}" is broad; use a precise selector, --allow-broad, or --debug-graph`,
	);
}

function rejectLargeImpact(args: ParsedArgs): void {
	if (hasFlag(args, "allow-large-output") || hasFlag(args, "debug-graph")) return;
	const depth = optionalNumberFlag(args, "depth");
	if (depth !== undefined && depth > 2) {
		throw new HarnessError("VALIDATION_FAILED", "impact depth above 2 requires --allow-large-output or --debug-graph");
	}
}

function isBroadSelector(selector: string): boolean {
	if (selector === "all") return true;
	if (selector.startsWith("kind:")) return true;
	const hasKnownScope = [
		"path:",
		"package:",
		"env:",
		"dbfunction:",
		"dbpolicy:",
		"dbtable:",
		"dbtrigger:",
		"config:",
		"dirty:",
		"file:",
		"iacmodule:",
		"iacresource:",
		"migration:",
		"script:",
		"symbol:",
	].some((prefix) => selector.startsWith(prefix));
	return !hasKnownScope && !selector.includes(":");
}

function requiredFlag(args: ParsedArgs, name: string, message: string): string {
	const value = args.flags[name];
	if (typeof value === "string" && value.length > 0) return value;
	throw new HarnessError("VALIDATION_FAILED", message);
}

function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
	const value = args.flags[name];
	if (typeof value !== "string") return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalNumberFlag(args: ParsedArgs, name: string): number | undefined {
	const value = args.flags[name];
	if (typeof value !== "string") return undefined;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function cartographerHelp(): string {
	return [
		"cartographer <subcommand> [options]",
		"",
		"Subcommands:",
		"  mcp        Run the thin MCP stdio wrapper over Cartographer CLI operations",
		"  index      Build .cartographer/{manifest.json,graph.sqlite,schema/*} and CODEBASE_MAP.md",
		"  update     Rebuild the graph artifacts in place",
		"  verify     Check graph artifact compatibility and structural integrity",
		"  view       Show graph summary from --out",
		"  brief      Emit bounded agent-facing graph context",
		"  audit      Build or verify task-specific evidence ledgers",
		"  notes      Ingest, audit, accept, or retire evidence-backed notes",
		"  export     Export debug graph data explicitly",
		"  diff       Diff two graph artifact directories with --base and --head",
		"  slice      Show a task slice, e.g. --selector path:src/index.ts",
		"  impact     Show incoming impact for --path src/index.ts",
		"  context    Show slice plus impact context for --path src/index.ts",
		"  preflight  Agent pre-edit context: compact JSON, depth 1 by default",
		"  adoption   Summarize graph-command adoption from a RuntimeEvent trace",
		"  annotate   Legacy OpenRouter flow for candidate overlay notes",
		"  annotations Legacy audit/review surface for semantic overlay notes",
		"",
		"Options:",
		"  --root <path>              Repo root for live/index mode. Default: .",
		"  --out <path>               Graph artifact directory. Default: .cartographer",
		"  --from <path>              Graph artifact directory for export. Default: .cartographer",
		"  --base <path>              Base graph artifact directory for diff",
		"  --head <path>              Head graph artifact directory for diff",
		"  --map <path>               Map output path. Default: <out>/CODEBASE_MAP.md",
		"  --format <format>          brief: prompt|json; export graph: debug-json|jsonl",
		"  --budget <tokens>          Brief target token budget. Default: 8000",
		"  --max-paths <n>            Brief read-first path cap. Default: 15",
		"  --max-impact <n>           Brief impact path cap. Default: 25",
		"  --max-tests <n>            Brief test path cap. Default: 20",
		"  --max-validation <n>       Brief validation command cap. Default: 12",
		"  --mode <mode>              Brief mode: planning|implementation|review|prd",
		"  --target <target>          For audit removal, target dependency/service name",
		"  --ledger <path>            For audit verify, ledger JSON path",
		"  --write <path>             Write audit ledger JSON to this path",
		"  --fail-on-leftovers        For audit verify, fail when active leftovers remain",
		"  --author <name>            For notes ingest, agent or human author name",
		"  --run-id <id>              For notes ingest, source run id",
		"  --selector <selector>      all, path:<path>, package:<path-or-name>, kind:<node-kind>, node id, or text",
		"  --path <path>              File path or node id for impact/context",
		"  --trace <path>             RuntimeEvent[] JSON trace for adoption analysis",
		"  --depth <n>                Limit impact traversal depth. Default: unbounded",
		"  --json                     Emit JSON for view, brief, audit, notes, slice, impact, context, adoption, and annotations",
		"  --fresh                    For verify, compare artifacts against a live graph from --root",
		"  --require-graph-first      For adoption, fail if graph was unused, preflight failed, or repo source was read before graph context",
		"  --expect-text <text>       For adoption, fail if final trace text omits this text. Repeatable",
		"  --expect-path <path>       For adoption, fail if final trace text omits this path. Repeatable",
		"  --expect-command <cmd>     For adoption, fail if final trace text omits this command. Repeatable",
		"  --expect-executed-command <cmd> For adoption, fail if no tool command executes this command. Repeatable",
		"  --accept <annotation-id>  For annotations, accept a review-ready candidate annotation",
		"  --retire <annotation-id>  For annotations, retire an annotation",
		"  --reviewer <name>         Reviewer name required with --accept or --retire",
		"  --compact                  For context, omit nested slice/impact payloads and keep totals only",
		"  --allow-broad              Permit broad slice/context selectors",
		"  --allow-large-output       Permit impact depth above normal cap",
		"  --debug-graph              Emit full nested graph payloads for debug/evals",
		"  --debug-json               For index, also write exports/graph.debug.json",
		"  --live                     Build in memory instead of reading <out>/graph.sqlite",
		"  --dry-run                  For annotate, render the slice without calling OpenRouter",
		"  --model <model>            OpenRouter model. Default: openai/gpt-5.5",
		"  --max-file-bytes <bytes>   Max text bytes read per file. Default: 750000",
		"",
	].join("\n");
}

function compactSliceOutput(slice: GraphSlice): Record<string, unknown> {
	const paths = slice.nodes.flatMap((node) => (node.path === undefined ? [] : [node.path]));
	return {
		selector: slice.selector,
		title: slice.title,
		totals: {
			nodes: slice.nodes.length,
			edges: slice.edges.length,
			findings: slice.findings.length,
		},
		paths: [...new Set(paths)].slice(0, 50),
		summary: slice.summary,
		findings: slice.findings.slice(0, 20),
		omissions: {
			paths: Math.max(0, new Set(paths).size - 50),
			nodes: Math.max(0, slice.nodes.length - 50),
			edges: slice.edges.length,
		},
	};
}

const DEFAULT_OUT_DIR = ".cartographer";

const runtimeEventTypes = new Set<unknown>([
	"status",
	"assistant",
	"tool_use",
	"tool_result",
	"result",
	"error",
	"heartbeat",
]);
