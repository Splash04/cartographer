import { join } from "node:path";
import { buildRemovalAudit, readAuditLedger, verifyRemovalAudit } from "./audit.ts";
import { readCodeGraph, writeCodeGraphArtifacts, checkCodeGraphArtifacts } from "./artifacts.ts";
import { buildBrief } from "./brief.ts";
import { buildCodeGraph } from "./builder.ts";
import { buildGraphContext, compactGraphContext } from "./context.ts";
import { diffCodeGraphs } from "./diff.ts";
import { auditNotes } from "./notes.ts";
import { graphWithAnnotationOverlay, readAnnotationOverlay } from "./overlays.ts";
import { runCartographerPreflight } from "./preflight.ts";
import { summarizeGraph } from "./query.ts";

export interface McpJsonRpcRequest {
	readonly jsonrpc?: string | undefined;
	readonly id?: string | number | null | undefined;
	readonly method?: string | undefined;
	readonly params?: unknown;
}

export type McpJsonRpcResponse = McpJsonRpcSuccessResponse | McpJsonRpcErrorResponse;

export interface McpJsonRpcSuccessResponse {
	readonly jsonrpc: "2.0";
	readonly id: string | number | null;
	readonly result: unknown;
}

export interface McpJsonRpcErrorResponse {
	readonly jsonrpc: "2.0";
	readonly id: string | number | null;
	readonly error: {
		readonly code: number;
		readonly message: string;
		readonly data?: unknown;
	};
}

export async function handleCartographerMcpRequest(
	request: McpJsonRpcRequest,
): Promise<McpJsonRpcResponse | undefined> {
	if (request.method === undefined) return errorResponse(request.id, -32600, "invalid JSON-RPC request");
	if (request.method.startsWith("notifications/")) return undefined;
	if (request.method === "initialize") return successResponse(request.id, initializeResult());
	if (request.method === "tools/list") return successResponse(request.id, { tools: cartographerMcpTools() });
	if (request.method === "tools/call") return callTool(request);
	return errorResponse(request.id, -32601, `unknown MCP method: ${request.method}`);
}

export async function runCartographerMcpServer(): Promise<void> {
	let buffer = "";
	for await (const chunk of Bun.stdin.stream()) {
		buffer += new TextDecoder().decode(chunk);
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) await handleMcpLine(line);
	}
	if (buffer.trim().length > 0) await handleMcpLine(buffer);
}

function initializeResult(): Record<string, unknown> {
	return {
		protocolVersion: "2024-11-05",
		capabilities: { tools: {} },
		serverInfo: {
			name: "cartographer",
			version: "0.1.0",
		},
	};
}

function cartographerMcpTools(): readonly Record<string, unknown>[] {
	return [
		{
			name: "cartographer_index",
			description: "Build Cartographer graph artifacts for a repository.",
			inputSchema: objectSchema({
				root: stringSchema("Repository root. Defaults to current directory."),
				outDir: stringSchema("Graph artifact directory. Defaults to .cartographer."),
				maxFileBytes: numberSchema("Maximum readable bytes per file."),
			}),
		},
		{
			name: "cartographer_view",
			description: "Read and summarize persisted Cartographer graph artifacts.",
			inputSchema: objectSchema({ outDir: stringSchema("Graph artifact directory. Defaults to .cartographer.") }),
		},
		{
			name: "cartographer_brief",
			description: "Return a bounded Cartographer brief for an agent-facing anchor.",
			inputSchema: objectSchema({
				outDir: stringSchema("Graph artifact directory. Defaults to .cartographer."),
				path: stringSchema("Path anchor."),
				package: stringSchema("Package anchor."),
				env: stringSchema("Environment variable anchor."),
				db: stringSchema("Database object anchor."),
				iac: stringSchema("IaC object anchor."),
				audit: stringSchema("Audit ledger id or path."),
				changed: booleanSchema("Use changed-file/dirty artifact anchor."),
				mode: stringSchema("Brief mode: planning, implementation, review, or prd."),
				budget: numberSchema("Target token budget."),
			}),
		},
		{
			name: "cartographer_context",
			description: "Return graph slice plus impact context for a path or node id.",
			inputSchema: objectSchema({
				outDir: stringSchema("Graph artifact directory. Defaults to .cartographer."),
				path: requiredStringSchema("File path or node id."),
				depth: numberSchema("Impact traversal depth."),
				compact: booleanSchema("Return compact context without nested graph payloads."),
			}, ["path"]),
		},
		{
			name: "cartographer_preflight",
			description: "Run compact graph preflight for an agent turn.",
			inputSchema: objectSchema({
				root: stringSchema("Repository root. Defaults to current directory."),
				outDir: stringSchema("Graph artifact directory. Defaults to .cartographer."),
				path: requiredStringSchema("Target file path or node id."),
				live: booleanSchema("Build current graph in memory instead of reading persisted artifacts."),
				depth: numberSchema("Impact traversal depth."),
				maxPromptChars: numberSchema("Maximum prompt text characters."),
			}, ["path"]),
		},
		{
			name: "cartographer_verify",
			description: "Check graph artifact compatibility and structural integrity.",
			inputSchema: objectSchema({ outDir: stringSchema("Graph artifact directory. Defaults to .cartographer.") }),
		},
		{
			name: "cartographer_audit_removal",
			description: "Build a removal/completeness audit ledger.",
			inputSchema: objectSchema({
				outDir: stringSchema("Graph artifact directory. Defaults to .cartographer."),
				target: requiredStringSchema("Removal target, such as supabase."),
				authReplacement: stringSchema("Expected auth replacement."),
				dbReplacement: stringSchema("Expected database replacement."),
			}, ["target"]),
		},
		{
			name: "cartographer_audit_verify",
			description: "Verify a removal audit ledger against current graph evidence.",
			inputSchema: objectSchema({
				outDir: stringSchema("Graph artifact directory. Defaults to .cartographer."),
				ledger: requiredStringSchema("Audit ledger path."),
				failOnLeftovers: booleanSchema("Mark ledger failed when active leftovers remain."),
			}, ["ledger"]),
		},
		{
			name: "cartographer_notes_audit",
			description: "Audit Cartographer evidence-backed notes for staleness and support.",
			inputSchema: objectSchema({ outDir: stringSchema("Graph artifact directory. Defaults to .cartographer.") }),
		},
		{
			name: "cartographer_diff",
			description: "Compare two graph artifact directories.",
			inputSchema: objectSchema({
				base: requiredStringSchema("Base graph artifact directory."),
				head: requiredStringSchema("Head graph artifact directory."),
			}, ["base", "head"]),
		},
	] as const;
}

