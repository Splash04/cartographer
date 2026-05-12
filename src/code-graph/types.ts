export const CODE_GRAPH_SCHEMA_VERSION = "cartographer.code-graph.v1";

export type CodeGraphNodeKind =
	| "RepoSnapshot"
	| "Workspace"
	| "Package"
	| "PackageScript"
	| "File"
	| "Directory"
	| "Symbol"
	| "Entrypoint"
	| "Route"
	| "Test"
	| "Doc"
	| "GeneratedArtifact"
	| "Config"
	| "EnvVar"
	| "BoundaryPolicy"
	| "Finding"
	| "AgentAnnotation"
	| "ExternalDependency"
	| "Migration"
	| "DbTable"
	| "DbFunction"
	| "DbPolicy"
	| "DbTrigger"
	| "IaCModule"
	| "IaCResource"
	| "DirtyArtifact";

export type CodeGraphEdgeKind =
	| "CONTAINS"
	| "DEFINES"
	| "IMPORTS"
	| "TYPE_IMPORTS"
	| "EXPORTS"
	| "REFERENCES"
	| "CALLS"
	| "ROUTES_TO"
	| "TESTS"
	| "DOCUMENTS"
	| "GENERATED_BY"
	| "USES_ENV"
	| "CONFIGURES"
	| "SERVICE_QUERIES_TABLE"
	| "SERVICE_CALLS_RPC"
	| "TABLE_REFERENCES_TABLE"
	| "DEPENDS_ON"
	| "TASK_DEPENDS_ON"
	| "AFFECTS"
	| "OWNED_BY"
	| "GUARDED_BY"
	| "STALE_BECAUSE"
	| "ANNOTATES"
	| "MIGRATION_CREATES"
	| "MIGRATION_ALTERS"
	| "MIGRATION_DROPS"
	| "MIGRATION_SUPERSEDES"
	| "RESOURCE_DEPENDS_ON";

export type CodeGraphSource =
	| "filesystem"
	| "git"
	| "package-manager"
	| "syntax"
	| "typescript"
	| "fallow"
	| "iac-parser"
	| "sql-parser"
	| "doc-parser"
	| "agent-annotation"
	| "human-review";

export type CodeGraphConfidence = "deterministic" | "compiler-backed" | "agent-inferred" | "human-reviewed";
export type CodeGraphFreshness = "fresh" | "dirty" | "stale" | "unknown";

export interface CodeGraphEvidence {
	readonly path: string;
	readonly startLine?: number | undefined;
	readonly endLine?: number | undefined;
	readonly hash?: string | undefined;
}

export interface CodeGraphProvenance {
	readonly source: CodeGraphSource;
	readonly evidence: readonly CodeGraphEvidence[];
	readonly confidence: CodeGraphConfidence;
	readonly freshness: CodeGraphFreshness;
	readonly snapshotCommit?: string | undefined;
	readonly scannerVersion?: string | undefined;
}

export interface CodeGraphNode {
	readonly id: string;
	readonly kind: CodeGraphNodeKind;
	readonly label: string;
	readonly path?: string | undefined;
	readonly metadata: Record<string, unknown>;
	readonly provenance: CodeGraphProvenance;
}

export interface CodeGraphEdge {
	readonly id: string;
	readonly kind: CodeGraphEdgeKind;
	readonly from: string;
	readonly to: string;
	readonly label?: string | undefined;
	readonly metadata: Record<string, unknown>;
	readonly provenance: CodeGraphProvenance;
}

export interface CodeGraphFinding {
	readonly id: string;
	readonly severity: "info" | "warn" | "error";
	readonly message: string;
	readonly nodeId?: string | undefined;
	readonly evidence: readonly CodeGraphEvidence[];
}

