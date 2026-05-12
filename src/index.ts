export { buildCodeGraph } from "./code-graph/builder.ts";
export { runCartographer } from "./code-graph/commands.ts";
export { buildRemovalAudit, readAuditLedger, renderAuditLedgerMarkdown, verifyRemovalAudit, writeAuditLedger } from "./code-graph/audit.ts";
export { buildBrief, renderBriefPrompt } from "./code-graph/brief.ts";
export { buildGraphContext, compactGraphContext, contextSelectorFor } from "./code-graph/context.ts";
export { readCodeGraph, renderMap, writeCodeGraphArtifacts, writeDebugJsonGraph, writeJsonlGraphExports } from "./code-graph/artifacts.ts";
export { impactGraph, renderSlice, sliceGraph, summarizeGraph } from "./code-graph/query.ts";
export { runCartographerPreflight } from "./code-graph/preflight.ts";
export { auditNotes, ingestNotesReport, notesJsonlPath, readNotesOverlay, reviewNote, writeNotes } from "./code-graph/notes.ts";
export {
	analyzeGraphCommandAdoption,
	checkGraphFirstAdoption,
	checkTraceExpectations,
	finalResponseText,
	isCartographerPreflightCommand,
	isSourceReadCommand,
} from "./code-graph/adoption.ts";
export type {
	GraphCommandAdoptionSummary,
	GraphFirstAdoptionCheck,
	GraphPreflightTimingSummary,
	TraceExpectedCommandEvidence,
	TraceExpectedPathEvidence,
	TraceExpectationCheck,
	TraceExpectationInput,
	TraceExpectationMetrics,
} from "./code-graph/adoption.ts";
export type { CartographerPreflightInput, CartographerPreflightResult } from "./code-graph/preflight.ts";
export { annotateSliceWithOpenRouter, DEFAULT_OPENROUTER_MODEL } from "./code-graph/openrouter.ts";
export {
	agentAnnotationSchema,
	codeGraphEvidenceSchema,
	codeGraphJsonSchema,
	codeGraphSnapshotSchema,
} from "./code-graph/schema.ts";
export {
	auditAnnotationOverlay,
	graphWithAnnotationOverlay,
	parseAnnotationOverlay,
	readAnnotationOverlay,
	renderAnnotationOverlayAudit,
} from "./code-graph/overlays.ts";
export type {
	AuditClassStatus,
	AuditEvidence,
	AuditEvidenceClass,
	AuditLedger,
	AuditLedgerKind,
	AuditLedgerStatus,
	AuditReplacementRequirement,
	AuditRetention,
	AuditTarget,
	AuditValidationReceipt,
	AuditVerdict,
	RemovalEvidenceClass,
} from "./code-graph/audit.ts";
export type {
	BriefAnchor,
	BriefBudget,
	BriefFormat,
	BriefMode,
	BriefOmission,
	BriefPacket,
	BriefPathRecord,
	BriefResolvedAnchor,
	BuildBriefOptions,
} from "./code-graph/brief.ts";
export type {
	NoteReviewInput,
	NoteReviewResult,
	NotesIngestClaim,
	NotesIngestOptions,
	NotesIngestReport,
	NotesIngestResult,
} from "./code-graph/notes.ts";
export type {
	AnnotationOverlayAudit,
	AnnotationOverlayAuditSummary,
	AnnotationOverlayIssue,
	AnnotationOverlayLoadResult,
	AnnotationOverlayParseIssue,
} from "./code-graph/overlays.ts";
export type {
	AgentAnnotation,
	AffectedPackageSummary,
	AnnotationNoteSummary,
	BuildCodeGraphOptions,
	CodeGraphEdge,
	CodeGraphEdgeKind,
	CodeGraphEvidence,
	CodeGraphFinding,
	CodeGraphManifest,
	CodeGraphNode,
	CodeGraphNodeKind,
	CodeGraphProvenance,
	CodeGraphSnapshot,
	GraphContext,
	GraphContextCompact,
	GraphContextGraphTotals,
	GraphContextSummary,
	GraphContextTotals,
	GraphSlice,
	GraphSliceSummary,
	ValidationCommandSummary,
	WriteCodeGraphOptions,
} from "./code-graph/types.ts";
