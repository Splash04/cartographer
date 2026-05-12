import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { countBy } from "./collections.ts";
import { CODE_GRAPH_SCHEMA_VERSION } from "./types.ts";
import {
	auditLedgerJsonSchema,
	briefJsonSchema,
	codeGraphJsonSchema,
	codeGraphSnapshotSchema,
	notesJsonSchema,
} from "./schema.ts";
import { summarizeGraph } from "./query.ts";
import {
	graphSqlitePath,
	readSqliteCodeGraph,
	sqliteCodeGraphExists,
	sqliteIntegrityCheck,
	writeSqliteCodeGraph,
} from "./sqlite-store.ts";
import type { CodeGraphSnapshot, WriteCodeGraphOptions } from "./types.ts";

export async function writeCodeGraphArtifacts(graph: CodeGraphSnapshot, options: WriteCodeGraphOptions): Promise<void> {
	const parsed = codeGraphSnapshotSchema.parse(graph);
	await mkdir(options.outDir, { recursive: true });
	await writeSchemaArtifacts(options.outDir);
	await Bun.write(join(options.outDir, "manifest.json"), `${JSON.stringify(parsed.manifest, null, 2)}\n`);
	await writeSqliteCodeGraph(parsed, options.outDir);
	if (options.debugJson === true) await writeDebugJsonGraph(parsed, join(options.outDir, "exports", "graph.debug.json"));
	const mapPath = options.mapPath ?? join(options.outDir, "CODEBASE_MAP.md");
	await mkdir(dirname(mapPath), { recursive: true });
	await Bun.write(mapPath, renderMap(parsed));
}

export async function readCodeGraph(outDir: string): Promise<CodeGraphSnapshot> {
	if (await sqliteCodeGraphExists(outDir)) return readSqliteCodeGraph(outDir);
	const graphPath = join(outDir, "graph.json");
	const raw = await Bun.file(graphPath).json();
	return codeGraphSnapshotSchema.parse(raw);
}

export async function writeDebugJsonGraph(graph: CodeGraphSnapshot, outputPath: string): Promise<void> {
	const parsed = codeGraphSnapshotSchema.parse(graph);
	await mkdir(dirname(outputPath), { recursive: true });
	await Bun.write(outputPath, `${JSON.stringify(parsed, null, 2)}\n`);
}

export async function writeJsonlGraphExports(graph: CodeGraphSnapshot, outDir: string): Promise<void> {
	const parsed = codeGraphSnapshotSchema.parse(graph);
	await mkdir(outDir, { recursive: true });
	await Bun.write(
		join(outDir, "nodes.jsonl"),
		parsed.nodes.map((node) => JSON.stringify({ type: "node", ...node })).join("\n") + "\n",
	);
	await Bun.write(
		join(outDir, "edges.jsonl"),
		parsed.edges.map((edge) => JSON.stringify({ type: "edge", ...edge })).join("\n") + "\n",
	);
}

export interface CodeGraphArtifactCompatibility {
	readonly outDir: string;
	readonly ok: boolean;
	readonly schemaVersion?: string | undefined;
	readonly generatedAt?: string | undefined;
	readonly issues: readonly CodeGraphArtifactCompatibilityIssue[];
	readonly totals?: {
		readonly files: number;
		readonly packages: number;
		readonly nodes: number;
		readonly edges: number;
		readonly findings: number;
	} | undefined;
}

export interface CodeGraphArtifactCompatibilityIssue {
	readonly code:
		| "missing-artifact"
		| "invalid-json"
		| "sqlite-integrity-failed"
		| "schema-version-mismatch"
		| "schema-validation-failed"
		| "manifest-mismatch"
		| "duplicate-node-id"
		| "duplicate-edge-id"
		| "dangling-edge";
	readonly severity: "error" | "warn";
	readonly message: string;
	readonly path?: string | undefined;
}

export async function checkCodeGraphArtifacts(outDir: string): Promise<CodeGraphArtifactCompatibility> {
	const issues: CodeGraphArtifactCompatibilityIssue[] = [];
	await checkRequiredArtifacts(outDir, issues);
	await checkSqliteIntegrity(outDir, issues);
	if (!(await sqliteCodeGraphExists(outDir))) return compatibilityResult(outDir, issues);
	const graph = await readCodeGraphOrIssue(outDir, issues);
	if (graph === undefined) return compatibilityResult(outDir, issues);
	const parsed = codeGraphSnapshotSchema.safeParse(graph);
	if (!parsed.success) {
		issues.push({
			code: "schema-validation-failed",
			severity: "error",
			message: parsed.error.issues.map((issue) => issue.message).join("; "),
			path: graphSqlitePath(outDir),
		});
		return compatibilityResult(outDir, issues, graph.schemaVersion);
	}
	await checkManifestArtifact(outDir, parsed.data, issues);
	checkManifestConsistency(parsed.data, issues);
	checkGraphIds(parsed.data, issues);
	return compatibilityResult(outDir, issues, parsed.data.schemaVersion, parsed.data.manifest.generatedAt, parsed.data.manifest.totals);
}

