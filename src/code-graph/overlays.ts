import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { agentAnnotationSchema } from "./schema.ts";
import type { AgentAnnotation, CodeGraphEvidence, CodeGraphFinding, CodeGraphSnapshot } from "./types.ts";

export interface AnnotationOverlayLoadResult {
	readonly overlayPath: string;
	readonly annotations: readonly AgentAnnotation[];
	readonly parseIssues: readonly AnnotationOverlayParseIssue[];
}

export interface AnnotationOverlayParseIssue {
	readonly line: number;
	readonly code: "json-invalid" | "schema-invalid";
	readonly message: string;
}

export interface AnnotationOverlayAudit {
	readonly overlayPath: string;
	readonly summary: AnnotationOverlayAuditSummary;
	readonly issues: readonly AnnotationOverlayIssue[];
	readonly parseIssues: readonly AnnotationOverlayParseIssue[];
}

export interface AnnotationOverlayAuditSummary {
	readonly totalAnnotations: number;
	readonly candidateCount: number;
	readonly acceptedCount: number;
	readonly staleCount: number;
	readonly retiredCount: number;
	readonly reviewReadyCandidateCount: number;
	readonly usableAcceptedCount: number;
	readonly staleRecommendedCount: number;
	readonly issueCount: number;
	readonly parseIssueCount: number;
}

export interface AnnotationOverlayIssue {
	readonly annotationId: string;
	readonly severity: "warn" | "error";
	readonly code:
		| "duplicate-id"
		| "target-missing"
		| "target-evidence-missing"
		| "evidence-missing"
		| "evidence-hash-mismatch";
	readonly message: string;
	readonly path?: string | undefined;
}

export async function readAnnotationOverlay(outDir: string): Promise<AnnotationOverlayLoadResult> {
	const notesPath = join(outDir, "notes.jsonl");
	if (await Bun.file(notesPath).exists()) return parseAnnotationOverlay(await readFile(notesPath, "utf8"), notesPath);
	const overlayPath = join(outDir, "overlays", "agent-notes.jsonl");
	if (await Bun.file(overlayPath).exists()) return parseAnnotationOverlay(await readFile(overlayPath, "utf8"), overlayPath);
	return { overlayPath: notesPath, annotations: [], parseIssues: [] };
}

export function parseAnnotationOverlay(raw: string, overlayPath: string): AnnotationOverlayLoadResult {
	const annotations: AgentAnnotation[] = [];
	const parseIssues: AnnotationOverlayParseIssue[] = [];
	for (const [lineIndex, line] of raw.split(/\r?\n/).entries()) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const parsed = parseJsonLine(trimmed, lineIndex + 1);
		if (!parsed.ok) {
			parseIssues.push(parsed.issue);
			continue;
		}
		const validation = agentAnnotationSchema.safeParse(parsed.value);
		if (!validation.success) {
			parseIssues.push({
				line: lineIndex + 1,
				code: "schema-invalid",
				message: zodIssueSummary(validation.error),
			});
			continue;
		}
		annotations.push(validation.data);
	}
	return { overlayPath, annotations, parseIssues };
}

export function auditAnnotationOverlay(
	graph: CodeGraphSnapshot,
	overlay: AnnotationOverlayLoadResult,
): AnnotationOverlayAudit {
	const targetNodeIds = new Set(graph.nodes.map((node) => node.id));
	const evidenceIndex = graphEvidenceIndex(graph);
	const duplicateIds = duplicateAnnotationIds(overlay.annotations);
	const issues = overlay.annotations.flatMap((annotation) => [
		...duplicateAnnotationIssues(annotation, duplicateIds),
		...annotationIssues(annotation, targetNodeIds, evidenceIndex),
	]);
	const annotationIdsWithIssues = new Set(issues.map((issue) => issue.annotationId));
	return {
		overlayPath: overlay.overlayPath,
		summary: annotationAuditSummary(overlay.annotations, annotationIdsWithIssues, issues, overlay.parseIssues),
		issues,
		parseIssues: overlay.parseIssues,
	};
}

