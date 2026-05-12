import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { HarnessError } from "../shared/errors.ts";
import { agentAnnotationSchema } from "./schema.ts";
import {
	auditAnnotationOverlay,
	parseAnnotationOverlay,
	type AnnotationOverlayAudit,
	type AnnotationOverlayLoadResult,
} from "./overlays.ts";
import type { AgentAnnotation, CodeGraphEvidence, CodeGraphNode, CodeGraphSnapshot } from "./types.ts";

export interface NotesIngestReport {
	readonly target?: string | undefined;
	readonly claims: readonly NotesIngestClaim[];
}

export interface NotesIngestClaim {
	readonly kind?: string | undefined;
	readonly summary: string;
	readonly target?: string | undefined;
	readonly targetNodeId?: string | undefined;
	readonly evidence: readonly NotesIngestEvidence[];
}

export interface NotesIngestEvidence {
	readonly path: string;
	readonly startLine?: number | undefined;
	readonly endLine?: number | undefined;
	readonly hash?: string | undefined;
}

export interface NotesIngestOptions {
	readonly outDir: string;
	readonly reportPath: string;
	readonly authorName?: string | undefined;
	readonly runId?: string | undefined;
	readonly now?: Date | undefined;
}

export interface NotesIngestResult {
	readonly notesPath: string;
	readonly ingestedCount: number;
	readonly skippedCount: number;
	readonly annotations: readonly AgentAnnotation[];
	readonly audit: AnnotationOverlayAudit;
}

export interface NoteReviewInput {
	readonly action: "accept" | "retire";
	readonly noteId: string;
	readonly reviewer: string;
	readonly now?: Date | undefined;
}

export interface NoteReviewResult {
	readonly notesPath: string;
	readonly action: "accept" | "retire";
	readonly noteId: string;
	readonly reviewer: string;
	readonly annotation: AgentAnnotation;
	readonly audit: AnnotationOverlayAudit;
}

export function notesJsonlPath(outDir: string): string {
	return join(outDir, "notes.jsonl");
}

export async function readNotesOverlay(outDir: string): Promise<AnnotationOverlayLoadResult> {
	const notesPath = notesJsonlPath(outDir);
	if (await Bun.file(notesPath).exists()) return parseAnnotationOverlay(await readFile(notesPath, "utf8"), notesPath);
	return { overlayPath: notesPath, annotations: [], parseIssues: [] };
}

export async function ingestNotesReport(
	graph: CodeGraphSnapshot,
	options: NotesIngestOptions,
): Promise<NotesIngestResult> {
	const report = parseIngestReport(JSON.parse(await readFile(options.reportPath, "utf8")) as unknown);
	const overlay = await readNotesOverlay(options.outDir);
	const now = options.now ?? new Date();
	const graphIndex = graphNodeIndex(graph);
	const incoming = report.claims.flatMap((claim) => annotationForClaim(claim, graphIndex, options, now));
	const annotations = dedupeAnnotations([...overlay.annotations, ...incoming]);
	await writeNotes(options.outDir, annotations);
	const nextOverlay = await readNotesOverlay(options.outDir);
	const audit = auditAnnotationOverlay(graph, nextOverlay);
	return {
		notesPath: nextOverlay.overlayPath,
		ingestedCount: incoming.length,
		skippedCount: report.claims.length - incoming.length,
		annotations: incoming,
		audit,
	};
}

export async function auditNotes(
	graph: CodeGraphSnapshot,
	outDir: string,
): Promise<AnnotationOverlayAudit> {
	return auditAnnotationOverlay(graph, await readNotesOverlay(outDir));
}

