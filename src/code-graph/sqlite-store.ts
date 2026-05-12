import { createHash } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { codeGraphSnapshotSchema } from "./schema.ts";
import type {
	AgentAnnotation,
	CodeGraphEdge,
	CodeGraphEvidence,
	CodeGraphFinding,
	CodeGraphManifest,
	CodeGraphNode,
	CodeGraphProvenance,
	CodeGraphSnapshot,
} from "./types.ts";

const GRAPH_SQLITE_FILE = "graph.sqlite";

interface ProvenanceClassRow {
	readonly id: number;
	readonly source: CodeGraphProvenance["source"];
	readonly confidence: CodeGraphProvenance["confidence"];
	readonly freshness: CodeGraphProvenance["freshness"];
	readonly snapshot_commit: string | null;
	readonly scanner_version: string | null;
}

interface NodeRow {
	readonly id: string;
	readonly kind: CodeGraphNode["kind"];
	readonly label: string;
	readonly path: string | null;
	readonly metadata_json: string;
	readonly provenance_class_id: number;
}

interface EdgeRow {
	readonly id: number;
	readonly edge_key: string;
	readonly kind: CodeGraphEdge["kind"];
	readonly from_id: string;
	readonly to_id: string;
	readonly label: string | null;
	readonly metadata_json: string;
	readonly provenance_class_id: number;
}

interface EvidenceRow {
	readonly owner_id: string;
	readonly path: string;
	readonly start_line: number | null;
	readonly end_line: number | null;
	readonly hash: string | null;
}

interface FindingRow {
	readonly id: string;
	readonly severity: CodeGraphFinding["severity"];
	readonly message: string;
	readonly node_id: string | null;
	readonly evidence_json: string;
}

interface AnnotationRow {
	readonly json: string;
}

export function graphSqlitePath(outDir: string): string {
	return join(outDir, GRAPH_SQLITE_FILE);
}

export async function writeSqliteCodeGraph(graph: CodeGraphSnapshot, outDir: string): Promise<void> {
	const parsed = codeGraphSnapshotSchema.parse(graph);
	await mkdir(outDir, { recursive: true });
	const dbPath = graphSqlitePath(outDir);
	await unlink(dbPath).catch(() => undefined);
	const db = new Database(dbPath, { create: true, readwrite: true });
	try {
		createSchema(db);
		writeSnapshot(db, parsed);
	} finally {
		db.close();
	}
}

export async function readSqliteCodeGraph(outDir: string): Promise<CodeGraphSnapshot> {
	const db = new Database(graphSqlitePath(outDir), { readonly: true, create: false });
	try {
		return codeGraphSnapshotSchema.parse(readSnapshot(db));
	} finally {
		db.close();
	}
}

export async function sqliteCodeGraphExists(outDir: string): Promise<boolean> {
	return Bun.file(graphSqlitePath(outDir)).exists();
}

export async function sqliteIntegrityCheck(outDir: string): Promise<readonly string[]> {
	if (!(await sqliteCodeGraphExists(outDir))) return ["missing graph.sqlite"];
	const db = new Database(graphSqlitePath(outDir), { readonly: true, create: false });
	try {
		const rows = db.query<{ integrity_check: string }, []>("PRAGMA integrity_check").all();
		return rows.map((row) => row.integrity_check).filter((value) => value !== "ok");
	} finally {
		db.close();
	}
}

