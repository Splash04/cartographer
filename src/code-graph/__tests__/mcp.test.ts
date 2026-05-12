import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleCartographerMcpRequest } from "../mcp.ts";
import { runCartographer } from "../commands.ts";
import { createCartographerFixture, removeCartographerFixture } from "./fixture.ts";

let tempDir: string;

beforeEach(async () => {
	tempDir = await createCartographerFixture("cartographer-mcp-test-");
});

afterEach(async () => {
	await removeCartographerFixture(tempDir);
});

describe("Cartographer MCP wrapper", () => {
	test("lists Cartographer tools through MCP", async () => {
		const response = await handleCartographerMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
		const result = successResult(response);
		const tools = arrayField(result, "tools");
		const names = tools.map((tool) => stringField(recordValue(tool), "name"));

		expect(names).toContain("cartographer_index");
		expect(names).toContain("cartographer_brief");
		expect(names).toContain("cartographer_preflight");
		expect(names).toContain("cartographer_audit_removal");
		expect(names).toContain("cartographer_notes_audit");
		expect(names).toContain("cartographer_verify");
		expect(names).toContain("cartographer_diff");
	});

	test("runs bounded brief through MCP tools/call", async () => {
		const outDir = await indexFixtureRepo();
		const response = await handleCartographerMcpRequest({
			jsonrpc: "2.0",
			id: "brief",
			method: "tools/call",
			params: {
				name: "cartographer_brief",
				arguments: {
					outDir,
					path: "src/index.ts",
					mode: "planning",
					budget: 8000,
				},
			},
		});
		const toolOutput = toolText(successResult(response));
		const parsed = JSON.parse(toolOutput) as Record<string, unknown>;
		const anchor = recordField(parsed, "anchor");

		expect(parsed["schemaVersion"]).toBe("cartographer.brief.v1");
		expect(anchor["selector"]).toBe("path:src/index.ts");
	});

	test("runs preflight through MCP tools/call", async () => {
		const outDir = await indexFixtureRepo();
		const response = await handleCartographerMcpRequest({
			jsonrpc: "2.0",
			id: "preflight",
			method: "tools/call",
			params: {
				name: "cartographer_preflight",
				arguments: {
					root: join(tempDir, "repo"),
					outDir,
					path: "src/index.ts",
					live: false,
				},
			},
		});
		const toolOutput = toolText(successResult(response));
		const parsed = JSON.parse(toolOutput) as Record<string, unknown>;
		const context = recordField(parsed, "context");

		expect(parsed["targetPath"]).toBe("src/index.ts");
		expect(context["path"]).toBe("src/index.ts");
		expect(String(parsed["promptText"])).toContain("cartographer-preflight");
	});

	test("returns JSON-RPC errors for unknown tools", async () => {
		const response = await handleCartographerMcpRequest({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "missing_tool", arguments: {} },
		});

		expect(response).toBeDefined();
		if (response === undefined || !("error" in response)) throw new Error("expected MCP error response");
		expect(response.error.message).toContain("unknown Cartographer MCP tool");
	});
});

async function indexFixtureRepo(): Promise<string> {
	const outDir = join(tempDir, "repo/docs/codegraph");
	const indexed = await runCartographer({
		command: "cartographer",
		positionals: ["index"],
		flags: { root: join(tempDir, "repo"), out: outDir },
	});
	expect(indexed.ok).toBe(true);
	return outDir;
}

function successResult(response: Awaited<ReturnType<typeof handleCartographerMcpRequest>>): Record<string, unknown> {
	expect(response).toBeDefined();
	if (response === undefined || "error" in response) throw new Error("expected MCP success response");
	return recordValue(response.result);
}

function toolText(result: Record<string, unknown>): string {
	const content = arrayField(result, "content");
	const first = recordValue(content[0]);
	return stringField(first, "text");
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
	return recordValue(value[key]);
}

function arrayField(value: Record<string, unknown>, key: string): readonly unknown[] {
	const field = value[key];
	expect(Array.isArray(field)).toBe(true);
	return field as readonly unknown[];
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
