#!/usr/bin/env bun

import { runCartographer } from "../code-graph/commands.ts";
import { HarnessError, normalizeError } from "../shared/errors.ts";
import { hasFlag, parseArgs, type ParsedArgs } from "./args.ts";
import { writeErr, writeOut } from "./io.ts";

export async function main(argv = Bun.argv.slice(2)): Promise<number> {
	const parsed = parseArgs(argv);
	if (!parsed.ok) return fail(parsed.error);
	if (parsed.data.command === undefined || hasFlag(parsed.data, "help") || hasFlag(parsed.data, "h")) {
		await writeOut(helpText());
		return 0;
	}
	const result = await runCartographer(asCartographerArgs(parsed.data));
	if (!result.ok) return fail(result.error);
	return 0;
}

function asCartographerArgs(args: ParsedArgs): ParsedArgs {
	if (args.command === "cartographer") {
		return { command: "cartographer", positionals: args.positionals, flags: args.flags };
	}
	return { command: "cartographer", positionals: [args.command ?? "help", ...args.positionals], flags: args.flags };
}

async function fail(error: HarnessError): Promise<number> {
	await writeErr(`${error.code}: ${error.message}\n`);
	return 1;
}

function helpText(): string {
	return [
		"cartographer <subcommand> [options]",
		"",
		"Subcommands:",
		"  mcp         Run MCP stdio wrapper",
		"  index       Build code graph artifacts",
		"  update      Rebuild code graph artifacts",
		"  verify      Check graph artifact compatibility",
		"  view        Show graph summary",
		"  brief       Emit bounded agent-facing graph context",
		"  audit       Build or verify evidence ledgers",
		"  notes       Ingest, audit, accept, or retire evidence-backed notes",
		"  export      Export explicit debug graph data",
		"  diff        Diff two graph artifact directories",
		"  slice       Show a graph slice",
		"  impact      Show impact for a path or node id",
		"  context     Show slice plus impact context",
		"  preflight   Emit compact agent pre-edit context",
		"  adoption    Summarize graph-command adoption from a trace",
		"  annotate    Legacy OpenRouter flow for candidate overlay notes",
		"  annotations Legacy audit/review surface for semantic overlay notes",
		"",
	].join("\n");
}

if (import.meta.main) {
	const code = await main().catch((cause) => fail(normalizeError(cause)));
	process.exit(code);
}
