import { countBy } from "./collections.ts";
import type {
	AffectedPackageSummary,
	AgentAnnotation,
	AnnotationNoteSummary,
	CodeGraphEdge,
	CodeGraphNode,
	CodeGraphSnapshot,
	GraphSlice,
	GraphSliceSummary,
	ValidationCommandSummary,
} from "./types.ts";

export interface ImpactGraphOptions {
	readonly maxDepth?: number | undefined;
}

export function summarizeGraph(graph: CodeGraphSnapshot): string {
	const byKind = countBy(graph.nodes, (node) => node.kind);
	const edgeKinds = countBy(graph.edges, (edge) => edge.kind);
	return [
		`Code graph: ${graph.manifest.root}`,
		`Generated: ${graph.manifest.generatedAt}`,
		`Git: ${graph.manifest.git.dirty ? "dirty" : "clean"}${graph.manifest.git.commit ? ` @ ${graph.manifest.git.commit.slice(0, 12)}` : ""}`,
		`Totals: ${graph.manifest.totals.files} files, ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.findings.length} findings`,
		"",
		"Node kinds:",
		...Object.entries(byKind).map(([kind, count]) => `  ${kind}: ${count}`),
		"",
		"Edge kinds:",
		...Object.entries(edgeKinds).map(([kind, count]) => `  ${kind}: ${count}`),
		"",
	].join("\n");
}

export function sliceGraph(graph: CodeGraphSnapshot, selector: string): GraphSlice {
	const selected = selectNodes(graph, selector);
	const selectedIds = new Set(selected.map((node) => node.id));
	const nodeIds = new Set(selectedIds);
	for (const edge of graph.edges) {
		if (selectedIds.has(edge.from) || selectedIds.has(edge.to)) {
			nodeIds.add(edge.from);
			nodeIds.add(edge.to);
		}
	}
	const relatedNodeIds = new Set(nodeIds);
	addPackageContext(graph, nodeIds);
	const nodes = graph.nodes.filter((node) => nodeIds.has(node.id));
	return {
		selector,
		title: `Slice for ${selector}`,
		nodes,
		summary: summarizeSliceContext(graph, nodeIds, relatedNodeIds, selectedIds),
		...sliceRelatedGraph(graph, nodeIds),
	};
}

export function impactGraph(graph: CodeGraphSnapshot, path: string, options: ImpactGraphOptions = {}): GraphSlice {
	const normalized = impactTargetFor(path);
	const target = graph.nodes.find(
		(node) => node.id === normalized || node.path === normalized || node.id === `file:${normalized}`,
	);
	if (target === undefined) return emptyImpactSlice(path);
	const nodeIds = expandedImpactNodeIds(graph, target.id, options.maxDepth);
	const relatedNodeIds = new Set(nodeIds);
	addPackageContext(graph, nodeIds);
	return {
		selector: `impact:${path}`,
		title: `Impact for ${path}`,
		nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
		summary: summarizeSliceContext(graph, nodeIds, relatedNodeIds, new Set([target.id])),
		...sliceRelatedGraph(graph, nodeIds),
	};
}

