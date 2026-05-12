import { basename } from "node:path";
import { DEFAULT_MAX_FILE_BYTES } from "./defaults.ts";
import {
	extractDataAccessFacts,
	extractDocReferenceFacts,
	extractEnvVars,
	extractIacDependencyFacts,
	extractIacFacts,
	extractImports,
	extractSqlReferenceFacts,
	extractSqlFacts,
	extractSymbols,
	extractWorkflowFacts,
	readText,
} from "./extractors.ts";
import { createRepoInventory, type GitInventory, type InventoryFile } from "./inventory.ts";
import { addPackageFacts } from "./package-facts.ts";
import { defaultIgnorePatterns } from "./path-utils.ts";
import {
	addEdge,
	addNode,
	addProvenanceEdge,
	createMutableGraph,
	fileNodeId,
	provenance,
	SCANNER_VERSION,
	type MutableGraph,
} from "./graph-store.ts";
import {
	directoryNodeId,
	freshnessFor,
	parentDirectory,
	parentDirectoryNodeId,
	uniqueDirectories,
} from "./graph-paths.ts";
import {
	CODE_GRAPH_SCHEMA_VERSION,
	type BuildCodeGraphOptions,
	type CodeGraphEdgeKind,
	type CodeGraphManifest,
	type CodeGraphNode,
	type CodeGraphSnapshot,
} from "./types.ts";

const sqlNodeKinds = {
	table: "DbTable",
	function: "DbFunction",
	policy: "DbPolicy",
	trigger: "DbTrigger",
} as const satisfies Record<ReturnType<typeof extractSqlFacts>[number]["kind"], CodeGraphNode["kind"]>;

const sqlEdgeKinds = {
	creates: "MIGRATION_CREATES",
	alters: "MIGRATION_ALTERS",
	drops: "MIGRATION_DROPS",
} as const satisfies Record<ReturnType<typeof extractSqlFacts>[number]["action"], CodeGraphEdgeKind>;

export async function buildCodeGraph(options: BuildCodeGraphOptions): Promise<CodeGraphSnapshot> {
	const context = await createBuildContext(options);
	addInventoryNodes(context.graph, context.inventory);
	await addInventoryFacts(context.graph, context.inventory);

	return snapshotFor(context);
}

interface BuildContext {
	readonly now: Date;
	readonly inventory: Awaited<ReturnType<typeof createRepoInventory>>;
	readonly graph: MutableGraph;
}