export async function reviewNote(
	graph: CodeGraphSnapshot,
	outDir: string,
	review: NoteReviewInput,
): Promise<NoteReviewResult> {
	const overlay = await readNotesOverlay(outDir);
	if (overlay.parseIssues.length > 0) {
		throw new HarnessError("VALIDATION_FAILED", "cannot rewrite notes while parse issues are present");
	}
	const audit = auditAnnotationOverlay(graph, overlay);
	const existing = overlay.annotations.find((annotation) => annotation.id === review.noteId);
	if (existing === undefined) throw new HarnessError("VALIDATION_FAILED", `note not found: ${review.noteId}`);
	const issues = audit.issues.filter((issue) => issue.annotationId === review.noteId);
	if (review.action === "accept" && issues.length > 0) {
		throw new HarnessError(
			"VALIDATION_FAILED",
			`cannot accept note with audit issues: ${issues.map((issue) => issue.code).join(", ")}`,
		);
	}
	const updated: AgentAnnotation = {
		...existing,
		author: { type: "human", name: review.reviewer },
		confidence: "human-reviewed",
		status: review.action === "accept" ? "accepted" : "retired",
		updatedAt: (review.now ?? new Date()).toISOString(),
	};
	await writeNotes(
		outDir,
		overlay.annotations.map((annotation) => (annotation.id === review.noteId ? updated : annotation)),
	);
	const nextAudit = await auditNotes(graph, outDir);
	return {
		notesPath: notesJsonlPath(outDir),
		action: review.action,
		noteId: review.noteId,
		reviewer: review.reviewer,
		annotation: updated,
		audit: nextAudit,
	};
}

export async function writeNotes(outDir: string, annotations: readonly AgentAnnotation[]): Promise<void> {
	await mkdir(outDir, { recursive: true });
	await writeFile(
		notesJsonlPath(outDir),
		annotations.length === 0 ? "" : `${annotations.map((annotation) => JSON.stringify(annotation)).join("\n")}\n`,
	);
}

function parseIngestReport(value: unknown): NotesIngestReport {
	if (!isRecord(value) || !Array.isArray(value["claims"])) {
		throw new HarnessError("VALIDATION_FAILED", "notes ingest report must be an object with a claims array");
	}
	return {
		target: typeof value["target"] === "string" ? value["target"] : undefined,
		claims: value["claims"].flatMap(parseIngestClaim),
	};
}

function parseIngestClaim(value: unknown): readonly NotesIngestClaim[] {
	if (!isRecord(value)) return [];
	if (typeof value["summary"] !== "string" || value["summary"].trim().length === 0) return [];
	if (!Array.isArray(value["evidence"])) return [];
	const evidence = value["evidence"].flatMap(parseIngestEvidence);
	if (evidence.length === 0) return [];
	return [
		{
			kind: typeof value["kind"] === "string" ? value["kind"] : undefined,
			summary: value["summary"],
			target: typeof value["target"] === "string" ? value["target"] : undefined,
			targetNodeId: typeof value["targetNodeId"] === "string" ? value["targetNodeId"] : undefined,
			evidence,
		},
	];
}

function parseIngestEvidence(value: unknown): readonly NotesIngestEvidence[] {
	if (!isRecord(value) || typeof value["path"] !== "string") return [];
	return [
		{
			path: value["path"],
			startLine: typeof value["startLine"] === "number" ? value["startLine"] : undefined,
			endLine: typeof value["endLine"] === "number" ? value["endLine"] : undefined,
			hash: typeof value["hash"] === "string" ? value["hash"] : undefined,
		},
	];
}

interface GraphNodeIndex {
	readonly nodesById: ReadonlyMap<string, CodeGraphNode>;
	readonly fileNodesByPath: ReadonlyMap<string, CodeGraphNode>;
	readonly hashesByPath: ReadonlyMap<string, string>;
}

function graphNodeIndex(graph: CodeGraphSnapshot): GraphNodeIndex {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const fileNodesByPath = new Map<string, CodeGraphNode>();
	const hashesByPath = new Map<string, string>();
	for (const node of graph.nodes) {
		if (node.path === undefined) continue;
		if (!fileNodesByPath.has(node.path) || preferredTargetNode(node, fileNodesByPath.get(node.path))) {
			fileNodesByPath.set(node.path, node);
		}
		const hash = node.provenance.evidence.find((item) => item.path === node.path && item.hash !== undefined)?.hash;
		if (hash !== undefined) hashesByPath.set(node.path, hash);
	}
	return { nodesById, fileNodesByPath, hashesByPath };
}