function createSchema(db: Database): void {
	db.run(`
CREATE TABLE manifest (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE paths (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  kind TEXT,
  size_bytes INTEGER,
  line_count INTEGER,
  hash TEXT,
  git_status TEXT,
  readable_text INTEGER NOT NULL DEFAULT 1,
  generated INTEGER NOT NULL DEFAULT 0,
  ignored INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE provenance_classes (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  confidence TEXT NOT NULL,
  freshness TEXT,
  extractor TEXT,
  extractor_version TEXT,
  scanner_version TEXT,
  snapshot_commit TEXT,
  default_for_snapshot INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source, confidence, freshness, extractor, extractor_version, scanner_version, snapshot_commit)
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  path_id INTEGER,
  path TEXT,
  metadata_json TEXT NOT NULL,
  provenance_class_id INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(path_id) REFERENCES paths(id)
);
CREATE INDEX idx_nodes_kind ON nodes(kind);
CREATE INDEX idx_nodes_path_id ON nodes(path_id);

CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  edge_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  label TEXT,
  metadata_json TEXT NOT NULL,
  provenance_class_id INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(from_id) REFERENCES nodes(id),
  FOREIGN KEY(to_id) REFERENCES nodes(id),
  UNIQUE(kind, from_id, to_id, label)
);
CREATE INDEX idx_edges_kind ON edges(kind);
CREATE INDEX idx_edges_from ON edges(from_id);
CREATE INDEX idx_edges_to ON edges(to_id);
CREATE INDEX idx_edges_to_kind ON edges(to_id, kind);
CREATE INDEX idx_edges_from_kind ON edges(from_id, kind);

CREATE TABLE evidence (
  id INTEGER PRIMARY KEY,
  path_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  hash TEXT,
  excerpt_hash TEXT,
  FOREIGN KEY(path_id) REFERENCES paths(id)
);

CREATE TABLE node_evidence (
  node_id TEXT NOT NULL,
  evidence_id INTEGER NOT NULL,
  PRIMARY KEY(node_id, evidence_id)
);

CREATE TABLE edge_evidence (
  edge_id INTEGER NOT NULL,
  evidence_id INTEGER NOT NULL,
  PRIMARY KEY(edge_id, evidence_id)
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  node_id TEXT,
  evidence_json TEXT NOT NULL
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

CREATE TABLE packages (
  node_id TEXT PRIMARY KEY,
  name TEXT,
  directory_path_id INTEGER,
  manifest_path_id INTEGER,
  manager TEXT
);

CREATE TABLE package_scripts (
  node_id TEXT PRIMARY KEY,
  package_node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  run_command TEXT,
  path_id INTEGER
);

CREATE TABLE symbols (
  id TEXT PRIMARY KEY,
  file_node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  exported INTEGER NOT NULL,
  line_start INTEGER,
  line_end INTEGER
);
CREATE INDEX idx_symbols_file ON symbols(file_node_id);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_exported ON symbols(exported);

CREATE TABLE imports (
  source_file_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  specifier TEXT NOT NULL,
  type_only INTEGER NOT NULL DEFAULT 0,
  external INTEGER NOT NULL DEFAULT 0,
  line_start INTEGER,
  PRIMARY KEY(source_file_id, target_node_id, specifier, type_only)
);
CREATE INDEX idx_imports_target ON imports(target_node_id);

CREATE TABLE env_uses (
  file_node_id TEXT NOT NULL,
  env_node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  line_start INTEGER,
  PRIMARY KEY(file_node_id, env_node_id, line_start)
);

CREATE TABLE test_targets (
  target_node_id TEXT NOT NULL,
  test_file_node_id TEXT NOT NULL,
  confidence TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY(target_node_id, test_file_node_id)
);

CREATE TABLE db_facts (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  schema_name TEXT,
  object_name TEXT NOT NULL,
  action TEXT,
  path_id INTEGER,
  line_start INTEGER
);

CREATE TABLE iac_facts (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  resource_type TEXT,
  name TEXT NOT NULL,
  path_id INTEGER,
  line_start INTEGER
);

CREATE TABLE ci_facts (
  node_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  workflow TEXT,
  job_id TEXT,
  step_index INTEGER,
  task_kind TEXT,
  command TEXT,
  path_id INTEGER,
  line_start INTEGER
);
`);
}