async function createBuildContext(options: BuildCodeGraphOptions): Promise<BuildContext> {
	const inventory = await createRepoInventory(options.root, options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
	const graph = createMutableGraph();
	return { now: options.now ?? new Date(), inventory, graph };
}

function addInventoryNodes(graph: MutableGraph, inventory: BuildContext["inventory"]): void {
	addRootNode(graph, inventory.root);
	addDirectoryNodes(graph, inventory.files);
	for (const file of inventory.files) addFileNode(graph, file);
}

async function addInventoryFacts(graph: MutableGraph, inventory: BuildContext["inventory"]): Promise<void> {
	const allPaths = new Set(inventory.files.map((file) => file.path));
	await addPackageFacts(graph, inventory.files);
	addGeneratedOwnershipFacts(graph, inventory.files);
	for (const file of inventory.files) await addFileFacts(graph, file, allPaths);
	addInferredTestCoverageFacts(graph, inventory.files, allPaths);
	await addSqlReferenceEdges(graph, inventory.files);
	await addDataAccessEdges(graph, inventory.files);
	await addIacDependencyEdges(graph, inventory.files);
}

function snapshotFor(context: BuildContext): CodeGraphSnapshot {
	const { graph, inventory, now } = context;
	const manifest = manifestFor(inventory.root, now, inventory.git, graph, inventory.files);
	return {
		schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
		manifest,
		nodes: [...graph.nodes.values()],
		edges: [...graph.edges.values()],
		findings: graph.findings,
		annotations: [],
	};
}

function addRootNode(graph: MutableGraph, root: string): void {
	addNode(graph, {
		id: "repo:root",
		kind: "RepoSnapshot",
		label: basename(root),
		metadata: { root },
		provenance: provenance("filesystem", []),
	});
}

function addDirectoryNodes(graph: MutableGraph, files: readonly InventoryFile[]): void {
	for (const directory of uniqueDirectories(files)) addDirectoryNode(graph, directory);
}

function addDirectoryNode(graph: MutableGraph, directory: string): void {
	const id = directoryNodeId(directory);
	addNode(graph, {
		id,
		kind: "Directory",
		label: directory,
		path: directory,
		metadata: {},
		provenance: provenance("filesystem", [{ path: directory }]),
	});
	addEdge(graph, "CONTAINS", parentDirectoryNodeId(directory), id, "contains");
}

function addFileNode(graph: MutableGraph, file: InventoryFile): void {
	addNode(graph, {
		id: fileNodeId(file.path),
		kind: fileNodeKind(file),
		label: basename(file.path),
		path: file.path,
		metadata: {
			sizeBytes: file.sizeBytes,
			lineCount: file.lineCount,
			fileKind: file.kind,
			gitStatus: file.gitStatus,
			readableText: file.readableText,
		},
		provenance: provenance("filesystem", [{ path: file.path, hash: file.hash }], freshnessFor(file)),
	});
	addEdge(graph, "CONTAINS", `dir:${parentDirectory(file.path)}`, fileNodeId(file.path), "contains");
	if (file.gitStatus !== "tracked" && file.gitStatus !== "unknown") addDirtyArtifact(graph, file);
}

function fileNodeKind(file: InventoryFile): CodeGraphNode["kind"] {
	if (file.kind === "generated") return "GeneratedArtifact";
	if (file.path.endsWith(".md")) return "Doc";
	return "File";
}

async function addFileFacts(graph: MutableGraph, file: InventoryFile, allPaths: ReadonlySet<string>): Promise<void> {
	const text = await readText(file);
	if (text === undefined) return;
	addImports(graph, file, text, allPaths);
	addDocReferenceFacts(graph, file, text, allPaths);
	addSymbols(graph, file, text);
	addEnvVars(graph, file, text);
	addSqlFacts(graph, file, text);
	addIacFacts(graph, file, text);
	addWorkflowFacts(graph, file, text);
}

function addImports(graph: MutableGraph, file: InventoryFile, text: string, allPaths: ReadonlySet<string>): void {
	for (const fact of extractImports(file, text, allPaths)) {
		addImportFact(graph, file, fact);
	}
}

function addImportFact(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractImports>[number],
): void {
	const dependencyId = importDependencyNodeId(graph, file, fact);
	if (dependencyId === undefined) return;
	addEdge(graph, importEdgeKind(fact), fileNodeId(file.path), dependencyId, fact.specifier);
	addTestCoverageEdge(graph, file, fact, dependencyId);
}

function importDependencyNodeId(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractImports>[number],
): string | undefined {
	if (fact.targetPath !== undefined) return fileNodeId(fact.targetPath);
	if (fact.externalPackage === undefined) return undefined;
	return addExternalDependency(graph, file, fact.externalPackage, fact.specifier);
}

function addExternalDependency(
	graph: MutableGraph,
	file: InventoryFile,
	packageName: string,
	specifier: string,
): string {
	const dependencyId = `external:${packageName}`;
	addNode(graph, {
		id: dependencyId,
		kind: "ExternalDependency",
		label: packageName,
		metadata: { specifier },
		provenance: provenance("syntax", [{ path: file.path }]),
	});
	return dependencyId;
}

function importEdgeKind(fact: ReturnType<typeof extractImports>[number]): CodeGraphEdgeKind {
	return fact.typeOnly ? "TYPE_IMPORTS" : "IMPORTS";
}

function addSymbols(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractSymbols(file, text)) {
		const symbolId = `symbol:${file.path}:${fact.name}`;
		addNode(graph, {
			id: symbolId,
			kind: "Symbol",
			label: fact.name,
			path: file.path,
			metadata: { symbolKind: fact.kind, exported: fact.exported },
			provenance: provenance("syntax", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		});
		addEdge(graph, "DEFINES", fileNodeId(file.path), symbolId, fact.kind);
		if (fact.exported) addEdge(graph, "EXPORTS", fileNodeId(file.path), symbolId, fact.kind);
	}
}

function addEnvVars(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractEnvVars(text)) {
		const envId = `env:${fact.name}`;
		addNode(graph, {
			id: envId,
			kind: "EnvVar",
			label: fact.name,
			metadata: {},
			provenance: provenance("syntax", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		});
		addEdge(graph, "USES_ENV", fileNodeId(file.path), envId, fact.name);
	}
}

function addDocReferenceFacts(
	graph: MutableGraph,
	file: InventoryFile,
	text: string,
	allPaths: ReadonlySet<string>,
): void {
	for (const fact of extractDocReferenceFacts(file, text, allPaths)) {
		addProvenanceEdge(
			graph,
			"DOCUMENTS",
			fileNodeId(file.path),
			fileNodeId(fact.targetPath),
			fact.label,
			provenance("doc-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		);
	}
}

function addSqlFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	addMigrationNode(graph, file);
	for (const fact of extractSqlFacts(file, text)) {
		const kind = sqlNodeKinds[fact.kind];
		const nodeId = `${kind.toLowerCase()}:${fact.name}`;
		addNode(graph, {
			id: nodeId,
			kind,
			label: fact.name,
			path: file.path,
			metadata: { action: fact.action },
			provenance: provenance("sql-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		});
		addProvenanceEdge(
			graph,
			sqlEdgeKinds[fact.action],
			sqlFactSourceNodeId(file),
			nodeId,
			fact.action,
			provenance("sql-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		);
	}
}

function addMigrationNode(graph: MutableGraph, file: InventoryFile): void {
	if (!isSqlMigrationPath(file.path)) return;
	const nodeId = migrationNodeId(file.path);
	addNode(graph, {
		id: nodeId,
		kind: "Migration",
		label: basename(file.path),
		path: file.path,
		metadata: { migrationKind: "sql" },
		provenance: provenance("sql-parser", [{ path: file.path, hash: file.hash }], freshnessFor(file)),
	});
	addProvenanceEdge(
		graph,
		"CONFIGURES",
		fileNodeId(file.path),
		nodeId,
		"sql migration",
		provenance("sql-parser", [{ path: file.path, hash: file.hash }], freshnessFor(file)),
	);
}

function sqlFactSourceNodeId(file: InventoryFile): string {
	return isSqlMigrationPath(file.path) ? migrationNodeId(file.path) : fileNodeId(file.path);
}

function migrationNodeId(path: string): string {
	return `migration:${path}`;
}

function isSqlMigrationPath(path: string): boolean {
	return path.endsWith(".sql") && /(^|\/)(migrations?|supabase\/migrations)\//i.test(path);
}

function addIacFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractIacFacts(file, text)) {
		const kind = fact.kind === "module" ? "IaCModule" : "IaCResource";
		const nodeId = `${kind.toLowerCase()}:${fact.type}:${fact.name}`;
		addNode(graph, {
			id: nodeId,
			kind,
			label: `${fact.type}.${fact.name}`,
			path: file.path,
			metadata: { type: fact.type, name: fact.name },
			provenance: provenance("iac-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		});
		addEdge(graph, "CONFIGURES", fileNodeId(file.path), nodeId, fact.kind);
	}
}

function addWorkflowFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	const facts = extractWorkflowFacts(file, text);
	for (const fact of facts) addWorkflowNode(graph, file, fact);
	for (const fact of facts) addWorkflowEdges(graph, file, fact);
}

function addWorkflowNode(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractWorkflowFacts>[number],
): void {
	addNode(graph, {
		id: workflowNodeId(file, fact),
		kind: "Config",
		label: fact.name,
		path: file.path,
		metadata: {
			configKind: "ci-workflow",
			workflowFactKind: fact.kind,
			workflowName: fact.workflowName,
			taskKind: fact.taskKind,
			...(fact.jobId === undefined ? {} : { jobId: fact.jobId }),
			...(fact.stepIndex === undefined ? {} : { stepIndex: fact.stepIndex }),
			...(fact.command === undefined ? {} : { command: fact.command }),
		},
		provenance: provenance("ci-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
	});
}

function addWorkflowEdges(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractWorkflowFacts>[number],
): void {
	const nodeId = workflowNodeId(file, fact);
	if (fact.kind === "workflow") {
		addProvenanceEdge(
			graph,
			"CONFIGURES",
			fileNodeId(file.path),
			nodeId,
			"ci workflow",
			provenance("ci-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		);
		return;
	}
	if (fact.kind === "job") {
		addProvenanceEdge(
			graph,
			"CONFIGURES",
			workflowRootNodeId(file),
			nodeId,
			fact.taskKind,
			provenance("ci-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
		);
		return;
	}
	addProvenanceEdge(
		graph,
		"CONFIGURES",
		workflowJobNodeId(file, fact.jobId ?? "unknown"),
		nodeId,
		fact.taskKind,
		provenance("ci-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
	);
}

function workflowNodeId(file: InventoryFile, fact: ReturnType<typeof extractWorkflowFacts>[number]): string {
	if (fact.kind === "workflow") return workflowRootNodeId(file);
	if (fact.kind === "job") return workflowJobNodeId(file, fact.jobId ?? fact.name);
	return `config:ci:${file.path}:job:${fact.jobId ?? "unknown"}:run:${fact.stepIndex ?? fact.line}`;
}

function workflowRootNodeId(file: InventoryFile): string {
	return `config:ci:${file.path}`;
}

function workflowJobNodeId(file: InventoryFile, jobId: string): string {
	return `config:ci:${file.path}:job:${jobId}`;
}

async function addSqlReferenceEdges(graph: MutableGraph, files: readonly InventoryFile[]): Promise<void> {
	for (const file of files) {
		const text = await readText(file);
		if (text === undefined) continue;
		addSqlReferenceFacts(graph, file, text);
	}
}

function addSqlReferenceFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractSqlReferenceFacts(file, text)) addSqlReferenceFact(graph, fact);
}

function addSqlReferenceFact(graph: MutableGraph, fact: ReturnType<typeof extractSqlReferenceFacts>[number]): void {
	const ids = sqlReferenceEdgeIds(graph, fact);
	if (ids === undefined) return;
	addEdge(graph, "TABLE_REFERENCES_TABLE", ids.fromId, ids.toId, fact.toTable);
}

function sqlReferenceEdgeIds(
	graph: MutableGraph,
	fact: ReturnType<typeof extractSqlReferenceFacts>[number],
): { readonly fromId: string; readonly toId: string } | undefined {
	const fromId = dbNodeIdByName(graph, "DbTable", "dbtable:", fact.fromTable);
	const toId = dbNodeIdByName(graph, "DbTable", "dbtable:", fact.toTable);
	if (fromId === undefined) return undefined;
	if (toId === undefined) return undefined;
	if (fromId === toId) return undefined;
	return { fromId, toId };
}

async function addDataAccessEdges(graph: MutableGraph, files: readonly InventoryFile[]): Promise<void> {
	for (const file of files) {
		const text = await readText(file);
		if (text === undefined) continue;
		addDataAccessFacts(graph, file, text);
	}
}

function addDataAccessFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractDataAccessFacts(file, text)) addDataAccessFact(graph, file, fact);
}

function addDataAccessFact(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractDataAccessFacts>[number],
): void {
	const targetId = dataAccessTargetNodeId(graph, fact);
	if (targetId === undefined) return;
	addEdge(graph, dataAccessEdgeKind(fact), fileNodeId(file.path), targetId, fact.name);
}

function dataAccessEdgeKind(fact: ReturnType<typeof extractDataAccessFacts>[number]): CodeGraphEdgeKind {
	return fact.kind === "rpc" ? "SERVICE_CALLS_RPC" : "SERVICE_QUERIES_TABLE";
}

function dataAccessTargetNodeId(
	graph: MutableGraph,
	fact: ReturnType<typeof extractDataAccessFacts>[number],
): string | undefined {
	return dbNodeIdByName(graph, dataAccessNodeKind(fact), dataAccessNodePrefix(fact), fact.name);
}

function dataAccessNodeKind(
	fact: ReturnType<typeof extractDataAccessFacts>[number],
): Extract<CodeGraphNode["kind"], "DbFunction" | "DbTable"> {
	return fact.kind === "rpc" ? "DbFunction" : "DbTable";
}

function dataAccessNodePrefix(fact: ReturnType<typeof extractDataAccessFacts>[number]): "dbfunction:" | "dbtable:" {
	return fact.kind === "rpc" ? "dbfunction:" : "dbtable:";
}

function dbNodeIdByName(
	graph: MutableGraph,
	kind: Extract<CodeGraphNode["kind"], "DbFunction" | "DbTable">,
	prefix: "dbfunction:" | "dbtable:",
	name: string,
): string | undefined {
	const exact = [`${prefix}${name}`, `${prefix}public.${name}`].find((id) => graph.nodes.get(id)?.kind === kind);
	if (exact !== undefined) return exact;
	return uniqueDbNodeBySuffix(graph, kind, `.${name}`)?.id;
}

function uniqueDbNodeBySuffix(
	graph: MutableGraph,
	kind: Extract<CodeGraphNode["kind"], "DbFunction" | "DbTable">,
	suffix: string,
): CodeGraphNode | undefined {
	const matches = [...graph.nodes.values()].filter((node) => node.kind === kind && node.label.endsWith(suffix));
	return matches.length === 1 ? matches[0] : undefined;
}

async function addIacDependencyEdges(graph: MutableGraph, files: readonly InventoryFile[]): Promise<void> {
	for (const file of files) {
		const text = await readText(file);
		if (text === undefined) continue;
		addIacDependencyFacts(graph, file, text);
	}
}

function addIacDependencyFacts(graph: MutableGraph, file: InventoryFile, text: string): void {
	for (const fact of extractIacDependencyFacts(file, text)) addIacDependencyFact(graph, file, fact);
}

function addIacDependencyFact(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractIacDependencyFacts>[number],
): void {
	const fromId = iacDependencyNodeId(fact.from);
	const toId = iacDependencyNodeId(fact.to);
	if (fromId === toId) return;
	if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) return;
	addProvenanceEdge(
		graph,
		"RESOURCE_DEPENDS_ON",
		fromId,
		toId,
		iacDependencyLabel(fact.to),
		provenance("iac-parser", [{ path: file.path, startLine: fact.line, endLine: fact.line }]),
	);
}

function iacDependencyNodeId(endpoint: ReturnType<typeof extractIacDependencyFacts>[number]["from"]): string {
	if (endpoint.kind === "module") return `iacmodule:module:${endpoint.name}`;
	return `iacresource:${endpoint.type}:${endpoint.name}`;
}

function iacDependencyLabel(endpoint: ReturnType<typeof extractIacDependencyFacts>[number]["to"]): string {
	if (endpoint.kind === "module") return `module.${endpoint.name}`;
	return `${endpoint.type}.${endpoint.name}`;
}

function addDirtyArtifact(graph: MutableGraph, file: InventoryFile): void {
	const dirtyId = `dirty:${file.path}`;
	addNode(graph, {
		id: dirtyId,
		kind: "DirtyArtifact",
		label: file.gitStatus,
		path: file.path,
		metadata: { status: file.gitStatus },
		provenance: provenance("git", [{ path: file.path, hash: file.hash }], freshnessFor(file)),
	});
	addEdge(graph, "AFFECTS", dirtyId, fileNodeId(file.path), file.gitStatus);
}

function addGeneratedOwnershipFacts(graph: MutableGraph, files: readonly InventoryFile[]): void {
	const generatedFiles = files.filter((file) => file.kind === "generated");
	if (generatedFiles.length === 0) return;
	addGeneratedEdgesForScripts(graph, generatedFiles);
}

function addGeneratedEdgesForScripts(graph: MutableGraph, generatedFiles: readonly InventoryFile[]): void {
	for (const script of packageScriptNodes(graph)) {
		addGeneratedEdgesForScript(graph, script, generatedFiles);
	}
}

function packageScriptNodes(graph: MutableGraph): CodeGraphNode[] {
	return [...graph.nodes.values()].filter((node) => node.kind === "PackageScript");
}

function addGeneratedEdgesForScript(
	graph: MutableGraph,
	script: CodeGraphNode,
	generatedFiles: readonly InventoryFile[],
): void {
	const command = stringMetadata(script.metadata["command"]);
	if (command === undefined) return;
	for (const file of generatedFiles) addGeneratedEdgeIfMatched(graph, script, command, file);
}

function addGeneratedEdgeIfMatched(
	graph: MutableGraph,
	script: CodeGraphNode,
	command: string,
	file: InventoryFile,
): void {
	if (!scriptGeneratesFile(script.label, command, file.path)) return;
	addEdge(graph, "GENERATED_BY", fileNodeId(file.path), script.id, "generated by");
}

function addTestCoverageEdge(
	graph: MutableGraph,
	file: InventoryFile,
	fact: ReturnType<typeof extractImports>[number],
	dependencyId: string,
): void {
	if (!isTestTargetImport(file, fact)) return;
	addEdge(graph, "TESTS", dependencyId, fileNodeId(file.path), "tested by");
}

function addInferredTestCoverageFacts(
	graph: MutableGraph,
	files: readonly InventoryFile[],
	allPaths: ReadonlySet<string>,
): void {
	for (const file of files) addInferredTestCoverageEdges(graph, file, allPaths);
}

function addInferredTestCoverageEdges(graph: MutableGraph, file: InventoryFile, allPaths: ReadonlySet<string>): void {
	for (const sourcePath of inferredTestTargetPaths(file.path, allPaths)) {
		addProvenanceEdge(
			graph,
			"TESTS",
			fileNodeId(sourcePath),
			fileNodeId(file.path),
			"tested by naming convention",
			provenance("filesystem", [{ path: sourcePath }, { path: file.path }]),
		);
	}
}

function inferredTestTargetPaths(testPath: string, allPaths: ReadonlySet<string>): readonly string[] {
	const targetPath = testTargetPath(testPath);
	if (targetPath === undefined) return [];
	const candidates = new Set<string>([targetPath]);
	for (const candidate of testTargetPathsFromTestsDirectory(testPath)) candidates.add(candidate);
	return [...candidates].filter((candidate) => allPaths.has(candidate) && !isTestFile(candidate));
}

function testTargetPath(testPath: string): string | undefined {
	const match = testPath.match(/^(.*)\.(test|spec)(\.[cm]?[jt]sx?)$/);
	if (match === null) return undefined;
	const [, stem, , extension] = match;
	return stem === undefined || extension === undefined ? undefined : `${stem}${extension}`;
}

function testTargetPathsFromTestsDirectory(testPath: string): readonly string[] {
	const marker = "/__tests__/";
	const markerIndex = testPath.indexOf(marker);
	if (markerIndex < 0) return [];
	const baseDir = testPath.slice(0, markerIndex);
	const relativeTestPath = testPath.slice(markerIndex + marker.length);
	const relativeTargetPath = testTargetPath(relativeTestPath);
	if (relativeTargetPath === undefined) return [];
	return pathizedTestTargetPaths(relativeTargetPath).map((candidate) => `${baseDir}/${candidate}`);
}

function pathizedTestTargetPaths(relativeTargetPath: string): readonly string[] {
	const parts = testTargetPathParts(relativeTargetPath);
	if (parts === undefined) return [relativeTargetPath];
	const placement = pathVariantPlacement(parts.pathWithoutExtension);
	return [
		relativeTargetPath,
		...hyphenPathVariants(placement.stem).map((variant) => `${placement.prefix}${variant}${parts.extension}`),
	];
}

function testTargetPathParts(
	relativeTargetPath: string,
): { readonly pathWithoutExtension: string; readonly extension: string } | undefined {
	const extensionMatch = relativeTargetPath.match(/^(.+?)(\.[cm]?[jt]sx?)$/);
	if (extensionMatch === null) return undefined;
	const [, pathWithoutExtension, extension] = extensionMatch;
	return pathWithoutExtension === undefined || extension === undefined
		? undefined
		: { pathWithoutExtension, extension };
}

function pathVariantPlacement(pathWithoutExtension: string): { readonly prefix: string; readonly stem: string } {
	const directory = parentDirectory(pathWithoutExtension);
	const stem = pathWithoutExtension.slice(directory === "." ? 0 : directory.length + 1);
	const prefix = directory === "." ? "" : `${directory}/`;
	return { prefix, stem };
}

function hyphenPathVariants(stem: string): readonly string[] {
	const parts = stem.split("-").filter((part) => part.length > 0);
	if (parts.length < 2) return [];
	return partitionHyphenParts(parts).map((groups) => groups.map((group) => group.join("-")).join("/"));
}

function partitionHyphenParts(parts: readonly string[]): readonly string[][][] {
	if (parts.length === 0) return [[]];
	const variants: string[][][] = [];
	for (let size = 1; size <= parts.length; size += 1) {
		const head = parts.slice(0, size);
		for (const tail of partitionHyphenParts(parts.slice(size))) variants.push([head, ...tail]);
	}
	return variants;
}

function isTestTargetImport(file: InventoryFile, fact: ReturnType<typeof extractImports>[number]): boolean {
	if (!isTestFile(file.path)) return false;
	if (fact.targetPath === undefined) return false;
	return !isTestFile(fact.targetPath);
}

function scriptGeneratesFile(scriptName: string, command: string, path: string): boolean {
	const normalizedCommand = command.split("\\").join("/");
	if (normalizedCommand.includes(path)) return true;
	return generationScriptName(scriptName) && normalizedCommand.includes(basename(path));
}

function generationScriptName(scriptName: string): boolean {
	return /(^|[:_-])(gen|generate|codegen|types)([:_-]|$)|build:types|db:types/i.test(scriptName);
}

function stringMetadata(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isTestFile(path: string): boolean {
	return path.includes("/__tests__/") || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.startsWith("e2e/tests/");
}

function manifestFor(
	root: string,
	now: Date,
	git: GitInventory,
	graph: MutableGraph,
	files: readonly InventoryFile[],
): CodeGraphManifest {
	const packageCount = [...graph.nodes.values()].filter((node) => node.kind === "Package").length;
	return {
		schemaVersion: CODE_GRAPH_SCHEMA_VERSION,
		root,
		generatedAt: now.toISOString(),
		scanner: { name: "cartographer", version: SCANNER_VERSION },
		git: {
			...(git.commit !== undefined ? { commit: git.commit } : {}),
			dirty: git.dirty,
			trackedFiles: git.trackedFiles,
			untrackedFiles: git.untrackedFiles,
			modifiedFiles: git.modifiedFiles,
			deletedFiles: git.deletedFiles,
		},
		totals: {
			files: files.length,
			packages: packageCount,
			nodes: graph.nodes.size,
			edges: graph.edges.size,
			findings: graph.findings.length,
		},
		ignorePatterns: defaultIgnorePatterns(),
	};
}
