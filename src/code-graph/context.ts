import { impactGraph, sliceGraph } from "./query.ts";
import type {
	AffectedPackageSummary,
	CodeGraphNode,
	CodeGraphSnapshot,
	GraphContext,
	GraphContextCompact,
	GraphContextSummary,
	GraphSlice,
	GraphSliceSummary,
	ValidationCommandSummary,
} from "./types.ts";

export interface BuildGraphContextOptions {
	readonly path: string;
	readonly selector?: string;
	readonly depth?: number | undefined;
}

export function buildGraphContext(graph: CodeGraphSnapshot, options: BuildGraphContextOptions): GraphContext {
	const selector = options.selector ?? contextSelectorFor(options.path);
	const slice = sliceGraph(graph, selector);
	const impact = impactGraph(graph, options.path, { maxDepth: options.depth });
	return {
		path: options.path,
		selector,
		depth: options.depth,
		manifest: graph.manifest,
		summary: summarizeContext(slice, impact),
		slice,
		impact,
	};
}

export function compactGraphContext(context: GraphContext): GraphContextCompact {
	return {
		path: context.path,
		selector: context.selector,
		depth: context.depth,
		manifest: context.manifest,
		summary: compactGraphContextSummary(context.summary),
		totals: {
			slice: graphSliceTotals(context.slice),
			impact: graphSliceTotals(context.impact),
		},
	};
}

export function renderGraphContextSummary(summary: GraphContextSummary): readonly string[] {
	return [
		"## Preflight Summary",
		"",
		"Primary paths:",
		...renderGraphContextList(summary.primaryPaths),
		"",
		"Impact paths:",
		...renderGraphContextList(summary.impactPaths),
		"",
		"Test paths:",
		...renderGraphContextList(summary.testPaths),
		"",
		"Affected packages:",
		...renderGraphContextList(summary.affectedPackages.map((item) => `#${item.rank} ${item.packageId}`)),
		"",
		"Validation commands:",
		...renderGraphContextList(
			summary.validationCommands.map((item) => {
				const command = validationCommandForDisplay(item);
				return `${item.scriptId}${command ? ` - ${command}` : ""}`;
			}),
		),
		"",
		"Semantic notes:",
		...renderGraphContextList(
			summary.annotationNotes.map((item) => `${item.kind} ${item.status}: ${item.targetNodeId} - ${item.summary}`),
		),
		"",
		"Findings:",
		...renderGraphContextList(summary.findings.map((item) => `${item.severity}: ${item.message}`)),
		"",
	];
}

export function renderGraphContextList(items: readonly string[]): readonly string[] {
	if (items.length === 0) return ["- None"];
	return items.slice(0, 50).map((item) => `- ${item}`);
}