export function graphWithAnnotationOverlay(
	graph: CodeGraphSnapshot,
	overlay: AnnotationOverlayLoadResult,
): CodeGraphSnapshot {
	if (overlay.annotations.length === 0 && overlay.parseIssues.length === 0) return graph;
	const audit = auditAnnotationOverlay(graph, overlay);
	const annotations = new Map(graph.annotations.map((annotation) => [annotation.id, annotation]));
	const issueIds = new Set(audit.issues.map((issue) => issue.annotationId));
	for (const annotation of overlay.annotations)
		annotations.set(annotation.id, annotationForGraph(annotation, issueIds));
	return {
		...graph,
		annotations: [...annotations.values()],
		findings: [...graph.findings, ...overlayFindings(audit, overlay)],
	};
}

export function renderAnnotationOverlayAudit(audit: AnnotationOverlayAudit): string {
	return [
		"Annotation overlay audit",
		"",
		`Overlay: ${audit.overlayPath}`,
		`Annotations: ${audit.summary.totalAnnotations}`,
		`Candidates: ${audit.summary.candidateCount}`,
		`Accepted: ${audit.summary.acceptedCount}`,
		`Stale: ${audit.summary.staleCount}`,
		`Retired: ${audit.summary.retiredCount}`,
		`Review-ready candidates: ${audit.summary.reviewReadyCandidateCount}`,
		`Usable accepted notes: ${audit.summary.usableAcceptedCount}`,
		`Stale recommended: ${audit.summary.staleRecommendedCount}`,
		`Issues: ${audit.summary.issueCount}`,
		`Parse issues: ${audit.summary.parseIssueCount}`,
		"",
		"Overlay issues:",
		...renderIssueList(audit.issues),
		"",
		"Parse issues:",
		...renderParseIssueList(audit.parseIssues),
		"",
	].join("\n");
}

interface JsonParseResult {
	readonly ok: true;
	readonly value: unknown;
}

interface JsonParseFailure {
	readonly ok: false;
	readonly issue: AnnotationOverlayParseIssue;
}

function parseJsonLine(line: string, lineNumber: number): JsonParseResult | JsonParseFailure {
	try {
		return { ok: true, value: JSON.parse(line) as unknown };
	} catch (cause) {
		return {
			ok: false,
			issue: {
				line: lineNumber,
				code: "json-invalid",
				message: cause instanceof Error ? cause.message : "invalid JSON line",
			},
		};
	}
}

function zodIssueSummary(error: z.ZodError): string {
	return error.issues
		.slice(0, 3)
		.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
		.join("; ");
}

interface GraphEvidenceIndex {
	readonly paths: ReadonlySet<string>;
	readonly hashesByPath: ReadonlyMap<string, ReadonlySet<string>>;
	readonly targetEvidencePathsByNodeId: ReadonlyMap<string, ReadonlySet<string>>;
}

function graphEvidenceIndex(graph: CodeGraphSnapshot): GraphEvidenceIndex {
	const paths = new Set<string>();
	const hashesByPath = new Map<string, Set<string>>();
	const targetEvidencePathsByNodeId = new Map<string, Set<string>>();
	for (const node of graph.nodes) {
		const targetEvidencePaths = new Set<string>();
		if (node.path !== undefined) paths.add(node.path);
		if (node.path !== undefined) targetEvidencePaths.add(node.path);
		recordEvidence(node.provenance.evidence, paths, hashesByPath);
		for (const evidence of node.provenance.evidence) targetEvidencePaths.add(evidence.path);
		targetEvidencePathsByNodeId.set(node.id, targetEvidencePaths);
	}
	for (const edge of graph.edges) recordEvidence(edge.provenance.evidence, paths, hashesByPath);
	for (const finding of graph.findings) recordEvidence(finding.evidence, paths, hashesByPath);
	for (const annotation of graph.annotations) recordEvidence(annotation.evidence, paths, hashesByPath);
	return { paths, hashesByPath, targetEvidencePathsByNodeId };
}