function writeSnapshot(db: Database, graph: CodeGraphSnapshot): void {
	const paths = pathIndex(graph);
	const provenanceClasses = provenanceClassIndex(graph);
	const insert = prepareInsertStatements(db);
	const insertAll = db.transaction(() => {
		insert.manifest.run("schemaVersion", JSON.stringify(graph.schemaVersion));
		insert.manifest.run("manifest", JSON.stringify(graph.manifest));
		insert.manifest.run("graphHash", JSON.stringify(graphHash(graph)));
		for (const [path, id] of paths) insertPath(insert.path, id, path, graph);
		for (const [key, id] of provenanceClasses) insertProvenance(insert.provenance, id, JSON.parse(key));
		for (const node of graph.nodes) insertNode(insert, node, paths, provenanceClasses);
		for (const edge of graph.edges) insertEdge(insert, edge, paths, provenanceClasses);
		for (const finding of graph.findings) insertFinding(insert.finding, finding);
		for (const annotation of graph.annotations) insert.annotation.run(annotation.id, JSON.stringify(annotation));
		insertTypedFacts(insert, graph, paths);
	});
	insertAll();
}

function readSnapshot(db: Database): CodeGraphSnapshot {
	const manifest = readManifest(db);
	const provenanceClasses = readProvenanceClasses(db);
	const nodeEvidence = readEvidenceMap(db, "node");
	const edgeEvidence = readEvidenceMap(db, "edge");
	const nodes = db.query<NodeRow, []>("SELECT * FROM nodes ORDER BY id").all().map((row) => nodeFromRow(row, provenanceClasses, nodeEvidence));
	const edges = db.query<EdgeRow, []>("SELECT * FROM edges ORDER BY id").all().map((row) => edgeFromRow(row, provenanceClasses, edgeEvidence));
	const findings = db.query<FindingRow, []>("SELECT * FROM findings ORDER BY id").all().map(findingFromRow);
	const annotations = db.query<AnnotationRow, []>("SELECT json FROM annotations ORDER BY id").all().map((row) => JSON.parse(row.json) as AgentAnnotation);
	return {
		schemaVersion: manifest.schemaVersion,
		manifest,
		nodes,
		edges,
		findings,
		annotations,
	};
}