function impactTargetFor(path: string): string {
	const normalized = path.replace(/^\.\//, "");
	return normalized.startsWith("path:") ? normalized.slice("path:".length) : normalized;
}

function emptyImpactSlice(path: string): GraphSlice {
	return {
		selector: `impact:${path}`,
		title: `Impact for ${path}`,
		nodes: [],
		edges: [],
		findings: [],
		annotations: [],
		summary: emptySliceSummary(),
	};
}

function expandedImpactNodeIds(graph: CodeGraphSnapshot, targetId: string, maxDepth: number | undefined): Set<string> {
	const nodeIds = new Set<string>([targetId]);
	let frontier = new Set<string>([targetId]);
	let depth = 0;
	while (withinImpactDepth(depth, maxDepth) && frontier.size > 0) {
		frontier = addImpactPass(graph, nodeIds, frontier);
		depth += 1;
	}
	addTestsForImpactedNodes(graph, nodeIds);
	return nodeIds;
}

function withinImpactDepth(depth: number, maxDepth: number | undefined): boolean {
	return maxDepth === undefined || depth < maxDepth;
}

function addImpactPass(graph: CodeGraphSnapshot, nodeIds: Set<string>, frontier: ReadonlySet<string>): Set<string> {
	const added = new Set<string>();
	for (const edge of graph.edges) addImpactedNode(edge, nodeIds, frontier, added);
	return added;
}

function addTestsForImpactedNodes(graph: CodeGraphSnapshot, nodeIds: Set<string>): void {
	const impactedNodeIds = new Set(nodeIds);
	for (const edge of graph.edges) {
		if (edge.kind === "TESTS" && impactedNodeIds.has(edge.from)) nodeIds.add(edge.to);
	}
}

function addImpactedNode(
	edge: CodeGraphEdge,
	nodeIds: Set<string>,
	frontier: ReadonlySet<string>,
	added: Set<string>,
): void {
	addOptionalNodeId(nodeIds, added, incomingImpactNode(edge, frontier, nodeIds));
	addOptionalNodeId(nodeIds, added, testImpactNode(edge, frontier, nodeIds));
}

function incomingImpactNode(
	edge: CodeGraphEdge,
	frontier: ReadonlySet<string>,
	nodeIds: ReadonlySet<string>,
): string | undefined {
	if (!isIncomingImpact(edge, frontier)) return undefined;
	return missingNodeId(nodeIds, edge.from);
}

function testImpactNode(
	edge: CodeGraphEdge,
	frontier: ReadonlySet<string>,
	nodeIds: ReadonlySet<string>,
): string | undefined {
	if (!isTestImpact(edge, frontier)) return undefined;
	return missingNodeId(nodeIds, edge.to);
}

function isIncomingImpact(edge: CodeGraphEdge, nodeIds: ReadonlySet<string>): boolean {
	return nodeIds.has(edge.to) && impactEdgeKinds.has(edge.kind);
}

function isTestImpact(edge: CodeGraphEdge, nodeIds: ReadonlySet<string>): boolean {
	return nodeIds.has(edge.from) && edge.kind === "TESTS";
}

function missingNodeId(nodeIds: ReadonlySet<string>, nodeId: string): string | undefined {
	return nodeIds.has(nodeId) ? undefined : nodeId;
}

function addOptionalNodeId(nodeIds: Set<string>, added: Set<string>, nodeId: string | undefined): void {
	if (nodeId === undefined) return;
	addNodeId(nodeIds, added, nodeId);
}

function addNodeId(nodeIds: Set<string>, added: Set<string>, nodeId: string): void {
	nodeIds.add(nodeId);
	added.add(nodeId);
}

function addPackageContext(graph: CodeGraphSnapshot, nodeIds: Set<string>): void {
	const context = collectPackageContext(graph, nodeIds);
	for (const packageId of context.packageIds) addPackageScripts(graph, nodeIds, packageId, context);
}

function hasDatabaseContext(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): boolean {
	return graph.nodes.some((node) => nodeIds.has(node.id) && databaseNodeKinds.has(node.kind));
}

interface PackageContext extends PackageScriptContext {
	readonly packageIds: ReadonlySet<string>;
}

interface PackageScriptContext {
	readonly hasDataContext: boolean;
	readonly packageDirs: ReadonlySet<string>;
}

function collectPackageContext(graph: CodeGraphSnapshot, nodeIds: Set<string>): PackageContext {
	const packageIds = new Set<string>();
	const packageDirs = new Set<string>();
	for (const node of selectedGraphNodes(graph, nodeIds)) {
		addOwningPackageContext(packageNodes(graph), node, nodeIds, packageIds, packageDirs);
	}
	return { packageIds, packageDirs, hasDataContext: hasDatabaseContext(graph, nodeIds) };
}

function selectedGraphNodes(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly CodeGraphNode[] {
	return graph.nodes.filter((node) => nodeIds.has(node.id));
}

function packageNodes(graph: CodeGraphSnapshot): readonly CodeGraphNode[] {
	return graph.nodes.filter((node) => node.kind === "Package");
}

function addOwningPackageContext(
	packages: readonly CodeGraphNode[],
	node: CodeGraphNode,
	nodeIds: Set<string>,
	packageIds: Set<string>,
	packageDirs: Set<string>,
): void {
	for (const owner of packageOwnersForPath(packages, node.path)) {
		packageIds.add(owner.id);
		packageDirs.add(packageDirForNode(owner));
		nodeIds.add(owner.id);
	}
}

function addPackageScripts(
	graph: CodeGraphSnapshot,
	nodeIds: Set<string>,
	packageId: string,
	context: PackageScriptContext,
): void {
	const packageDir = packageId.slice("package:".length);
	for (const node of packageScripts(graph, packageDir)) {
		if (isContextScript(node.label, packageDir, context)) {
			nodeIds.add(node.id);
		}
	}
}

function packageScripts(graph: CodeGraphSnapshot, packageDir: string): readonly CodeGraphNode[] {
	const scriptPrefix = `script:${packageDir}:`;
	return graph.nodes.filter((node) => isPackageScript(node, scriptPrefix));
}

function isPackageScript(node: CodeGraphNode, scriptPrefix: string): boolean {
	return node.kind === "PackageScript" && node.id.startsWith(scriptPrefix);
}

function isContextScript(scriptName: string, packageDir: string, context: PackageScriptContext): boolean {
	const kind = scriptContextKind(scriptName);
	if (kind === "safe-data") return context.hasDataContext;
	if (kind !== "validation") return false;
	return validationScriptMatchesPackageContext(scriptName, packageDir, context.packageDirs);
}

function scriptContextKind(scriptName: string): "safe-data" | "unsafe-data" | "validation" | "other" {
	if (isSafeDataScript(scriptName)) return "safe-data";
	if (scriptName.toLowerCase().startsWith("db:")) return "unsafe-data";
	if (isValidationScript(scriptName)) return "validation";
	return "other";
}

function validationScriptMatchesPackageContext(
	scriptName: string,
	packageDir: string,
	packageDirs: ReadonlySet<string>,
): boolean {
	if (packageDir !== ".") return true;
	return rootValidationScriptMatchesContext(scriptName, packageDirs);
}

function rootValidationScriptMatchesContext(scriptName: string, packageDirs: ReadonlySet<string>): boolean {
	if (packageDirs.size <= 1) return true;
	if (isGenericRootValidationScript(scriptName)) return true;
	return isRootValidationScriptForContext(scriptName, packageDirs);
}

function isGenericRootValidationScript(scriptName: string): boolean {
	return /^(build|check|ci|lint|test|typecheck|validate|verify)$/i.test(scriptName);
}

function isSafeDataScript(scriptName: string): boolean {
	return /^db:(types?|status|lint|check|validate|verify)$/i.test(scriptName);
}

function isValidationScript(scriptName: string): boolean {
	return /^(build|check|ci|e2e|fuzz|integration|lint|test|typecheck|unit|validate|verify)(:|$)/i.test(scriptName);
}

function isRootValidationScriptForContext(scriptName: string, packageDirs: ReadonlySet<string>): boolean {
	const scriptParts = scriptName.toLowerCase().split(":").slice(1);
	return contextPackageAliases(packageDirs).some((alias) => scriptParts.includes(alias));
}

function contextPackageAliases(packageDirs: ReadonlySet<string>): readonly string[] {
	return [...packageDirs]
		.filter((dir) => dir !== ".")
		.map((dir) => dir.split("/").at(-1)?.toLowerCase())
		.filter((dir): dir is string => dir !== undefined && dir.length > 0);
}

function packageOwnersForPath(packages: readonly CodeGraphNode[], path: string | undefined): readonly CodeGraphNode[] {
	if (path === undefined) return [];
	return packages
		.filter((node) => pathBelongsToPackage(path, packageDirForNode(node)))
		.toSorted((left, right) => packageDirForNode(right).length - packageDirForNode(left).length);
}

function pathBelongsToPackage(path: string, packageDir: string): boolean {
	return packageDir === "." ? true : path === packageDir || path.startsWith(`${packageDir}/`);
}

function packageDirForNode(node: CodeGraphNode): string {
	if (node.id.startsWith("package:")) return node.id.slice("package:".length);
	return ".";
}

const databaseNodeKinds = new Set<CodeGraphNode["kind"]>([
	"Migration",
	"DbTable",
	"DbFunction",
	"DbPolicy",
	"DbTrigger",
]);

function summarizeSliceContext(
	graph: CodeGraphSnapshot,
	nodeIds: ReadonlySet<string>,
	relatedNodeIds: ReadonlySet<string>,
	_focusedNodeIds: ReadonlySet<string>,
): GraphSliceSummary {
	const affectedPackages = affectedPackageSummaries(graph, nodeIds, relatedNodeIds);
	return {
		affectedPackages,
		validationCommands: validationCommandSummaries(graph, affectedPackages, nodeIds),
		annotationNotes: annotationNoteSummaries(selectedAnnotations(graph, nodeIds)),
	};
}

function emptySliceSummary(): GraphSliceSummary {
	return { affectedPackages: [], validationCommands: [], annotationNotes: [] };
}

interface PackageSummaryDraft {
	readonly packageNode: CodeGraphNode;
	directNodeCount: number;
	ancestorNodeCount: number;
	readonly scriptIds: Set<string>;
}

function affectedPackageSummaries(
	graph: CodeGraphSnapshot,
	nodeIds: ReadonlySet<string>,
	relatedNodeIds: ReadonlySet<string>,
): readonly AffectedPackageSummary[] {
	const packages = packageNodes(graph);
	const drafts = packageSummaryDrafts(packages, nodeIds);
	for (const node of selectedGraphNodes(graph, relatedNodeIds)) addPackageCounts(drafts, packages, node);
	for (const script of selectedPackageScripts(graph, nodeIds)) addPackageScriptId(drafts, script);
	return rankPackageSummaries([...drafts.values()]);
}

function packageSummaryDrafts(
	packages: readonly CodeGraphNode[],
	nodeIds: ReadonlySet<string>,
): Map<string, PackageSummaryDraft> {
	return new Map(
		packages
			.filter((node) => nodeIds.has(node.id))
			.map((node) => [node.id, { packageNode: node, directNodeCount: 0, ancestorNodeCount: 0, scriptIds: new Set() }]),
	);
}

function addPackageCounts(
	drafts: Map<string, PackageSummaryDraft>,
	packages: readonly CodeGraphNode[],
	node: CodeGraphNode,
): void {
	const owners = packageOwnersForPath(packages, node.path);
	for (const [index, owner] of owners.entries()) incrementPackageCount(drafts.get(owner.id), index);
}

function incrementPackageCount(draft: PackageSummaryDraft | undefined, ownerIndex: number): void {
	if (draft === undefined) return;
	if (ownerIndex === 0) draft.directNodeCount += 1;
	else draft.ancestorNodeCount += 1;
}

function addPackageScriptId(drafts: Map<string, PackageSummaryDraft>, script: CodeGraphNode): void {
	drafts.get(packageIdForScript(script))?.scriptIds.add(script.id);
}

function rankPackageSummaries(drafts: readonly PackageSummaryDraft[]): readonly AffectedPackageSummary[] {
	return sortedPackageSummaries(drafts).map((draft, index) => packageSummaryForDraft(draft, index + 1));
}

function sortedPackageSummaries(drafts: readonly PackageSummaryDraft[]): readonly PackageSummaryDraft[] {
	return [...drafts].sort(
		(left, right) =>
			packageSummarySortKey(right) - packageSummarySortKey(left) ||
			packageDirForNode(left.packageNode).localeCompare(packageDirForNode(right.packageNode)),
	);
}

function packageSummarySortKey(draft: PackageSummaryDraft): number {
	return draft.directNodeCount * 1_000 + draft.ancestorNodeCount * 10 + draft.scriptIds.size;
}

function packageSummaryForDraft(draft: PackageSummaryDraft, rank: number): AffectedPackageSummary {
	return {
		packageId: draft.packageNode.id,
		label: draft.packageNode.label,
		directory: packageDirForNode(draft.packageNode),
		path: draft.packageNode.path,
		rank,
		directNodeCount: draft.directNodeCount,
		ancestorNodeCount: draft.ancestorNodeCount,
		scriptIds: [...draft.scriptIds],
	};
}

function validationCommandSummaries(
	graph: CodeGraphSnapshot,
	packages: readonly AffectedPackageSummary[],
	nodeIds: ReadonlySet<string>,
): readonly ValidationCommandSummary[] {
	const packageCommands = validationCommandSummariesForPackages(graph, packages);
	const focusedCommands = focusedTestCommandSummaries(graph, packages, packageCommands, nodeIds);
	const moduleCommands = moduleTestCommandSummaries(graph, packages, packageCommands, nodeIds);
	return [...focusedCommands, ...moduleCommands, ...packageCommands];
}

function validationCommandSummariesForPackages(
	graph: CodeGraphSnapshot,
	packages: readonly AffectedPackageSummary[],
): readonly ValidationCommandSummary[] {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	return packages.flatMap((summary) =>
		summary.scriptIds.flatMap((scriptId) => validationCommandSummaryForScript(nodesById, summary.packageId, scriptId)),
	);
}

function focusedTestCommandSummaries(
	graph: CodeGraphSnapshot,
	packages: readonly AffectedPackageSummary[],
	commands: readonly ValidationCommandSummary[],
	nodeIds: ReadonlySet<string>,
): readonly ValidationCommandSummary[] {
	const testCommandsByPackageId = testCommandByPackageId(commands);
	const testPaths = testPathsForSelection(graph, nodeIds);
	return uniqueValidationCommands(
		testPaths.flatMap((testPath) => {
			const packageSummary = packageForPath(packages, testPath);
			if (packageSummary === undefined) return [];
			const testCommand = testCommandsByPackageId.get(packageSummary.packageId);
			if (testCommand === undefined) return [];
			const command = focusedTestCommandForScript(packageSummary, testCommand, testPath);
			return command === undefined ? [] : [command];
		}),
	);
}

function testCommandByPackageId(
	commands: readonly ValidationCommandSummary[],
): ReadonlyMap<string, ValidationCommandSummary> {
	return new Map(
		commands.flatMap((command) => (command.name === "test" ? [[command.packageId, command] as const] : [])),
	);
}

function uniqueValidationCommands(commands: readonly ValidationCommandSummary[]): readonly ValidationCommandSummary[] {
	const byScriptId = new Map<string, ValidationCommandSummary>();
	for (const command of commands) {
		if (!byScriptId.has(command.scriptId)) byScriptId.set(command.scriptId, command);
	}
	return [...byScriptId.values()];
}

function testPathsForSelection(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly string[] {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const paths = new Set<string>();
	for (const edge of graph.edges) addSelectedTestPath(edge, nodesById, nodeIds, paths);
	return [...paths].sort();
}

function addSelectedTestPath(
	edge: CodeGraphEdge,
	nodesById: ReadonlyMap<string, CodeGraphNode>,
	nodeIds: ReadonlySet<string>,
	paths: Set<string>,
): void {
	const testPath = selectedTestPath(edge, nodesById, nodeIds);
	if (testPath !== undefined) paths.add(testPath);
}

function selectedTestPath(
	edge: CodeGraphEdge,
	nodesById: ReadonlyMap<string, CodeGraphNode>,
	nodeIds: ReadonlySet<string>,
): string | undefined {
	if (!isSelectedTestEdge(edge, nodesById, nodeIds)) return undefined;
	return nodesById.get(edge.to)?.path;
}

function isSelectedTestEdge(
	edge: CodeGraphEdge,
	nodesById: ReadonlyMap<string, CodeGraphNode>,
	nodeIds: ReadonlySet<string>,
): boolean {
	return edge.kind === "TESTS" && !isPackageScriptNode(nodesById.get(edge.from)) && edgeTouchesSelection(edge, nodeIds);
}

function isPackageScriptNode(node: CodeGraphNode | undefined): boolean {
	return node?.kind === "PackageScript";
}

function edgeTouchesSelection(edge: CodeGraphEdge, nodeIds: ReadonlySet<string>): boolean {
	return nodeIds.has(edge.from) || nodeIds.has(edge.to);
}

function focusedTestCommandForScript(
	packageSummary: AffectedPackageSummary,
	testCommand: ValidationCommandSummary,
	testPath: string,
): ValidationCommandSummary | undefined {
	const focusedCommand = focusedBunTestCommand(testCommand.command, packageSummary.directory, testPath);
	if (focusedCommand === undefined) return undefined;
	return {
		packageId: packageSummary.packageId,
		scriptId: `${testCommand.scriptId}#${testPath}`,
		name: `test:${testPath}`,
		command: focusedCommand,
		runCommand: focusedCommand,
		path: testCommand.path,
	};
}

function moduleTestCommandSummaries(
	graph: CodeGraphSnapshot,
	packages: readonly AffectedPackageSummary[],
	commands: readonly ValidationCommandSummary[],
	nodeIds: ReadonlySet<string>,
): readonly ValidationCommandSummary[] {
	return moduleTestScopesForSelection(graph, nodeIds).flatMap((modulePath) =>
		moduleTestCommandForPath(packages, commands, modulePath),
	);
}

function moduleTestScopesForSelection(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly string[] {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const scopes = new Set<string>();
	for (const nodeId of nodeIds) {
		const scope = moduleTestScopeForNode(nodesById.get(nodeId));
		if (scope !== undefined) scopes.add(scope);
	}
	return [...scopes].sort();
}

function moduleTestScopeForNode(node: CodeGraphNode | undefined): string | undefined {
	if (node?.path === undefined || !moduleTestSourceNodeKinds.has(node.kind) || isTestPath(node.path)) return undefined;
	return moduleTestScopePath(node.path);
}

function isTestPath(path: string): boolean {
	return path.includes("__tests__/") || /\.(test|spec)\.[cm]?[tj]sx?$/.test(path);
}

const moduleTestSourceNodeKinds = new Set<CodeGraphNode["kind"]>(["File", "GeneratedArtifact"]);

function moduleTestScopePath(path: string): string | undefined {
	const segments = path.split("/");
	const srcIndex = segments.indexOf("src");
	if (srcIndex >= 0) return srcScopePath(segments, srcIndex);
	return parentPath(path);
}

function srcScopePath(segments: readonly string[], srcIndex: number): string {
	const endIndex = segments.length > srcIndex + 2 ? srcIndex + 2 : srcIndex + 1;
	return segments.slice(0, endIndex).join("/");
}

function parentPath(path: string): string | undefined {
	const index = path.lastIndexOf("/");
	return index <= 0 ? undefined : path.slice(0, index);
}

function moduleTestCommandForPath(
	packages: readonly AffectedPackageSummary[],
	commands: readonly ValidationCommandSummary[],
	modulePath: string,
): readonly ValidationCommandSummary[] {
	const command = moduleTestCommandSummary(packages, commands, modulePath);
	return command === undefined ? [] : [command];
}

function moduleTestCommandSummary(
	packages: readonly AffectedPackageSummary[],
	commands: readonly ValidationCommandSummary[],
	modulePath: string,
): ValidationCommandSummary | undefined {
	const packageSummary = packageForPath(packages, modulePath);
	if (packageSummary === undefined) return undefined;
	return moduleTestCommandForPackage(packageSummary, commands, modulePath);
}

function moduleTestCommandForPackage(
	packageSummary: AffectedPackageSummary,
	commands: readonly ValidationCommandSummary[],
	modulePath: string,
): ValidationCommandSummary | undefined {
	const testCommand = commands.find(
		(command) => command.packageId === packageSummary.packageId && command.name === "test",
	);
	if (testCommand === undefined) return undefined;
	const command = focusedBunTestCommand(testCommand.command, packageSummary.directory, modulePath);
	if (command === undefined) return undefined;
	return {
		packageId: packageSummary.packageId,
		scriptId: `${testCommand.scriptId}#${modulePath}`,
		name: `test:${modulePath}`,
		command,
		runCommand: command,
		path: testCommand.path,
	};
}

function packageForPath(packages: readonly AffectedPackageSummary[], path: string): AffectedPackageSummary | undefined {
	return packages
		.filter((summary) => pathBelongsToPackage(path, summary.directory))
		.toSorted((left, right) => right.directory.length - left.directory.length)[0];
}

function focusedBunTestCommand(command: string | undefined, packageDir: string, testPath: string): string | undefined {
	if (command !== "bun test") return undefined;
	if (packageDir === ".") return `bun test ${shellPath(bunTestPathArgument(testPath))}`;
	if (!pathBelongsToPackage(testPath, packageDir)) return undefined;
	const relativePath = testPath.slice(packageDir.length + 1);
	return `cd ${shellPath(packageDir)} && bun test ${shellPath(bunTestPathArgument(relativePath))}`;
}

function bunTestPathArgument(path: string): string {
	return path.startsWith("./") || path.startsWith("../") || path.startsWith("/") ? path : `./${path}`;
}

function shellPath(path: string): string {
	return /^[A-Za-z0-9_./:-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

function selectedPackageScripts(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly CodeGraphNode[] {
	return graph.nodes.filter((node) => nodeIds.has(node.id) && node.kind === "PackageScript");
}

function validationCommandSummaryForScript(
	nodesById: ReadonlyMap<string, CodeGraphNode>,
	packageId: string,
	scriptId: string,
): readonly ValidationCommandSummary[] {
	const node = nodesById.get(scriptId);
	if (node === undefined) return [];
	return [
		{
			packageId,
			scriptId: node.id,
			name: node.label,
			command: metadataString(node, "command"),
			runCommand: packageScriptRunCommand(packageId, node.label),
			path: node.path,
		},
	];
}

function packageScriptRunCommand(packageId: string, scriptName: string): string {
	const command = `bun run ${shellPath(scriptName)}`;
	const packageDir = packageDirForPackageId(packageId);
	return packageDir === "." ? command : `cd ${shellPath(packageDir)} && ${command}`;
}

function packageDirForPackageId(packageId: string): string {
	const directory = packageId.startsWith("package:") ? packageId.slice("package:".length) : ".";
	return directory.length === 0 ? "." : directory;
}

function packageIdForScript(node: CodeGraphNode): string {
	const suffix = node.id.slice("script:".length);
	const scriptSuffix = `:${node.label}`;
	const packageDir = suffix.endsWith(scriptSuffix) ? suffix.slice(0, -scriptSuffix.length) : ".";
	return `package:${packageDir}`;
}

function metadataString(node: CodeGraphNode, key: string): string | undefined {
	const value = node.metadata[key];
	return typeof value === "string" ? value : undefined;
}

export function renderSlice(slice: GraphSlice): string {
	const pathNodes = slice.nodes.filter((node) => node.path !== undefined);
	const nonPathNodes = slice.nodes.filter((node) => node.path === undefined);
	return [
		`# ${slice.title}`,
		"",
		`Selector: \`${slice.selector}\``,
		`Nodes: ${slice.nodes.length}`,
		`Edges: ${slice.edges.length}`,
		"",
		"## Files",
		...pathNodes.slice(0, 200).map((node) => `- ${node.kind}: \`${node.path}\` - ${node.label}`),
		"",
		"## Related Nodes",
		...nonPathNodes.slice(0, 200).map((node) => `- ${node.kind}: ${node.label}`),
		"",
		...renderPackageContext(slice.summary),
		...renderAnnotationContext(slice.summary),
		"## Edges",
		...slice.edges
			.slice(0, 200)
			.map((edge) => `- ${edge.kind}: ${edge.from} -> ${edge.to}${edge.label ? ` (${edge.label})` : ""}`),
		"",
		"## Findings",
		...(slice.findings.length === 0
			? ["- None"]
			: slice.findings.map((finding) => `- ${finding.severity}: ${finding.message}`)),
		"",
	].join("\n");
}

function renderAnnotationContext(summary: GraphSliceSummary | undefined): readonly string[] {
	if (summary === undefined || summary.annotationNotes.length === 0) return ["## Semantic Notes", "- None", ""];
	return [
		"## Semantic Notes",
		...summary.annotationNotes
			.slice(0, 50)
			.map((note) => `- ${note.kind} ${note.status}: ${note.targetNodeId} - ${note.summary}`),
		"",
	];
}

function renderPackageContext(summary: GraphSliceSummary | undefined): readonly string[] {
	if (summary === undefined || summary.affectedPackages.length === 0) return ["## Package Context", "- None", ""];
	return [
		"## Package Context",
		...summary.affectedPackages
			.slice(0, 50)
			.map(
				(packageSummary) =>
					`- #${packageSummary.rank} ${packageSummary.label} (${packageSummary.directory}): ${packageSummary.directNodeCount} direct nodes, ${packageSummary.ancestorNodeCount} ancestor nodes; scripts ${scriptNames(packageSummary.scriptIds)}`,
			),
		"",
	];
}

function scriptNames(scriptIds: readonly string[]): string {
	if (scriptIds.length === 0) return "none";
	return scriptIds.map((scriptId) => scriptId.split(":").slice(2).join(":")).join(", ");
}

function selectNodes(graph: CodeGraphSnapshot, selector: string): readonly CodeGraphNode[] {
	if (selector === "all") return graph.nodes;
	const packageValue = packageSelectorValue(selector);
	if (packageValue !== undefined) return selectPackageNodes(graph, packageValue);
	const scopedSelector = scopedSelectorFor(selector);
	if (scopedSelector !== undefined) return graph.nodes.filter(scopedSelector);
	const lowered = selector.toLowerCase();
	return graph.nodes.filter(
		(node) =>
			node.id.toLowerCase().includes(lowered) ||
			node.label.toLowerCase().includes(lowered) ||
			node.path?.toLowerCase().includes(lowered),
	);
}

function sliceRelatedGraph(
	graph: CodeGraphSnapshot,
	nodeIds: ReadonlySet<string>,
): Pick<GraphSlice, "edges" | "findings" | "annotations"> {
	return {
		edges: graph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
		findings: graph.findings.filter((finding) => finding.nodeId === undefined || nodeIds.has(finding.nodeId)),
		annotations: selectedAnnotations(graph, nodeIds),
	};
}

function selectedAnnotations(graph: CodeGraphSnapshot, nodeIds: ReadonlySet<string>): readonly AgentAnnotation[] {
	return graph.annotations.filter(
		(annotation) => nodeIds.has(annotation.targetNodeId) && visibleAnnotationStatuses.has(annotation.status),
	);
}

function annotationNoteSummaries(annotations: readonly AgentAnnotation[]): readonly AnnotationNoteSummary[] {
	return annotations.map((annotation) => ({
		id: annotation.id,
		targetNodeId: annotation.targetNodeId,
		kind: annotation.kind,
		status: annotation.status,
		confidence: annotation.confidence,
		summary: annotation.summary,
		evidencePaths: annotation.evidence.map((item) => item.path),
	}));
}

const visibleAnnotationStatuses = new Set<AgentAnnotation["status"]>(["accepted", "stale"]);

function scopedSelectorFor(selector: string): ((node: CodeGraphNode) => boolean) | undefined {
	const prefixed = prefixedSelectorFor(selector);
	if (prefixed !== undefined) return prefixed;
	if (isNodeIdSelector(selector)) return nodeIdSelector(selector);
	return undefined;
}

function prefixedSelectorFor(selector: string): ((node: CodeGraphNode) => boolean) | undefined {
	const entry = selectorPrefixes.find((candidate) => selector.startsWith(candidate.prefix));
	return entry?.create(selector.slice(entry.prefix.length));
}

function pathSelector(rawPath: string): (node: CodeGraphNode) => boolean {
	const path = rawPath.replace(/^\.\//, "");
	return (node) => node.path === path || node.path?.startsWith(`${path}/`) === true;
}

function packageSelectorValue(selector: string): string | undefined {
	return selector.startsWith("package:") ? selector.slice("package:".length) : undefined;
}

function selectPackageNodes(graph: CodeGraphSnapshot, value: string): readonly CodeGraphNode[] {
	const selectedPackages = packageNodes(graph).filter((node) => packageNodeMatches(node, value));
	const selectedPackageDirs = new Set(selectedPackages.map(packageDirForNode));
	return graph.nodes.filter(
		(node) =>
			selectedPackages.some((packageNode) => packageNode.id === node.id) ||
			(node.path !== undefined && pathBelongsToSelectedPackage(node.path, selectedPackageDirs)),
	);
}

function packageNodeMatches(node: CodeGraphNode, value: string): boolean {
	const packageDir = packageDirForNode(node);
	if (node.id === `package:${value}`) return true;
	if (node.label === value) return true;
	if (packageDir === value) return true;
	return nodePathMatchesPackageSelector(node, value);
}

function nodePathMatchesPackageSelector(node: CodeGraphNode, value: string): boolean {
	if (value === ".") return false;
	if (node.path === undefined) return false;
	return pathBelongsToPackage(node.path, value);
}

function pathBelongsToSelectedPackage(path: string, packageDirs: ReadonlySet<string>): boolean {
	return [...packageDirs].some((dir) => dir !== "." && pathBelongsToPackage(path, dir));
}

function kindSelector(kind: string): (node: CodeGraphNode) => boolean {
	return (node) => node.kind === kind;
}

function configSelector(id: string): (node: CodeGraphNode) => boolean {
	const fullId = `config:${id}`;
	return (node) => node.id === fullId || node.id.startsWith(`${fullId}:`);
}

const selectorPrefixes = [
	{ prefix: "path:", create: pathSelector },
	{ prefix: "kind:", create: kindSelector },
	{ prefix: "config:", create: configSelector },
];

function isNodeIdSelector(selector: string): boolean {
	return nodeIdSelectorPrefixes.some((prefix) => selector.startsWith(prefix));
}

function nodeIdSelector(selector: string): (node: CodeGraphNode) => boolean {
	return (node) => node.id === selector;
}

const nodeIdSelectorPrefixes = [
	"dbfunction:",
	"dbpolicy:",
	"dbtable:",
	"dbtrigger:",
	"config:",
	"dir:",
	"dirty:",
	"env:",
	"external:",
	"file:",
	"iacmodule:",
	"iacresource:",
	"migration:",
	"repo:",
	"script:",
	"symbol:",
];

const impactEdgeKinds = new Set<CodeGraphEdge["kind"]>([
	"IMPORTS",
	"TYPE_IMPORTS",
	"DOCUMENTS",
	"GENERATED_BY",
	"USES_ENV",
	"CONFIGURES",
	"SERVICE_QUERIES_TABLE",
	"SERVICE_CALLS_RPC",
	"TABLE_REFERENCES_TABLE",
	"DEPENDS_ON",
	"MIGRATION_CREATES",
	"MIGRATION_ALTERS",
	"MIGRATION_DROPS",
	"RESOURCE_DEPENDS_ON",
	"AFFECTS",
]);