async function callTool(request: McpJsonRpcRequest): Promise<McpJsonRpcResponse> {
	const params = recordValue(request.params);
	const name = stringValue(params["name"]);
	const args = recordValue(params["arguments"] ?? {});
	if (name === undefined) return errorResponse(request.id, -32602, "tools/call requires params.name");
	try {
		return successResponse(request.id, { content: [{ type: "text", text: await callCartographerTool(name, args) }] });
	} catch (cause) {
		return errorResponse(request.id, -32000, cause instanceof Error ? cause.message : String(cause));
	}
}

async function callCartographerTool(name: string, args: Record<string, unknown>): Promise<string> {
	switch (name) {
		case "cartographer_index":
			return indexTool(args);
		case "cartographer_view":
			return viewTool(args);
		case "cartographer_brief":
			return briefTool(args);
		case "cartographer_context":
			return contextTool(args);
		case "cartographer_preflight":
			return preflightTool(args);
		case "cartographer_verify":
			return jsonTool(await checkCodeGraphArtifacts(stringValue(args["outDir"]) ?? ".cartographer"));
		case "cartographer_audit_removal":
			return auditRemovalTool(args);
		case "cartographer_audit_verify":
			return auditVerifyTool(args);
		case "cartographer_notes_audit":
			return notesAuditTool(args);
		case "cartographer_diff":
			return diffTool(args);
		default:
			throw new Error(`unknown Cartographer MCP tool: ${name}`);
	}
}

async function indexTool(args: Record<string, unknown>): Promise<string> {
	const root = stringValue(args["root"]) ?? ".";
	const outDir = stringValue(args["outDir"]) ?? ".cartographer";
	const graph = await buildCodeGraph({ root, maxFileBytes: numberValue(args["maxFileBytes"]) ?? 750_000 });
	await writeCodeGraphArtifacts(graph, { outDir });
	return jsonTool({ summary: summarizeGraph(graph), outDir, manifest: graph.manifest });
}

async function viewTool(args: Record<string, unknown>): Promise<string> {
	const graph = await readCodeGraph(stringValue(args["outDir"]) ?? ".cartographer");
	return jsonTool({ summary: summarizeGraph(graph), manifest: graph.manifest });
}

async function briefTool(args: Record<string, unknown>): Promise<string> {
	const outDir = stringValue(args["outDir"]) ?? ".cartographer";
	const graph = graphWithAnnotationOverlay(await readCodeGraph(outDir), await readAnnotationOverlay(outDir));
	const auditRef = stringValue(args["audit"]);
	const auditLedger = auditRef === undefined ? undefined : await resolveMcpAuditLedger(outDir, auditRef);
	return jsonTool(
		buildBrief(graph, {
			mode: briefModeValue(args["mode"]),
			path: stringValue(args["path"]),
			packageId: stringValue(args["package"]),
			env: stringValue(args["env"]),
			db: stringValue(args["db"]),
			iac: stringValue(args["iac"]),
			audit: auditRef,
			auditLedger,
			changed: booleanValue(args["changed"]),
			requestedTokens: numberValue(args["budget"]),
			live: false,
		}),
	);
}