function prepareInsertStatements(db: Database) {
	return {
		manifest: db.prepare("INSERT INTO manifest (key, value_json) VALUES (?, ?)"),
		path: db.prepare(
			"INSERT INTO paths (id, path, kind, size_bytes, line_count, hash, git_status, readable_text, generated, ignored) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		),
		provenance: db.prepare(
			"INSERT INTO provenance_classes (id, source, confidence, freshness, extractor, extractor_version, scanner_version, snapshot_commit, default_for_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		),
		node: db.prepare(
			"INSERT INTO nodes (id, kind, label, path_id, path, metadata_json, provenance_class_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
		),
		edge: db.prepare(
			"INSERT INTO edges (edge_key, kind, from_id, to_id, label, metadata_json, provenance_class_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
		),
		evidence: db.prepare(
			"INSERT INTO evidence (path_id, path, start_line, end_line, hash, excerpt_hash) VALUES (?, ?, ?, ?, ?, ?)",
		),
		nodeEvidence: db.prepare("INSERT INTO node_evidence (node_id, evidence_id) VALUES (?, ?)"),
		edgeEvidence: db.prepare("INSERT INTO edge_evidence (edge_id, evidence_id) VALUES (?, ?)"),
		finding: db.prepare(
			"INSERT INTO findings (id, severity, message, node_id, evidence_json) VALUES (?, ?, ?, ?, ?)",
		),
		annotation: db.prepare("INSERT INTO annotations (id, json) VALUES (?, ?)"),
		package: db.prepare(
			"INSERT INTO packages (node_id, name, directory_path_id, manifest_path_id, manager) VALUES (?, ?, ?, ?, ?)",
		),
		packageScript: db.prepare(
			"INSERT INTO package_scripts (node_id, package_node_id, name, command, run_command, path_id) VALUES (?, ?, ?, ?, ?, ?)",
		),
		symbol: db.prepare(
			"INSERT INTO symbols (id, file_node_id, name, kind, exported, line_start, line_end) VALUES (?, ?, ?, ?, ?, ?, ?)",
		),
		import: db.prepare(
			"INSERT OR IGNORE INTO imports (source_file_id, target_node_id, specifier, type_only, external, line_start) VALUES (?, ?, ?, ?, ?, ?)",
		),
		envUse: db.prepare(
			"INSERT OR IGNORE INTO env_uses (file_node_id, env_node_id, name, line_start) VALUES (?, ?, ?, ?)",
		),
		testTarget: db.prepare(
			"INSERT OR IGNORE INTO test_targets (target_node_id, test_file_node_id, confidence, reason) VALUES (?, ?, ?, ?)",
		),
		dbFact: db.prepare(
			"INSERT INTO db_facts (node_id, kind, schema_name, object_name, action, path_id, line_start) VALUES (?, ?, ?, ?, ?, ?, ?)",
		),
		iacFact: db.prepare(
			"INSERT INTO iac_facts (node_id, kind, resource_type, name, path_id, line_start) VALUES (?, ?, ?, ?, ?, ?)",
		),
		ciFact: db.prepare(
			"INSERT INTO ci_facts (node_id, kind, workflow, job_id, step_index, task_kind, command, path_id, line_start) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		),
	};
}

function pathIndex(graph: CodeGraphSnapshot): Map<string, number> {
	const paths = new Set<string>();
	for (const node of graph.nodes) {
		if (node.path !== undefined) paths.add(node.path);
		for (const evidence of node.provenance.evidence) paths.add(evidence.path);
	}
	for (const edge of graph.edges) for (const evidence of edge.provenance.evidence) paths.add(evidence.path);
	for (const finding of graph.findings) for (const evidence of finding.evidence) paths.add(evidence.path);
	for (const annotation of graph.annotations) for (const evidence of annotation.evidence) paths.add(evidence.path);
	return new Map([...paths].sort().map((path, index) => [path, index + 1]));
}

function provenanceClassIndex(graph: CodeGraphSnapshot): Map<string, number> {
	const keys = new Set<string>();
	for (const node of graph.nodes) keys.add(provenanceClassKey(node.provenance));
	for (const edge of graph.edges) keys.add(provenanceClassKey(edge.provenance));
	return new Map([...keys].sort().map((key, index) => [key, index + 1]));
}

function provenanceClassKey(provenance: CodeGraphProvenance): string {
	return JSON.stringify({
		source: provenance.source,
		confidence: provenance.confidence,
		freshness: provenance.freshness,
		scannerVersion: provenance.scannerVersion ?? null,
		snapshotCommit: provenance.snapshotCommit ?? null,
	});
}

function insertPath(statement: ReturnType<Database["prepare"]>, id: number, path: string, graph: CodeGraphSnapshot): void {
	const node = graph.nodes.find((candidate) => candidate.path === path);
	statement.run(
		id,
		path,
		node?.kind ?? null,
		numberMetadata(node, "sizeBytes"),
		numberMetadata(node, "lineCount"),
		firstEvidenceHash(node),
		stringMetadata(node, "gitStatus") ?? null,
		boolMetadata(node, "readableText") === false ? 0 : 1,
		node?.kind === "GeneratedArtifact" ? 1 : 0,
		0,
	);
}

function insertProvenance(statement: ReturnType<Database["prepare"]>, id: number, value: Record<string, unknown>): void {
	statement.run(
		id,
		String(value["source"]),
		String(value["confidence"]),
		String(value["freshness"]),
		null,
		null,
		nullableString(value["scannerVersion"]),
		nullableString(value["snapshotCommit"]),
		id === 1 ? 1 : 0,
	);
}

function insertNode(
	statements: ReturnType<typeof prepareInsertStatements>,
	node: CodeGraphNode,
	paths: ReadonlyMap<string, number>,
	provenanceClasses: ReadonlyMap<string, number>,
): void {
	statements.node.run(
		node.id,
		node.kind,
		node.label,
		node.path === undefined ? null : paths.get(node.path) ?? null,
		node.path ?? null,
		JSON.stringify(node.metadata),
		requiredMapValue(provenanceClasses, provenanceClassKey(node.provenance)),
	);
	insertEvidenceRecords(node.id, node.provenance.evidence, paths, statements.evidence, statements.nodeEvidence);
}

function insertEdge(
	statements: ReturnType<typeof prepareInsertStatements>,
	edge: CodeGraphEdge,
	paths: ReadonlyMap<string, number>,
	provenanceClasses: ReadonlyMap<string, number>,
): void {
	const inserted = statements.edge.run(
		edge.id,
		edge.kind,
		edge.from,
		edge.to,
		edge.label ?? null,
		JSON.stringify(edge.metadata),
		requiredMapValue(provenanceClasses, provenanceClassKey(edge.provenance)),
	);
	insertEvidenceRecords(Number(inserted.lastInsertRowid), edge.provenance.evidence, paths, statements.evidence, statements.edgeEvidence);
}

function insertEvidenceRecords(
	ownerId: string | number,
	evidenceItems: readonly CodeGraphEvidence[],
	paths: ReadonlyMap<string, number>,
	evidenceStatement: ReturnType<Database["prepare"]>,
	linkStatement: ReturnType<Database["prepare"]>,
): void {
	for (const evidence of evidenceItems) {
		const inserted = evidenceStatement.run(
			requiredMapValue(paths, evidence.path),
			evidence.path,
			evidence.startLine ?? null,
			evidence.endLine ?? null,
			evidence.hash ?? null,
			evidence.hash ?? null,
		);
		linkStatement.run(ownerId, Number(inserted.lastInsertRowid));
	}
}

function insertFinding(statement: ReturnType<Database["prepare"]>, finding: CodeGraphFinding): void {
	statement.run(finding.id, finding.severity, finding.message, finding.nodeId ?? null, JSON.stringify(finding.evidence));
}

function insertTypedFacts(
	statements: ReturnType<typeof prepareInsertStatements>,
	graph: CodeGraphSnapshot,
	paths: ReadonlyMap<string, number>,
): void {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	for (const node of graph.nodes) insertTypedNodeFact(statements, node, paths);
	for (const edge of graph.edges) insertTypedEdgeFact(statements, edge, nodesById);
}

function insertTypedNodeFact(
	statements: ReturnType<typeof prepareInsertStatements>,
	node: CodeGraphNode,
	paths: ReadonlyMap<string, number>,
): void {
	if (node.kind === "Package") {
		statements.package.run(node.id, node.label, pathId(paths, packageDirectory(node)), pathId(paths, node.path), null);
	}
	if (node.kind === "PackageScript") {
		statements.packageScript.run(
			node.id,
			packageIdForScriptNode(node),
			node.label,
			stringMetadata(node, "command") ?? "",
			packageScriptRunCommand(packageIdForScriptNode(node), node.label),
			pathId(paths, node.path),
		);
	}
	if (node.kind === "Symbol") {
		statements.symbol.run(
			node.id,
			fileNodeIdForPath(node.path),
			node.label,
			stringMetadata(node, "symbolKind") ?? "unknown",
			boolMetadata(node, "exported") ? 1 : 0,
			firstEvidenceLine(node),
			firstEvidenceEndLine(node),
		);
	}
	if (isDbKind(node.kind)) {
		statements.dbFact.run(node.id, node.kind, schemaName(node.label), objectName(node.label), null, pathId(paths, node.path), firstEvidenceLine(node));
	}
	if (node.kind === "IaCModule" || node.kind === "IaCResource") {
		statements.iacFact.run(node.id, node.kind, stringMetadata(node, "resourceType") ?? null, node.label, pathId(paths, node.path), firstEvidenceLine(node));
	}
	if (node.kind === "Config") {
		statements.ciFact.run(
			node.id,
			node.kind,
			stringMetadata(node, "workflow") ?? null,
			stringMetadata(node, "jobId") ?? null,
			numberMetadata(node, "stepIndex"),
			stringMetadata(node, "taskKind") ?? null,
			stringMetadata(node, "command") ?? null,
			pathId(paths, node.path),
			firstEvidenceLine(node),
		);
	}
}

function insertTypedEdgeFact(
	statements: ReturnType<typeof prepareInsertStatements>,
	edge: CodeGraphEdge,
	nodesById: ReadonlyMap<string, CodeGraphNode>,
): void {
	if (edge.kind === "IMPORTS" || edge.kind === "TYPE_IMPORTS") {
		const target = nodesById.get(edge.to);
		statements.import.run(edge.from, edge.to, edge.label ?? "", edge.kind === "TYPE_IMPORTS" ? 1 : 0, target?.kind === "ExternalDependency" ? 1 : 0, firstEdgeLine(edge));
	}
	if (edge.kind === "USES_ENV") {
		const envNode = nodesById.get(edge.to);
		statements.envUse.run(edge.from, edge.to, envNode?.label ?? edge.label ?? edge.to, firstEdgeLine(edge));
	}
	if (edge.kind === "TESTS") {
		statements.testTarget.run(edge.from, edge.to, "heuristic", edge.label ?? null);
	}
}

function readManifest(db: Database): CodeGraphManifest {
	const row = db.query<{ value_json: string }, [string]>("SELECT value_json FROM manifest WHERE key = ?").get("manifest");
	if (row === null) throw new Error("graph.sqlite is missing manifest row");
	return JSON.parse(row.value_json) as CodeGraphManifest;
}

function readProvenanceClasses(db: Database): ReadonlyMap<number, ProvenanceClassRow> {
	return new Map(
		db.query<ProvenanceClassRow, []>("SELECT * FROM provenance_classes").all().map((row) => [row.id, row]),
	);
}

function readEvidenceMap(db: Database, ownerKind: "node" | "edge"): ReadonlyMap<string, readonly CodeGraphEvidence[]> {
	const table = ownerKind === "node" ? "node_evidence" : "edge_evidence";
	const ownerColumn = ownerKind === "node" ? "node_id" : "edge_id";
	const rows = db.query<EvidenceRow, []>(`
SELECT ${table}.${ownerColumn} AS owner_id, evidence.path, evidence.start_line, evidence.end_line, evidence.hash
FROM ${table}
JOIN evidence ON evidence.id = ${table}.evidence_id
ORDER BY ${table}.${ownerColumn}, evidence.id
`).all();
	const byOwner = new Map<string, CodeGraphEvidence[]>();
	for (const row of rows) {
		const evidence = evidenceFromRow(row);
		const ownerId = String(row.owner_id);
		const current = byOwner.get(ownerId) ?? [];
		current.push(evidence);
		byOwner.set(ownerId, current);
	}
	return byOwner;
}

function nodeFromRow(
	row: NodeRow,
	provenanceClasses: ReadonlyMap<number, ProvenanceClassRow>,
	evidence: ReadonlyMap<string, readonly CodeGraphEvidence[]>,
): CodeGraphNode {
	return {
		id: row.id,
		kind: row.kind,
		label: row.label,
		...(row.path === null ? {} : { path: row.path }),
		metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
		provenance: provenanceFromClass(provenanceClasses, row.provenance_class_id, evidence.get(row.id) ?? []),
	};
}

function edgeFromRow(
	row: EdgeRow,
	provenanceClasses: ReadonlyMap<number, ProvenanceClassRow>,
	evidence: ReadonlyMap<string, readonly CodeGraphEvidence[]>,
): CodeGraphEdge {
	return {
		id: row.edge_key,
		kind: row.kind,
		from: row.from_id,
		to: row.to_id,
		...(row.label === null ? {} : { label: row.label }),
		metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
		provenance: provenanceFromClass(provenanceClasses, row.provenance_class_id, evidence.get(String(row.id)) ?? []),
	};
}

function findingFromRow(row: FindingRow): CodeGraphFinding {
	return {
		id: row.id,
		severity: row.severity,
		message: row.message,
		...(row.node_id === null ? {} : { nodeId: row.node_id }),
		evidence: JSON.parse(row.evidence_json) as CodeGraphEvidence[],
	};
}

function provenanceFromClass(
	classes: ReadonlyMap<number, ProvenanceClassRow>,
	classId: number,
	evidence: readonly CodeGraphEvidence[],
): CodeGraphProvenance {
	const row = classes.get(classId);
	if (row === undefined) throw new Error(`missing provenance class ${classId}`);
	return {
		source: row.source,
		confidence: row.confidence,
		freshness: row.freshness,
		evidence,
		...(row.snapshot_commit === null ? {} : { snapshotCommit: row.snapshot_commit }),
		...(row.scanner_version === null ? {} : { scannerVersion: row.scanner_version }),
	};
}

function evidenceFromRow(row: EvidenceRow): CodeGraphEvidence {
	return {
		path: row.path,
		...(row.start_line === null ? {} : { startLine: row.start_line }),
		...(row.end_line === null ? {} : { endLine: row.end_line }),
		...(row.hash === null ? {} : { hash: row.hash }),
	};
}

function graphHash(graph: CodeGraphSnapshot): string {
	return createHash("sha256")
		.update(JSON.stringify({ manifest: graph.manifest, nodes: graph.nodes, edges: graph.edges, findings: graph.findings }))
		.digest("hex");
}

function requiredMapValue<K, V>(map: ReadonlyMap<K, V>, key: K): V {
	const value = map.get(key);
	if (value === undefined) throw new Error(`missing map value for ${String(key)}`);
	return value;
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function stringMetadata(node: CodeGraphNode | undefined, key: string): string | undefined {
	const value = node?.metadata[key];
	return typeof value === "string" ? value : undefined;
}

function numberMetadata(node: CodeGraphNode | undefined, key: string): number | null {
	const value = node?.metadata[key];
	return typeof value === "number" ? value : null;
}

function boolMetadata(node: CodeGraphNode | undefined, key: string): boolean | undefined {
	const value = node?.metadata[key];
	return typeof value === "boolean" ? value : undefined;
}

function firstEvidenceHash(node: CodeGraphNode | undefined): string | null {
	return node?.provenance.evidence.find((evidence) => evidence.hash !== undefined)?.hash ?? null;
}

function firstEvidenceLine(node: CodeGraphNode): number | null {
	return node.provenance.evidence.find((evidence) => evidence.startLine !== undefined)?.startLine ?? null;
}

function firstEvidenceEndLine(node: CodeGraphNode): number | null {
	return node.provenance.evidence.find((evidence) => evidence.endLine !== undefined)?.endLine ?? null;
}

function firstEdgeLine(edge: CodeGraphEdge): number | null {
	return edge.provenance.evidence.find((evidence) => evidence.startLine !== undefined)?.startLine ?? null;
}

function pathId(paths: ReadonlyMap<string, number>, path: string | undefined): number | null {
	return path === undefined ? null : paths.get(path) ?? null;
}

function packageDirectory(node: CodeGraphNode): string {
	return node.id.startsWith("package:") ? node.id.slice("package:".length) : ".";
}

function packageIdForScriptNode(node: CodeGraphNode): string {
	const suffix = node.id.slice("script:".length);
	const scriptSuffix = `:${node.label}`;
	const packageDir = suffix.endsWith(scriptSuffix) ? suffix.slice(0, -scriptSuffix.length) : ".";
	return `package:${packageDir}`;
}

function packageScriptRunCommand(packageId: string, scriptName: string): string {
	const command = `bun run ${shellPath(scriptName)}`;
	const packageDir = packageId.startsWith("package:") ? packageId.slice("package:".length) : ".";
	return packageDir === "." ? command : `cd ${shellPath(packageDir)} && ${command}`;
}

function fileNodeIdForPath(path: string | undefined): string {
	return path === undefined ? "file:<unknown>" : `file:${path}`;
}

function isDbKind(kind: CodeGraphNode["kind"]): boolean {
	return kind === "Migration" || kind === "DbTable" || kind === "DbFunction" || kind === "DbPolicy" || kind === "DbTrigger";
}

function schemaName(label: string): string | null {
	const [schema] = label.split(".");
	return label.includes(".") ? schema : null;
}

function objectName(label: string): string {
	return label.split(".").at(-1) ?? label;
}

function shellPath(path: string): string {
	return /^[A-Za-z0-9_./:-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}