export function renderMap(graph: CodeGraphSnapshot): string {
	const filesByKind = countBy(
		graph.nodes.filter((node) => node.kind === "File" || node.kind === "Doc" || node.kind === "GeneratedArtifact"),
		(node) => String(node.metadata["fileKind"] ?? node.kind),
	);
	const packages = graph.nodes.filter((node) => node.kind === "Package");
	const scripts = graph.nodes.filter((node) => node.kind === "PackageScript");
	const envVars = graph.nodes.filter((node) => node.kind === "EnvVar");
	const iacNodes = graph.nodes.filter((node) => node.kind === "IaCResource" || node.kind === "IaCModule");
	const dbNodes = graph.nodes.filter((node) => node.kind.startsWith("Db"));
	return [
		"# Codebase Map",
		"",
		"Generated by Cartographer code graph.",
		"",
		"## Summary",
		"",
		`\`\`\`text\n${summarizeGraph(graph).trim()}\n\`\`\``,
		"",
		"## File Mix",
		...Object.entries(filesByKind).map(([kind, count]) => `- ${kind}: ${count}`),
		"",
		"## Packages",
		...renderNodeList(packages, (node) => `- ${node.label} - \`${node.path ?? node.id}\``),
		"",
		"## Package Scripts",
		...renderNodeList(scripts, (node) => `- ${node.label}: \`${String(node.metadata["command"] ?? "")}\``),
		"",
		"## Environment Variables",
		...renderNodeList(envVars, (node) => `- ${node.label}`),
		"",
		"## Database And IaC",
		...renderNodeList(
			[...dbNodes, ...iacNodes],
			(node) => `- ${node.kind}: ${node.label} - \`${node.path ?? node.id}\``,
		),
		"",
		"## Findings",
		...(graph.findings.length === 0
			? ["- None"]
			: graph.findings.map((finding) => `- ${finding.severity}: ${finding.message}`)),
		"",
		"## Agent Notes",
		"",
		"Use `cartographer notes` for evidence-backed semantic overlays. Notes are not canonical graph facts until reviewed.",
		"",
	].join("\n");
}

function renderNodeList<T>(nodes: readonly T[], renderNode: (node: T) => string): readonly string[] {
	return nodes.length === 0 ? ["- None detected"] : nodes.map(renderNode);
}

async function readCodeGraphOrIssue(
	outDir: string,
	issues: CodeGraphArtifactCompatibilityIssue[],
): Promise<CodeGraphSnapshot | undefined> {
	try {
		return await readCodeGraph(outDir);
	} catch (cause) {
		issues.push({
			code: "schema-validation-failed",
			severity: "error",
			message: `could not read graph.sqlite: ${cause instanceof Error ? cause.message : String(cause)}`,
			path: graphSqlitePath(outDir),
		});
		return undefined;
	}
}

async function checkRequiredArtifacts(outDir: string, issues: CodeGraphArtifactCompatibilityIssue[]): Promise<void> {
	for (const name of [
		"manifest.json",
		"graph.sqlite",
		"schema/brief.schema.json",
		"schema/audit-ledger.schema.json",
		"schema/notes.schema.json",
	] as const) {
		const path = join(outDir, name);
		if (!(await Bun.file(path).exists())) {
			issues.push({
				code: "missing-artifact",
				severity: "error",
				message: `missing ${name}`,
				path,
			});
		}
	}
}

async function checkSqliteIntegrity(outDir: string, issues: CodeGraphArtifactCompatibilityIssue[]): Promise<void> {
	const failures = await sqliteIntegrityCheck(outDir);
	for (const failure of failures) {
		issues.push({
			code: "sqlite-integrity-failed",
			severity: "error",
			message: failure,
			path: graphSqlitePath(outDir),
		});
	}
}