function recordEvidence(
	evidenceItems: readonly CodeGraphEvidence[],
	paths: Set<string>,
	hashesByPath: Map<string, Set<string>>,
): void {
	for (const evidence of evidenceItems) {
		paths.add(evidence.path);
		if (evidence.hash === undefined) continue;
		let hashes = hashesByPath.get(evidence.path);
		if (hashes === undefined) {
			hashes = new Set();
			hashesByPath.set(evidence.path, hashes);
		}
		hashes.add(evidence.hash);
	}
}

function annotationIssues(
	annotation: AgentAnnotation,
	targetNodeIds: ReadonlySet<string>,
	evidenceIndex: GraphEvidenceIndex,
): readonly AnnotationOverlayIssue[] {
	const issues: AnnotationOverlayIssue[] = [];
	if (!targetNodeIds.has(annotation.targetNodeId)) {
		issues.push({
			annotationId: annotation.id,
			severity: "error",
			code: "target-missing",
			message: `Target node is not in the current graph: ${annotation.targetNodeId}`,
		});
	}
	const targetEvidenceIssue = targetEvidenceAnchorIssue(annotation, evidenceIndex);
	if (targetEvidenceIssue !== undefined) issues.push(targetEvidenceIssue);
	for (const evidence of annotation.evidence) {
		if (!evidenceIndex.paths.has(evidence.path)) {
			issues.push({
				annotationId: annotation.id,
				severity: "error",
				code: "evidence-missing",
				path: evidence.path,
				message: `Evidence path is not in the current graph: ${evidence.path}`,
			});
			continue;
		}
		if (evidence.hash !== undefined && evidenceHashChanged(evidence, evidenceIndex)) {
			issues.push({
				annotationId: annotation.id,
				severity: "warn",
				code: "evidence-hash-mismatch",
				path: evidence.path,
				message: `Evidence hash changed for ${evidence.path}`,
			});
		}
	}
	return issues;
}

function targetEvidenceAnchorIssue(
	annotation: AgentAnnotation,
	evidenceIndex: GraphEvidenceIndex,
): AnnotationOverlayIssue | undefined {
	const targetEvidencePaths = evidenceIndex.targetEvidencePathsByNodeId.get(annotation.targetNodeId);
	if (targetEvidencePaths === undefined || targetEvidencePaths.size === 0) return undefined;
	if (annotation.evidence.some((evidence) => targetEvidencePaths.has(evidence.path))) return undefined;
	return {
		annotationId: annotation.id,
		severity: "error",
		code: "target-evidence-missing",
		message: `Annotation evidence does not anchor to target node evidence: ${annotation.targetNodeId}`,
	};
}

function duplicateAnnotationIds(annotations: readonly AgentAnnotation[]): ReadonlySet<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const annotation of annotations) {
		if (seen.has(annotation.id)) duplicates.add(annotation.id);
		seen.add(annotation.id);
	}
	return duplicates;
}

function duplicateAnnotationIssues(
	annotation: AgentAnnotation,
	duplicateIds: ReadonlySet<string>,
): readonly AnnotationOverlayIssue[] {
	return duplicateIds.has(annotation.id)
		? [
				{
					annotationId: annotation.id,
					severity: "error",
					code: "duplicate-id",
					message: `Annotation id appears more than once: ${annotation.id}`,
				},
			]
		: [];
}

function evidenceHashChanged(evidence: CodeGraphEvidence, evidenceIndex: GraphEvidenceIndex): boolean {
	const currentHashes = evidenceIndex.hashesByPath.get(evidence.path);
	return currentHashes !== undefined && currentHashes.size > 0 && !currentHashes.has(evidence.hash ?? "");
}