function preferredTargetNode(node: CodeGraphNode, current: CodeGraphNode | undefined): boolean {
	if (current === undefined) return true;
	return targetNodeRank(node.kind) > targetNodeRank(current.kind);
}

function targetNodeRank(kind: CodeGraphNode["kind"]): number {
	if (kind === "File" || kind === "Doc" || kind === "GeneratedArtifact" || kind === "Config") return 100;
	if (kind === "DirtyArtifact") return 80;
	if (kind === "Symbol") return 10;
	return 50;
}

function annotationForClaim(
	claim: NotesIngestClaim,
	index: GraphNodeIndex,
	options: NotesIngestOptions,
	now: Date,
): readonly AgentAnnotation[] {
	const targetNodeId = resolveClaimTarget(claim, index);
	if (targetNodeId === undefined) return [];
	const evidence = claim.evidence.map((item) => evidenceForClaim(item, index));
	const annotation = {
		id: noteId(targetNodeId, claim, evidence),
		targetNodeId,
		kind: noteKind(claim.kind),
		summary: claim.summary.trim(),
		evidence,
		author: {
			type: "agent",
			...(options.authorName === undefined ? {} : { name: options.authorName }),
			...(options.runId === undefined ? {} : { runId: options.runId }),
		},
		confidence: "agent-inferred",
		status: "candidate",
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	} satisfies AgentAnnotation;
	const parsed = agentAnnotationSchema.safeParse(annotation);
	return parsed.success ? [parsed.data] : [];
}

function resolveClaimTarget(claim: NotesIngestClaim, index: GraphNodeIndex): string | undefined {
	if (claim.targetNodeId !== undefined && index.nodesById.has(claim.targetNodeId)) return claim.targetNodeId;
	if (claim.target !== undefined && index.nodesById.has(claim.target)) return claim.target;
	const targetPath = pathFromTarget(claim.target) ?? claim.evidence[0]?.path;
	if (targetPath === undefined) return undefined;
	return index.fileNodesByPath.get(targetPath)?.id ?? (index.nodesById.has(`file:${targetPath}`) ? `file:${targetPath}` : undefined);
}

function pathFromTarget(target: string | undefined): string | undefined {
	if (target === undefined) return undefined;
	if (target.startsWith("path:")) return target.slice("path:".length);
	if (target.startsWith("file:")) return target.slice("file:".length);
	return undefined;
}

function evidenceForClaim(evidence: NotesIngestEvidence, index: GraphNodeIndex): CodeGraphEvidence {
	const hash = evidence.hash ?? index.hashesByPath.get(evidence.path);
	return {
		path: evidence.path,
		...(evidence.startLine === undefined ? {} : { startLine: evidence.startLine }),
		...(evidence.endLine === undefined ? {} : { endLine: evidence.endLine }),
		...(hash === undefined ? {} : { hash }),
	};
}

function noteKind(kind: string | undefined): AgentAnnotation["kind"] {
	const normalized = (kind ?? "workflow").toLowerCase();
	if (normalized.includes("test")) return "test-guidance";
	if (normalized.includes("generated")) return "generated-ownership";
	if (normalized.includes("iac") || normalized.includes("infra")) return "iac-link";
	if (normalized.includes("risk") || normalized.includes("warning")) return "risk";
	if (normalized.includes("invariant") || normalized.includes("retention")) return "invariant";
	if (normalized.includes("purpose")) return "purpose";
	if (normalized.includes("edit")) return "edit-warning";
	return "workflow";
}

function noteId(
	targetNodeId: string,
	claim: NotesIngestClaim,
	evidence: readonly CodeGraphEvidence[],
): string {
	const hash = createHash("sha256")
		.update(JSON.stringify({ targetNodeId, kind: claim.kind, summary: claim.summary, evidence }))
		.digest("hex")
		.slice(0, 16);
	return `note:${hash}`;
}

function dedupeAnnotations(annotations: readonly AgentAnnotation[]): readonly AgentAnnotation[] {
	const byId = new Map<string, AgentAnnotation>();
	for (const annotation of annotations) byId.set(annotation.id, annotation);
	return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