export interface AgentAnnotation {
	readonly id: string;
	readonly targetNodeId: string;
	readonly kind:
		| "purpose"
		| "invariant"
		| "edit-warning"
		| "workflow"
		| "test-guidance"
		| "generated-ownership"
		| "iac-link"
		| "risk";
	readonly summary: string;
	readonly evidence: readonly CodeGraphEvidence[];
	readonly author: {
		readonly type: "agent" | "human";
		readonly name?: string | undefined;
		readonly runId?: string | undefined;
	};
	readonly confidence: "agent-inferred" | "human-reviewed";
	readonly status: "candidate" | "accepted" | "stale" | "retired";
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface CodeGraphManifest {
	readonly schemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION;
	readonly root: string;
	readonly generatedAt: string;
	readonly scanner: {
		readonly name: "cartographer";
		readonly version: string;
	};
	readonly git: {
		readonly commit?: string | undefined;
		readonly dirty: boolean;
		readonly trackedFiles: number;
		readonly untrackedFiles: number;
		readonly modifiedFiles: number;
		readonly deletedFiles: number;
	};
	readonly totals: {
		readonly files: number;
		readonly packages: number;
		readonly nodes: number;
		readonly edges: number;
		readonly findings: number;
	};
	readonly ignorePatterns: readonly string[];
}

export interface CodeGraphSnapshot {
	readonly schemaVersion: typeof CODE_GRAPH_SCHEMA_VERSION;
	readonly manifest: CodeGraphManifest;
	readonly nodes: readonly CodeGraphNode[];
	readonly edges: readonly CodeGraphEdge[];
	readonly findings: readonly CodeGraphFinding[];
	readonly annotations: readonly AgentAnnotation[];
}

export interface BuildCodeGraphOptions {
	readonly root: string;
	readonly maxFileBytes?: number | undefined;
	readonly now?: Date | undefined;
}

export interface GraphSlice {
	readonly selector: string;
	readonly title: string;
	readonly nodes: readonly CodeGraphNode[];
	readonly edges: readonly CodeGraphEdge[];
	readonly findings: readonly CodeGraphFinding[];
	readonly annotations: readonly AgentAnnotation[];
	readonly summary?: GraphSliceSummary | undefined;
}

export interface GraphSliceSummary {
	readonly affectedPackages: readonly AffectedPackageSummary[];
	readonly validationCommands: readonly ValidationCommandSummary[];
	readonly annotationNotes: readonly AnnotationNoteSummary[];
}

export interface GraphContext {
	readonly path: string;
	readonly selector: string;
	readonly depth?: number | undefined;
	readonly manifest: CodeGraphManifest;
	readonly summary: GraphContextSummary;
	readonly slice: GraphSlice;
	readonly impact: GraphSlice;
}

export interface GraphContextCompact {
	readonly path: string;
	readonly selector: string;
	readonly depth?: number | undefined;
	readonly manifest: CodeGraphManifest;
	readonly summary: GraphContextSummary;
	readonly totals: GraphContextTotals;
	readonly omissions: GraphContextOmissions;
	readonly limits: GraphContextLimits;
}

export interface GraphContextOmissions {
	readonly validationCommands: number;
}

export interface GraphContextLimits {
	readonly validationCommands: number;
}

export interface GraphContextTotals {
	readonly slice: GraphContextGraphTotals;
	readonly impact: GraphContextGraphTotals;
}

export interface GraphContextGraphTotals {
	readonly nodes: number;
	readonly edges: number;
	readonly findings: number;
}

export interface GraphContextSummary {
	readonly primaryPaths: readonly string[];
	readonly impactPaths: readonly string[];
	readonly testPaths: readonly string[];
	readonly affectedPackages: readonly AffectedPackageSummary[];
	readonly validationCommands: readonly ValidationCommandSummary[];
	readonly annotationNotes: readonly AnnotationNoteSummary[];
	readonly findings: readonly CodeGraphFinding[];
}

export interface AnnotationNoteSummary {
	readonly id: string;
	readonly targetNodeId: string;
	readonly kind: AgentAnnotation["kind"];
	readonly status: AgentAnnotation["status"];
	readonly confidence: AgentAnnotation["confidence"];
	readonly summary: string;
	readonly evidencePaths: readonly string[];
}

export interface AffectedPackageSummary {
	readonly packageId: string;
	readonly label: string;
	readonly directory: string;
	readonly path?: string | undefined;
	readonly rank: number;
	readonly directNodeCount: number;
	readonly ancestorNodeCount: number;
	readonly scriptIds: readonly string[];
}

export interface ValidationCommandSummary {
	readonly packageId: string;
	readonly scriptId: string;
	readonly name: string;
	readonly command?: string | undefined;
	readonly runCommand?: string | undefined;
	readonly path?: string | undefined;
}

export interface WriteCodeGraphOptions {
	readonly outDir: string;
	readonly mapPath?: string | undefined;
}