function annotationAuditSummary(
	annotations: readonly AgentAnnotation[],
	annotationIdsWithIssues: ReadonlySet<string>,
	issues: readonly AnnotationOverlayIssue[],
	parseIssues: readonly AnnotationOverlayParseIssue[],
): AnnotationOverlayAuditSummary {
	return {
		totalAnnotations: annotations.length,
		candidateCount: annotations.filter((annotation) => annotation.status === "candidate").length,
		acceptedCount: annotations.filter((annotation) => annotation.status === "accepted").length,
		staleCount: annotations.filter((annotation) => annotation.status === "stale").length,
		retiredCount: annotations.filter((annotation) => annotation.status === "retired").length,
		reviewReadyCandidateCount: annotations.filter(
			(annotation) => annotation.status === "candidate" && !annotationIdsWithIssues.has(annotation.id),
		).length,
		usableAcceptedCount: annotations.filter(
			(annotation) => annotation.status === "accepted" && !annotationIdsWithIssues.has(annotation.id),
		).length,
		staleRecommendedCount: annotations.filter(
			(annotation) =>
				(annotation.status === "candidate" || annotation.status === "accepted") &&
				annotationIdsWithIssues.has(annotation.id),
		).length,
		issueCount: issues.length,
		parseIssueCount: parseIssues.length,
	};
}

function annotationForGraph(annotation: AgentAnnotation, issueIds: ReadonlySet<string>): AgentAnnotation {
	return annotation.status === "accepted" && issueIds.has(annotation.id)
		? { ...annotation, status: "stale" }
		: annotation;
}

function overlayFindings(
	audit: AnnotationOverlayAudit,
	overlay: AnnotationOverlayLoadResult,
): readonly CodeGraphFinding[] {
	const annotationsById = new Map(overlay.annotations.map((annotation) => [annotation.id, annotation]));
	return [
		...audit.issues.flatMap((issue) => overlayIssueFinding(issue, annotationsById.get(issue.annotationId))),
		...audit.parseIssues.map((issue) => overlayParseFinding(audit.overlayPath, issue)),
	];
}

function overlayIssueFinding(
	issue: AnnotationOverlayIssue,
	annotation: AgentAnnotation | undefined,
): readonly CodeGraphFinding[] {
	if (!isVisibleOverlayIssue(annotation)) return [];
	const nodeId = overlayIssueNodeId(issue, annotation);
	return [
		{
			id: `finding:annotation-overlay:${issue.code}:${issue.annotationId}:${issue.path ?? ""}`,
			severity: issue.severity,
			message: issue.message,
			...(nodeId !== undefined ? { nodeId } : {}),
			evidence: overlayIssueEvidence(issue),
		},
	];
}

const visibleIssueAnnotationStatuses = new Set<AgentAnnotation["status"]>(["accepted", "stale"]);

function isVisibleOverlayIssue(annotation: AgentAnnotation | undefined): boolean {
	return annotation === undefined || visibleIssueAnnotationStatuses.has(annotation.status);
}

function overlayIssueNodeId(
	issue: AnnotationOverlayIssue,
	annotation: AgentAnnotation | undefined,
): string | undefined {
	if (annotation === undefined) return undefined;
	if (issue.code === "target-missing") return undefined;
	return annotation.targetNodeId;
}

function overlayIssueEvidence(issue: AnnotationOverlayIssue): CodeGraphEvidence[] {
	return issue.path === undefined ? [] : [{ path: issue.path }];
}

function overlayParseFinding(overlayPath: string, issue: AnnotationOverlayParseIssue): CodeGraphFinding {
	return {
		id: `finding:annotation-overlay:parse:${issue.line}:${issue.code}`,
		severity: "warn",
		message: `Annotation overlay line ${issue.line} is invalid: ${issue.message}`,
		evidence: [{ path: overlayPath, startLine: issue.line, endLine: issue.line }],
	};
}

function renderIssueList(issues: readonly AnnotationOverlayIssue[]): readonly string[] {
	if (issues.length === 0) return ["- none"];
	return issues.map((issue) => {
		const path = issue.path === undefined ? "" : ` (${issue.path})`;
		return `- ${issue.severity} ${issue.code}: ${issue.annotationId}${path} - ${issue.message}`;
	});
}

function renderParseIssueList(issues: readonly AnnotationOverlayParseIssue[]): readonly string[] {
	if (issues.length === 0) return ["- none"];
	return issues.map((issue) => `- line ${issue.line} ${issue.code}: ${issue.message}`);
}