async function contextTool(args: Record<string, unknown>): Promise<string> {
	const outDir = stringValue(args["outDir"]) ?? ".cartographer";
	const path = requiredStringValue(args["path"], "cartographer_context requires path");
	const graph = graphWithAnnotationOverlay(await readCodeGraph(outDir), await readAnnotationOverlay(outDir));
	const context = buildGraphContext(graph, { path, depth: numberValue(args["depth"]) });
	return jsonTool(booleanValue(args["compact"]) ? compactGraphContext(context) : context);
}

async function auditRemovalTool(args: Record<string, unknown>): Promise<string> {
	const outDir = stringValue(args["outDir"]) ?? ".cartographer";
	const target = requiredStringValue(args["target"], "cartographer_audit_removal requires target");
	const graph = await readCodeGraph(outDir);
	return jsonTool(
		await buildRemovalAudit(graph, {
			target,
			expectedAuthReplacement: stringValue(args["authReplacement"]),
			expectedDbReplacement: stringValue(args["dbReplacement"]),
		}),
	);
}

async function auditVerifyTool(args: Record<string, unknown>): Promise<string> {
	const outDir = stringValue(args["outDir"]) ?? ".cartographer";
	const ledger = requiredStringValue(args["ledger"], "cartographer_audit_verify requires ledger");
	return jsonTool(
		await verifyRemovalAudit(await readCodeGraph(outDir), await readAuditLedger(ledger), {
			failOnLeftovers: booleanValue(args["failOnLeftovers"]),
		}),
	);
}

async function notesAuditTool(args: Record<string, unknown>): Promise<string> {
	const outDir = stringValue(args["outDir"]) ?? ".cartographer";
	return jsonTool(await auditNotes(await readCodeGraph(outDir), outDir));
}

async function resolveMcpAuditLedger(outDir: string, auditRef: string) {
	if (await Bun.file(auditRef).exists()) return readAuditLedger(auditRef);
	const filename = auditRef.endsWith(".json") ? auditRef : `${auditRef}.json`;
	const path = join(outDir, "audits", filename);
	if (await Bun.file(path).exists()) return readAuditLedger(path);
	throw new Error(`audit ledger not found: ${auditRef}`);
}

async function preflightTool(args: Record<string, unknown>): Promise<string> {
	const path = requiredStringValue(args["path"], "cartographer_preflight requires path");
	const result = await runCartographerPreflight({
		root: stringValue(args["root"]) ?? ".",
		outDir: stringValue(args["outDir"]),
		path,
		live: booleanValue(args["live"]) ?? false,
		depth: numberValue(args["depth"]),
		maxPromptChars: numberValue(args["maxPromptChars"]),
	});
	if (!result.ok) throw result.error;
	return jsonTool(result.data);
}

async function diffTool(args: Record<string, unknown>): Promise<string> {
	const base = requiredStringValue(args["base"], "cartographer_diff requires base");
	const head = requiredStringValue(args["head"], "cartographer_diff requires head");
	return jsonTool(diffCodeGraphs(await readCodeGraph(base), await readCodeGraph(head)));
}

async function handleMcpLine(line: string): Promise<void> {
	if (line.trim().length === 0) return;
	const response = await handleCartographerMcpRequest(parseRequest(line));
	if (response !== undefined) await Bun.write(Bun.stdout, `${JSON.stringify(response)}\n`);
}

function parseRequest(line: string): McpJsonRpcRequest {
	try {
		const value = JSON.parse(line);
		return isRecord(value) ? value : {};
	} catch {
		return { id: null, method: undefined };
	}
}

function successResponse(id: McpJsonRpcRequest["id"], result: unknown): McpJsonRpcSuccessResponse {
	return { jsonrpc: "2.0", id: responseId(id), result };
}

function errorResponse(id: McpJsonRpcRequest["id"], code: number, message: string, data?: unknown): McpJsonRpcErrorResponse {
	return { jsonrpc: "2.0", id: responseId(id), error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function responseId(id: McpJsonRpcRequest["id"]): string | number | null {
	return typeof id === "string" || typeof id === "number" ? id : null;
}

function jsonTool(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function objectSchema(properties: Record<string, unknown>, required: readonly string[] = []): Record<string, unknown> {
	return { type: "object", properties, required, additionalProperties: false };
}

function stringSchema(description: string): Record<string, unknown> {
	return { type: "string", description };
}

function requiredStringSchema(description: string): Record<string, unknown> {
	return { ...stringSchema(description), minLength: 1 };
}

function numberSchema(description: string): Record<string, unknown> {
	return { type: "number", description };
}

function booleanSchema(description: string): Record<string, unknown> {
	return { type: "boolean", description };
}

function recordValue(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredStringValue(value: unknown, message: string): string {
	const parsed = stringValue(value);
	if (parsed !== undefined) return parsed;
	throw new Error(message);
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function briefModeValue(value: unknown) {
	if (value === "planning" || value === "implementation" || value === "review" || value === "prd") return value;
	return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