export function contextSelectorFor(path: string): string {
	const normalized = path.replace(/^\.\//, "");
	if (normalized.startsWith("file:")) return `path:${normalized.slice("file:".length)}`;
	return isExplicitContextSelector(normalized) || looksLikeFilePath(normalized)
		? normalizedSelector(normalized)
		: normalized;
}

function graphSliceTotals(slice: GraphSlice): GraphContextCompact["totals"]["slice"] {
	return {
		nodes: slice.nodes.length,
		edges: slice.edges.length,
		findings: slice.findings.length,
	};
}

function compactGraphContextSummary(summary: GraphContextSummary): GraphContextSummary {
	return {
		...summary,
		validationCommands: compactValidationCommands(summary),
	};
}

function compactValidationCommands(summary: GraphContextSummary): readonly ValidationCommandSummary[] {
	const relevantFocused = summary.validationCommands.filter((command) =>
		validationCommandMatchesContext(command, summary),
	);
	const packageCommands = summary.validationCommands.filter(
		(command) => !command.scriptId.includes("#") && isCompactPackageCommand(command),
	);
	const fallbackCommands = relevantFocused.length === 0 ? summary.validationCommands : [];
	return mergeSummaryItems(relevantFocused, packageCommands, (item) => item.scriptId)
		.concat(fallbackCommands.filter((command) => !relevantFocused.some((item) => item.scriptId === command.scriptId)))
		.slice(0, MAX_COMPACT_VALIDATION_COMMANDS);
}

function isCompactPackageCommand(command: ValidationCommandSummary): boolean {
	return /^(build|check|ci|lint(:eslint)?|test|typecheck|validate|verify)$/i.test(command.name);
}

function validationCommandMatchesContext(command: ValidationCommandSummary, summary: GraphContextSummary): boolean {
	const scope = testCommandScope(command);
	if (scope === undefined) return false;
	return (
		summary.testPaths.includes(scope) ||
		summary.primaryPaths.some((path) => path === scope || path.startsWith(`${scope}/`)) ||
		summary.impactPaths.some((path) => path === scope || path.startsWith(`${scope}/`))
	);
}

function testCommandScope(command: ValidationCommandSummary): string | undefined {
	if (!command.name.startsWith("test:")) return undefined;
	const scope = command.name.slice("test:".length);
	return scope.length === 0 ? undefined : scope;
}

function summarizeContext(slice: GraphSlice, impact: GraphSlice): GraphContextSummary {
	const sliceSummary = summaryForSlice(slice);
	const impactSummary = summaryForSlice(impact);
	return {
		primaryPaths: contextPaths(slice),
		impactPaths: contextPaths(impact),
		testPaths: mergeSummaryItems(contextTestPaths(impact), contextTestPaths(slice), (item) => item),
		affectedPackages: rerankPackages(
			mergeSummaryItems(impactSummary.affectedPackages, sliceSummary.affectedPackages, (item) => item.packageId),
		),
		validationCommands: prioritizeValidationCommands(
			mergeSummaryItems(impactSummary.validationCommands, sliceSummary.validationCommands, (item) => item.scriptId),
		),
		annotationNotes: mergeSummaryItems(impactSummary.annotationNotes, sliceSummary.annotationNotes, (item) => item.id),
		findings: mergeSummaryItems(impact.findings, slice.findings, (item) => item.id),
	};
}

function prioritizeValidationCommands(
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

function summaryForSlice(slice: GraphSlice): GraphSliceSummary {
	return slice.summary ?? EMPTY_GRAPH_SLICE_SUMMARY;
}

function contextPaths(slice: GraphSlice): readonly string[] {
	const paths = new Set<string>();
	for (const node of slice.nodes) {
		if (node.path !== undefined && contextPathNodeKinds.has(node.kind)) paths.add(node.path);
	}
	return [...paths];
}

function contextTestPaths(slice: GraphSlice): readonly string[] {
	const nodesById = new Map(slice.nodes.map((node) => [node.id, node]));
	return mergeSummaryItems(
		slice.edges.flatMap((edge) => {
			if (edge.kind !== "TESTS") return [];
			const testPath = nodesById.get(edge.to)?.path;
			return testPath === undefined ? [] : [testPath];
		}),
		[],
		(item) => item,
	);
}

function rerankPackages(packages: readonly AffectedPackageSummary[]): readonly AffectedPackageSummary[] {
	return packages.map((item, index) => ({ ...item, rank: index + 1 }));
}

function mergeSummaryItems<T>(
	primary: readonly T[],
	secondary: readonly T[],
	keyForItem: (item: T) => string,
): readonly T[] {
	const items = new Map<string, T>();
	for (const item of [...primary, ...secondary]) addSummaryItem(items, item, keyForItem);
	return [...items.values()];
}

function addSummaryItem<T>(items: Map<string, T>, item: T, keyForItem: (item: T) => string): void {
	const key = keyForItem(item);
	if (!items.has(key)) items.set(key, item);
}

function normalizedSelector(value: string): string {
	return isExplicitContextSelector(value) ? value : `path:${value}`;
}

function isExplicitContextSelector(value: string): boolean {
	return contextSelectorPrefixes.some((prefix) => value.startsWith(prefix));
}

function looksLikeFilePath(value: string): boolean {
	return value.includes("/") || value.includes(".");
}

const contextSelectorPrefixes = [
	"dbtable:",
	"dbfunction:",
	"dbpolicy:",
	"dbtrigger:",
	"dir:",
	"dirty:",
	"env:",
	"external:",
	"iacmodule:",
	"iacresource:",
	"kind:",
	"migration:",
	"package:",
	"path:",
	"policy:",
	"repo:",
	"route:",
	"script:",
	"symbol:",
	"test:",
] as const;

const contextPathNodeKinds = new Set<CodeGraphNode["kind"]>([
	"File",
	"Test",
	"Doc",
	"Config",
	"GeneratedArtifact",
	"BoundaryPolicy",
	"Entrypoint",
	"IaCModule",
	"IaCResource",
	"Route",
	"Migration",
	"DirtyArtifact",
]);

const EMPTY_GRAPH_SLICE_SUMMARY: GraphSliceSummary = {
	affectedPackages: [],
	validationCommands: [],
	annotationNotes: [],
};

const MAX_COMPACT_VALIDATION_COMMANDS = 20;