async function readJsonArtifact(
	path: string,
	issues: CodeGraphArtifactCompatibilityIssue[],
): Promise<unknown | undefined> {
	try {
		return await Bun.file(path).json();
	} catch (cause) {
		issues.push({
			code: "invalid-json",
			severity: "error",
			message: `${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
			path,
		});
		return undefined;
	}
}

async function checkManifestArtifact(
	outDir: string,
	graph: CodeGraphSnapshot,
	issues: CodeGraphArtifactCompatibilityIssue[],
): Promise<void> {
	const manifestPath = join(outDir, "manifest.json");
	if (!(await Bun.file(manifestPath).exists())) return;
	const raw = await readJsonArtifact(manifestPath, issues);
	if (raw === undefined) return;
	if (stableJson(raw) !== stableJson(graph.manifest)) {
		issues.push({
			code: "manifest-mismatch",
			severity: "error",
			message: "manifest.json does not match graph.sqlite manifest",
			path: manifestPath,
		});
	}
}

function checkManifestConsistency(
	graph: CodeGraphSnapshot,
	issues: CodeGraphArtifactCompatibilityIssue[],
): void {
	if (graph.schemaVersion !== CODE_GRAPH_SCHEMA_VERSION || graph.manifest.schemaVersion !== CODE_GRAPH_SCHEMA_VERSION) {
		issues.push({
			code: "schema-version-mismatch",
			severity: "error",
			message: `expected schema version ${CODE_GRAPH_SCHEMA_VERSION}`,
			path: "graph.sqlite",
		});
	}
	const packageCount = graph.nodes.filter((node) => node.kind === "Package").length;
	const fileCount = graph.nodes.filter(
		(node) => node.kind === "File" || node.kind === "Doc" || node.kind === "GeneratedArtifact",
	).length;
	const expectedTotals = {
		files: fileCount,
		packages: packageCount,
		nodes: graph.nodes.length,
		edges: graph.edges.length,
		findings: graph.findings.length,
	};
	for (const [key, expected] of Object.entries(expectedTotals)) {
		const actual = graph.manifest.totals[key as keyof typeof graph.manifest.totals];
		if (actual !== expected) {
			issues.push({
				code: "manifest-mismatch",
				severity: "error",
				message: `manifest total ${key} is ${actual}, expected ${expected}`,
				path: "manifest.json",
			});
		}
	}
}

function checkGraphIds(graph: CodeGraphSnapshot, issues: CodeGraphArtifactCompatibilityIssue[]): void {
	const nodeIds = new Set<string>();
	for (const node of graph.nodes) {
		if (nodeIds.has(node.id)) {
			issues.push({
				code: "duplicate-node-id",
				severity: "error",
				message: `duplicate node id: ${node.id}`,
				path: node.path,
			});
		}
		nodeIds.add(node.id);
	}
	const edgeIds = new Set<string>();
	for (const edge of graph.edges) {
		if (edgeIds.has(edge.id)) {
			issues.push({
				code: "duplicate-edge-id",
				severity: "error",
				message: `duplicate edge id: ${edge.id}`,
			});
		}
		edgeIds.add(edge.id);
		if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
			issues.push({
				code: "dangling-edge",
				severity: "error",
				message: `dangling edge ${edge.id}: ${edge.from} -> ${edge.to}`,
			});
		}
	}
}

function compatibilityResult(
	outDir: string,
	issues: readonly CodeGraphArtifactCompatibilityIssue[],
	schemaVersion?: string | undefined,
	generatedAt?: string | undefined,
	totals?: CodeGraphArtifactCompatibility["totals"],
): CodeGraphArtifactCompatibility {
	return {
		outDir,
		ok: !issues.some((issue) => issue.severity === "error"),
		schemaVersion,
		generatedAt,
		issues,
		totals,
	};
}

function stableJson(value: unknown): string {
	return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJsonValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value)
			.toSorted(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, sortJsonValue(entry)]),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function writeSchemaArtifacts(outDir: string): Promise<void> {
	await mkdir(join(outDir, "schema"), { recursive: true });
	await Bun.write(join(outDir, "schema", "brief.schema.json"), `${JSON.stringify(briefJsonSchema(), null, 2)}\n`);
	await Bun.write(join(outDir, "schema", "audit-ledger.schema.json"), `${JSON.stringify(auditLedgerJsonSchema(), null, 2)}\n`);
	await Bun.write(join(outDir, "schema", "notes.schema.json"), `${JSON.stringify(notesJsonSchema(), null, 2)}\n`);
	await Bun.write(join(outDir, "schema.json"), `${JSON.stringify(codeGraphJsonSchema(), null, 2)}\n`);
}
