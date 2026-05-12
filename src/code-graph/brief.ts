import { buildGraphContext, compactGraphContext, contextSelectorFor } from "./context.ts";
import { sliceGraph } from "./query.ts";
import type { AuditLedger, AuditValidationReceipt } from "./audit.ts";
import type {
	AnnotationNoteSummary,
	CodeGraphFinding,
	CodeGraphManifest,
	CodeGraphNode,
	CodeGraphSnapshot,
	GraphContextCompact,
	GraphContextSummary,
	GraphSlice,
	ValidationCommandSummary,
} from "./types.ts";

export type BriefMode = "planning" | "implementation" | "review" | "prd";
export type BriefFormat = "json" | "prompt";

export interface BuildBriefOptions {
	readonly mode?: BriefMode | undefined;
	readonly path?: string | undefined;
	readonly packageId?: string | undefined;
	readonly env?: string | undefined;
	readonly db?: string | undefined;
	readonly iac?: string | undefined;
	readonly audit?: string | undefined;
	readonly auditLedger?: AuditLedger | undefined;
	readonly changed?: boolean | undefined;
	readonly depth?: number | undefined;
	readonly requestedTokens?: number | undefined;
	readonly hardLimitTokens?: number | undefined;
	readonly live?: boolean | undefined;
	readonly limits?: Partial<BriefLimits> | undefined;
}

export interface BriefLimits {
	readonly primaryPaths: number;
	readonly impactPaths: number;
	readonly testPaths: number;
	readonly packages: number;
	readonly validationCommands: number;
	readonly notes: number;
	readonly findings: number;
}

export interface BriefPacket {
	readonly schemaVersion: "cartographer.brief.v1";
	readonly kind: "brief";
	readonly mode: BriefMode;
	readonly generatedAt: string;
	readonly snapshot: BriefSnapshot;
	readonly anchor: BriefAnchor;
	readonly budget: BriefBudget;
	readonly readFirst: readonly BriefPathRecord[];
	readonly impact: readonly BriefPathRecord[];
	readonly packages: readonly BriefPackageRecord[];
	readonly dependencies: readonly BriefDependencyRecord[];
	readonly surfaces: BriefSurfaces;
	readonly tests: readonly BriefTestRecord[];
	readonly validation: readonly BriefValidationRecord[];
	readonly audit?: BriefAuditContext | undefined;
	readonly notes: BriefNotes;
	readonly findings: readonly CodeGraphFinding[];
	readonly omissions: readonly BriefOmission[];
	readonly instructions: BriefInstructions;
}

export interface BriefSnapshot {
	readonly root: string;
	readonly commit?: string | undefined;
	readonly dirty: boolean;
	readonly generatedAt: string;
	readonly live: boolean;
	readonly scannerVersion: string;
	readonly freshness: "fresh" | "fresh-with-dirty-worktree" | "persisted" | "unknown";
	readonly totals: CodeGraphManifest["totals"];
}

export interface BriefAnchor {
	readonly type: "path" | "package" | "env" | "db" | "iac" | "audit" | "changed";
	readonly value: string;
	readonly selector: string;
	readonly resolved: readonly BriefResolvedAnchor[];
}

export interface BriefResolvedAnchor {
	readonly nodeId: string;
	readonly kind: CodeGraphNode["kind"];
	readonly path?: string | undefined;
	readonly label: string;
	readonly confidence: "exact" | "heuristic";
}

export interface BriefBudget {
	readonly requestedTokens: number;
	readonly estimatedTokens: number;
	readonly hardLimitTokens: number;
	readonly truncated: boolean;
}

export interface BriefPathRecord {
	readonly rank: number;
	readonly path: string;
	readonly nodeId?: string | undefined;
	readonly kind?: CodeGraphNode["kind"] | undefined;
	readonly reason: string;
	readonly relationship: string;
	readonly depth: number;
	readonly confidence: "exact" | "parser-backed" | "heuristic";
	readonly evidence: readonly BriefEvidence[];
}

export interface BriefPackageRecord {
	readonly packageId: string;
	readonly name: string;
	readonly directory: string;
	readonly rank: number;
	readonly reason: string;
	readonly directPathCount: number;
	readonly omittedPathCount: number;
	readonly scriptIds: readonly string[];
}

export interface BriefDependencyRecord {
	readonly name: string;
	readonly kind: "external";
	readonly relationship: string;
	readonly paths: readonly string[];
}

export interface BriefSurfaces {
	readonly env: readonly BriefSurfaceRecord[];
	readonly db: readonly BriefSurfaceRecord[];
	readonly iac: readonly BriefSurfaceRecord[];
	readonly ci: readonly BriefSurfaceRecord[];
	readonly docs: readonly BriefSurfaceRecord[];
}

export interface BriefSurfaceRecord {
	readonly nodeId: string;
	readonly kind: CodeGraphNode["kind"];
	readonly label: string;
	readonly path?: string | undefined;
	readonly reason: string;
}

export interface BriefTestRecord {
	readonly path: string;
	readonly targetPath?: string | undefined;
	readonly confidence: "exact-import" | "heuristic";
	readonly reason: string;
}

export interface BriefValidationRecord {
	readonly rank: number;
	readonly command: string;
	readonly cwd: string;
	readonly source?: string | undefined;
	readonly safety: "safe" | "review";
	readonly reason: string;
}

export interface BriefAuditContext {
	readonly id: string;
	readonly kind: AuditLedger["kind"];
	readonly target: string;
	readonly status: AuditLedger["verdict"]["status"];
	readonly blockers: readonly string[];
	readonly classes: readonly BriefAuditClassRecord[];
	readonly replacementRequirements: readonly BriefAuditReplacementRecord[];
	readonly evidencePaths: readonly string[];
}

export interface BriefAuditClassRecord {
	readonly class: string;
	readonly status: string;
	readonly activeCount: number;
	readonly retainedCount: number;
	readonly unknownCount: number;
	readonly summary: string;
}

export interface BriefAuditReplacementRecord {
	readonly surface: string;
	readonly expectedReplacement: string;
	readonly status: string;
}

export interface BriefNotes {
	readonly accepted: readonly AnnotationNoteSummary[];
	readonly stale: readonly AnnotationNoteSummary[];
}

export interface BriefOmission {
	readonly section: string;
	readonly omittedCount: number;
	readonly reason: "budget" | "limit";
	readonly nextCommand?: string | undefined;
}

export interface BriefInstructions {
	readonly sourceReadRequired: true;
	readonly summary: string;
}

export interface BriefEvidence {
	readonly path: string;
	readonly startLine?: number | undefined;
	readonly endLine?: number | undefined;
}

interface BriefSource {
	readonly selector: string;
	readonly anchor: Omit<BriefAnchor, "resolved">;
	readonly summary: GraphContextSummary;
	readonly auditLedger?: AuditLedger | undefined;
	readonly compact?: GraphContextCompact | undefined;
	readonly slice?: GraphSlice | undefined;
}

export function buildBrief(graph: CodeGraphSnapshot, options: BuildBriefOptions): BriefPacket {
	const mode = options.mode ?? "implementation";
	const limits = briefLimits(options.limits);
	const source = briefSource(graph, options);
	const resolved = resolveAnchor(graph, source.anchor.selector);
	const packetWithoutBudget = packetForSource(graph, mode, source, resolved, limits, options);
	const estimatedTokens = estimateTokens(JSON.stringify(packetWithoutBudget));
	const budget: BriefBudget = {
		requestedTokens: options.requestedTokens ?? 8_000,
		estimatedTokens,
		hardLimitTokens: options.hardLimitTokens ?? 24_000,
		truncated: packetWithoutBudget.omissions.length > 0 || estimatedTokens > (options.requestedTokens ?? 8_000),
	};
	return { ...packetWithoutBudget, budget };
}

export function renderBriefPrompt(packet: BriefPacket): string {
	return [
		"# Cartographer Brief",
		"",
		"## Snapshot",
		`- Root: \`${packet.snapshot.root}\``,
		`- Commit: ${packet.snapshot.commit ?? "unknown"}`,
		`- Worktree: ${packet.snapshot.dirty ? "dirty" : "clean"}`,
		`- Mode: ${packet.mode}`,
		`- Freshness: ${packet.snapshot.freshness}`,
		`- Budget: ${packet.budget.estimatedTokens} / ${packet.budget.requestedTokens} estimated tokens`,
		"",
		"## Anchor",
		`- ${packet.anchor.type}: \`${packet.anchor.value}\``,
		`- selector: \`${packet.anchor.selector}\``,
		"",
		"## Read First",
		...renderRankedPaths(packet.readFirst),
		"",
		"## Impact",
		...renderRankedPaths(packet.impact),
		"",
		"## Package Context",
		...renderPackages(packet.packages),
		"",
		"## Tests",
		...renderTests(packet.tests),
		"",
		"## Validation Commands",
		...renderValidation(packet.validation),
		"",
		"## Audit Context",
		...renderAudit(packet.audit),
		"",
		"## Notes",
		...renderNotes(packet.notes),
		"",
		"## Findings And Omissions",
		...renderFindingsAndOmissions(packet),
		"",
		"## Required Agent Behavior",
		packet.instructions.summary,
		"",
	].join("\n");
}

function packetForSource(
	graph: CodeGraphSnapshot,
	mode: BriefMode,
	source: BriefSource,
	resolved: readonly BriefResolvedAnchor[],
	limits: BriefLimits,
	options: BuildBriefOptions,
): Omit<BriefPacket, "budget"> {
	const summary = source.summary;
	const readFirst = pathRecords(graph, primaryPathsForSource(source, summary), limits.primaryPaths, "primary graph path", "primary", 0);
	const impact = pathRecords(graph, summary.impactPaths, limits.impactPaths, "impacted graph path", "impact", 1);
	const tests = testRecords(summary.testPaths, limits.testPaths, source.anchor.value);
	const validation = validationRecords(summary.validationCommands, limits.validationCommands);
	const notes = noteRecords(summary.annotationNotes, limits.notes);
	const findings = summary.findings.slice(0, limits.findings);
	const audit = source.auditLedger === undefined ? undefined : auditContext(source.auditLedger);
	return {
		schemaVersion: "cartographer.brief.v1",
		kind: "brief",
		mode,
		generatedAt: new Date().toISOString(),
		snapshot: snapshotFor(graph.manifest, options),
		anchor: { ...source.anchor, resolved },
		readFirst,
		impact,
		packages: packageRecords(summary, limits.packages),
		dependencies: dependencyRecords(source.slice),
		surfaces: surfaceRecords(source.slice),
		tests,
		validation,
		...(audit === undefined ? {} : { audit }),
		notes,
		findings,
		omissions: omissionsFor(summary, limits, { readFirst, impact, tests, validation, notes, findings }, source),
		instructions: {
			sourceReadRequired: true,
			summary: "Use this for orientation. Verify implementation-sensitive claims with direct source reads before editing or making final claims.",
		},
	};
}

function primaryPathsForSource(source: BriefSource, summary: GraphContextSummary): readonly string[] {
	if (source.anchor.type !== "path") return summary.primaryPaths;
	const anchorPath = source.anchor.value.replace(/^path:/, "");
	return uniqueStringsInOrder([anchorPath, ...summary.primaryPaths]);
}

function briefSource(graph: CodeGraphSnapshot, options: BuildBriefOptions): BriefSource {
	if (options.path !== undefined) return pathBriefSource(graph, options.path, options.depth ?? 1);
	if (options.packageId !== undefined) return selectorBriefSource(graph, "package", options.packageId, `package:${options.packageId}`);
	if (options.env !== undefined) return selectorBriefSource(graph, "env", options.env, `env:${options.env}`);
	if (options.db !== undefined) return selectorBriefSource(graph, "db", options.db, dbSelector(options.db));
	if (options.iac !== undefined) return selectorBriefSource(graph, "iac", options.iac, iacSelector(options.iac));
	if (options.auditLedger !== undefined) return auditBriefSource(graph, options.auditLedger, options.audit ?? options.auditLedger.id);
	if (options.audit !== undefined) return selectorBriefSource(graph, "audit", options.audit, `audit:${options.audit}`);
	if (options.changed === true) return selectorBriefSource(graph, "changed", "changed", "dirty:");
	return pathBriefSource(graph, "package.json", options.depth ?? 1);
}

function pathBriefSource(graph: CodeGraphSnapshot, path: string, depth: number): BriefSource {
	const context = buildGraphContext(graph, { path, selector: contextSelectorFor(path), depth });
	const compact = compactGraphContext(context);
	return {
		selector: compact.selector,
		anchor: { type: "path", value: path, selector: compact.selector },
		summary: compact.summary,
		compact,
		slice: context.slice,
	};
}

function selectorBriefSource(
	graph: CodeGraphSnapshot,
	type: BriefAnchor["type"],
	value: string,
	selector: string,
): BriefSource {
	const slice = sliceGraph(graph, selector);
	const summary = slice.summary ?? {
		primaryPaths: [],
		impactPaths: [],
		testPaths: [],
		affectedPackages: [],
		validationCommands: [],
		annotationNotes: [],
		findings: slice.findings,
	};
	return {
		selector,
		anchor: { type, value, selector },
		summary: {
			...summary,
			primaryPaths: pathsForSlice(slice),
			impactPaths: [],
			testPaths: testPathsForSlice(slice),
			findings: slice.findings,
		},
		slice,
	};
}

function auditBriefSource(graph: CodeGraphSnapshot, ledger: AuditLedger, value: string): BriefSource {
	const paths = auditEvidencePaths(ledger);
	return {
		selector: `audit:${ledger.id}`,
		anchor: { type: "audit", value, selector: `audit:${ledger.id}` },
		summary: {
			primaryPaths: paths,
			impactPaths: [],
			testPaths: auditEvidencePathsForClasses(ledger, new Set(["test", "mock", "fixture"])),
			affectedPackages: packageSummariesForPaths(graph, paths),
			validationCommands: validationCommandsForLedger(ledger),
			annotationNotes: [],
			findings: findingsForLedger(ledger),
		},
		auditLedger: ledger,
	};
}

function dbSelector(value: string): string {
	if (value.startsWith("db")) return value;
	return value.includes("(") ? `dbfunction:${value}` : `dbtable:${value}`;
}

function iacSelector(value: string): string {
	return value.startsWith("iac") ? value : `iacresource:${value}`;
}

function resolveAnchor(graph: CodeGraphSnapshot, selector: string): readonly BriefResolvedAnchor[] {
	if (selector.startsWith("audit:")) return [];
	const prefixValue = selectorValue(selector);
	const matches = graph.nodes.filter((node) => nodeMatchesSelector(node, selector, prefixValue));
	return matches.slice(0, 10).map((node) => ({
		nodeId: node.id,
		kind: node.kind,
		...(node.path === undefined ? {} : { path: node.path }),
		label: node.label,
		confidence: "exact",
	}));
}

function nodeMatchesSelector(node: CodeGraphNode, selector: string, prefixValue: string | undefined): boolean {
	if (node.id === selector || node.path === selector || `path:${node.path ?? ""}` === selector) return true;
	if (selector.startsWith("path:")) return node.path === selector.slice("path:".length);
	if (selector.startsWith("package:")) return node.id === selector || node.label === prefixValue;
	if (selector.startsWith("env:")) return node.id === selector || node.label === prefixValue;
	if (selector.startsWith("dirty:")) return node.kind === "DirtyArtifact";
	return node.id === selector || node.label === prefixValue;
}

function selectorValue(selector: string): string | undefined {
	const index = selector.indexOf(":");
	return index < 0 ? undefined : selector.slice(index + 1);
}

function snapshotFor(manifest: CodeGraphManifest, options: BuildBriefOptions): BriefSnapshot {
	const live = options.live === true;
	return {
		root: manifest.root,
		...(manifest.git.commit === undefined ? {} : { commit: manifest.git.commit }),
		dirty: manifest.git.dirty,
		generatedAt: manifest.generatedAt,
		live,
		scannerVersion: manifest.scanner.version,
		freshness: manifest.git.dirty ? "fresh-with-dirty-worktree" : live ? "fresh" : "persisted",
		totals: manifest.totals,
	};
}

function pathRecords(
	graph: CodeGraphSnapshot,
	paths: readonly string[],
	limit: number,
	reason: string,
	relationship: string,
	depth: number,
): readonly BriefPathRecord[] {
	const nodesByPath = preferredNodesByPath(graph.nodes);
	return paths.slice(0, limit).map((path, index) => {
		const node = nodesByPath.get(path);
		return {
			rank: index + 1,
			path,
			...(node === undefined ? {} : { nodeId: node.id, kind: node.kind }),
			reason,
			relationship,
			depth,
			confidence: index === 0 && relationship === "primary" ? "exact" : "heuristic",
			evidence: [{ path }],
		};
	});
}

function preferredNodesByPath(nodes: readonly CodeGraphNode[]): ReadonlyMap<string, CodeGraphNode> {
	const byPath = new Map<string, CodeGraphNode>();
	for (const node of nodes) {
		if (node.path === undefined) continue;
		const current = byPath.get(node.path);
		if (current === undefined || pathNodeRank(node.kind) > pathNodeRank(current.kind)) byPath.set(node.path, node);
	}
	return byPath;
}

function pathNodeRank(kind: CodeGraphNode["kind"]): number {
	if (kind === "File" || kind === "Doc" || kind === "GeneratedArtifact" || kind === "Config") return 100;
	if (kind === "DirtyArtifact") return 80;
	if (kind === "Symbol") return 10;
	return 50;
}

function pathsForSlice(slice: GraphSlice): readonly string[] {
	return uniqueStrings(slice.nodes.flatMap((node) => (node.path === undefined ? [] : [node.path])));
}

function testPathsForSlice(slice: GraphSlice): readonly string[] {
	const nodeById = new Map(slice.nodes.map((node) => [node.id, node]));
	return uniqueStrings(
		slice.edges.flatMap((edge) => (edge.kind === "TESTS" ? nodeById.get(edge.to)?.path ?? [] : [])),
	);
}

function testRecords(paths: readonly string[], limit: number, targetPath?: string): readonly BriefTestRecord[] {
	return paths.slice(0, limit).map((path) => ({
		path,
		...(targetPath === undefined ? {} : { targetPath }),
		confidence: "heuristic",
		reason: "graph test relationship or naming convention",
	}));
}

function validationRecords(
	commands: readonly ValidationCommandSummary[],
	limit: number,
): readonly BriefValidationRecord[] {
	return commands.slice(0, limit).map((command, index) => ({
		rank: index + 1,
		command: command.runCommand ?? command.command ?? command.name,
		cwd: ".",
		...(command.path === undefined ? {} : { source: command.path }),
		safety: safeValidationCommand(command) ? "safe" : "review",
		reason: command.name.startsWith("test:") ? "focused test for graph context" : "package validation command",
	}));
}

function validationCommandsForLedger(ledger: AuditLedger): readonly ValidationCommandSummary[] {
	return ledger.validation.map((receipt, index) => validationCommandForReceipt(ledger.id, receipt, index));
}

function validationCommandForReceipt(
	ledgerId: string,
	receipt: AuditValidationReceipt,
	index: number,
): ValidationCommandSummary {
	return {
		packageId: `audit:${ledgerId}`,
		scriptId: `audit:${ledgerId}:validation:${index}`,
		name: receipt.command,
		command: receipt.command,
		runCommand: receipt.command,
	};
}

function safeValidationCommand(command: ValidationCommandSummary): boolean {
	const text = `${command.name} ${command.command ?? ""} ${command.runCommand ?? ""}`.toLowerCase();
	return !/(deploy|apply|reset|seed|start|dev|preview|postinstall)/.test(text);
}

function packageRecords(summary: GraphContextSummary, limit: number): readonly BriefPackageRecord[] {
	return summary.affectedPackages.slice(0, limit).map((item) => ({
		packageId: item.packageId,
		name: item.label,
		directory: item.directory,
		rank: item.rank,
		reason: "owns or contains selected graph context",
		directPathCount: item.directNodeCount,
		omittedPathCount: item.ancestorNodeCount,
		scriptIds: item.scriptIds,
	}));
}

function packageSummariesForPaths(
	graph: CodeGraphSnapshot,
	paths: readonly string[],
): GraphContextSummary["affectedPackages"] {
	const packages = graph.nodes.filter((node) => node.kind === "Package");
	const drafts = new Map<string, { readonly node: CodeGraphNode; directNodeCount: number; ancestorNodeCount: number; readonly scriptIds: Set<string> }>();
	for (const path of paths) {
		const owners = packageOwnersForPath(packages, path);
		for (const [index, owner] of owners.entries()) {
			const draft = drafts.get(owner.id) ?? {
				node: owner,
				directNodeCount: 0,
				ancestorNodeCount: 0,
				scriptIds: packageScriptIds(graph, owner),
			};
			if (index === 0) draft.directNodeCount += 1;
			else draft.ancestorNodeCount += 1;
			drafts.set(owner.id, draft);
		}
	}
	return [...drafts.values()]
		.toSorted((left, right) => right.directNodeCount - left.directNodeCount || packageDirForNode(left.node).localeCompare(packageDirForNode(right.node)))
		.map((draft, index) => ({
			packageId: draft.node.id,
			label: draft.node.label,
			directory: packageDirForNode(draft.node),
			path: draft.node.path,
			rank: index + 1,
			directNodeCount: draft.directNodeCount,
			ancestorNodeCount: draft.ancestorNodeCount,
			scriptIds: [...draft.scriptIds],
		}));
}

function packageOwnersForPath(packages: readonly CodeGraphNode[], path: string): readonly CodeGraphNode[] {
	return packages
		.filter((node) => pathBelongsToPackage(path, packageDirForNode(node)))
		.toSorted((left, right) => packageDirForNode(right).length - packageDirForNode(left).length);
}

function pathBelongsToPackage(path: string, packageDir: string): boolean {
	return packageDir === "." ? true : path === packageDir || path.startsWith(`${packageDir}/`);
}

function packageDirForNode(node: CodeGraphNode): string {
	if (!node.id.startsWith("package:")) return ".";
	const dir = node.id.slice("package:".length);
	return dir.length === 0 ? "." : dir;
}

function packageScriptIds(graph: CodeGraphSnapshot, packageNode: CodeGraphNode): Set<string> {
	const packageDir = packageDirForNode(packageNode);
	const scriptPrefix = `script:${packageDir}:`;
	return new Set(
		graph.nodes
			.filter((node) => node.kind === "PackageScript" && node.id.startsWith(scriptPrefix))
			.filter((node) => /^(build|check|ci|e2e|fuzz|integration|lint|test|typecheck|unit|validate|verify)(:|$)/i.test(node.label))
			.map((node) => node.id),
	);
}

function dependencyRecords(slice: GraphSlice | undefined): readonly BriefDependencyRecord[] {
	if (slice === undefined) return [];
	const externalNodes = slice.nodes.filter((node) => node.kind === "ExternalDependency");
	return externalNodes.slice(0, 20).map((node) => ({
		name: node.label,
		kind: "external",
		relationship: "referenced by selected graph context",
		paths: uniqueStrings(slice.edges.flatMap((edge) => edge.to === node.id ? sourcePathForEdge(slice, edge.from) : [])),
	}));
}

function surfaceRecords(slice: GraphSlice | undefined): BriefSurfaces {
	const nodes = slice?.nodes ?? [];
	return {
		env: nodes.filter((node) => node.kind === "EnvVar").slice(0, 20).map(surfaceRecord("env var in selected context")),
		db: nodes.filter((node) => node.kind.startsWith("Db") || node.kind === "Migration").slice(0, 20).map(surfaceRecord("database surface in selected context")),
		iac: nodes.filter((node) => node.kind === "IaCModule" || node.kind === "IaCResource").slice(0, 20).map(surfaceRecord("IaC surface in selected context")),
		ci: nodes.filter((node) => node.kind === "Config").slice(0, 20).map(surfaceRecord("configuration surface in selected context")),
		docs: nodes.filter((node) => node.kind === "Doc").slice(0, 20).map(surfaceRecord("documentation surface in selected context")),
	};
}

function surfaceRecord(reason: string): (node: CodeGraphNode) => BriefSurfaceRecord {
	return (node) => ({
		nodeId: node.id,
		kind: node.kind,
		label: node.label,
		...(node.path === undefined ? {} : { path: node.path }),
		reason,
	});
}

function noteRecords(notes: readonly AnnotationNoteSummary[], limit: number): BriefNotes {
	return {
		accepted: notes.filter((note) => note.status === "accepted").slice(0, limit),
		stale: notes.filter((note) => note.status === "stale").slice(0, limit),
	};
}

function auditContext(ledger: AuditLedger): BriefAuditContext {
	return {
		id: ledger.id,
		kind: ledger.kind,
		target: ledger.target.raw,
		status: ledger.verdict.status,
		blockers: ledger.verdict.blockers,
		classes: ledger.classes.map((classEntry) => ({
			class: classEntry.class,
			status: classEntry.status,
			activeCount: classEntry.active.length,
			retainedCount: classEntry.retained.length,
			unknownCount: classEntry.unknown.length,
			summary: classEntry.summary,
		})),
		replacementRequirements: ledger.replacementRequirements.map((requirement) => ({
			surface: requirement.surface,
			expectedReplacement: requirement.expectedReplacement,
			status: requirement.status,
		})),
		evidencePaths: auditEvidencePaths(ledger),
	};
}

function auditEvidencePaths(ledger: AuditLedger): readonly string[] {
	return uniqueStringsInOrder(
		ledger.classes.flatMap((classEntry) => [
			...classEntry.active.map((evidence) => evidence.path),
			...classEntry.unknown.map((evidence) => evidence.path),
			...classEntry.retained.map((retention) => retention.path),
		]),
	);
}

function auditEvidencePathsForClasses(ledger: AuditLedger, classes: ReadonlySet<string>): readonly string[] {
	return uniqueStringsInOrder(
		ledger.classes
			.filter((classEntry) => classes.has(classEntry.class))
			.flatMap((classEntry) => classEntry.active.map((evidence) => evidence.path)),
	);
}

function findingsForLedger(ledger: AuditLedger): readonly CodeGraphFinding[] {
	return ledger.verdict.blockers.map((blocker, index) => ({
		id: `audit:${ledger.id}:blocker:${index}`,
		severity: ledger.verdict.status === "failed" ? "error" : "warn",
		message: blocker,
		evidence: [],
	}));
}

function omissionsFor(
	summary: GraphContextSummary,
	limits: BriefLimits,
	emitted: {
		readonly readFirst: readonly unknown[];
		readonly impact: readonly unknown[];
		readonly tests: readonly unknown[];
		readonly validation: readonly unknown[];
		readonly notes: BriefNotes;
		readonly findings: readonly unknown[];
	},
	source: BriefSource,
): readonly BriefOmission[] {
	return [
		omission("readFirst", summary.primaryPaths.length, emitted.readFirst.length, source),
		omission("impact", summary.impactPaths.length, emitted.impact.length, source),
		omission("tests", summary.testPaths.length, emitted.tests.length, source),
		omission("validation", summary.validationCommands.length, emitted.validation.length, source),
		omission("notes", summary.annotationNotes.length, emitted.notes.accepted.length + emitted.notes.stale.length, source),
		omission("findings", summary.findings.length, emitted.findings.length, source),
	].filter((item): item is BriefOmission => item !== undefined);
}

function omission(section: string, total: number, emitted: number, source: BriefSource): BriefOmission | undefined {
	const omittedCount = Math.max(0, total - emitted);
	if (omittedCount === 0) return undefined;
	return {
		section,
		omittedCount,
		reason: "limit",
		nextCommand: `cartographer brief --selector ${shellToken(source.selector)} --section ${shellToken(section)} --limit ${total}`,
	};
}

function briefLimits(overrides: Partial<BriefLimits> | undefined): BriefLimits {
	return {
		primaryPaths: overrides?.primaryPaths ?? 15,
		impactPaths: overrides?.impactPaths ?? 25,
		testPaths: overrides?.testPaths ?? 20,
		packages: overrides?.packages ?? 10,
		validationCommands: overrides?.validationCommands ?? 12,
		notes: overrides?.notes ?? 10,
		findings: overrides?.findings ?? 20,
	};
}

function sourcePathForEdge(slice: GraphSlice, nodeId: string): readonly string[] {
	const node = slice.nodes.find((candidate) => candidate.id === nodeId);
	return node?.path === undefined ? [] : [node.path];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort();
}

function uniqueStringsInOrder(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}

function estimateTokens(value: string): number {
	return Math.ceil(Array.from(value).length / 4);
}

function renderRankedPaths(paths: readonly BriefPathRecord[]): readonly string[] {
	if (paths.length === 0) return ["- None"];
	return paths.map((item) => `${item.rank}. \`${item.path}\` - ${item.reason}`);
}

function renderPackages(packages: readonly BriefPackageRecord[]): readonly string[] {
	if (packages.length === 0) return ["- None"];
	return packages.map((item) => `${item.rank}. ${item.packageId} - ${item.reason}`);
}

function renderTests(tests: readonly BriefTestRecord[]): readonly string[] {
	if (tests.length === 0) return ["- None"];
	return tests.map((item, index) => `${index + 1}. \`${item.path}\` - ${item.reason}`);
}

function renderValidation(validation: readonly BriefValidationRecord[]): readonly string[] {
	if (validation.length === 0) return ["- None"];
	return validation.map((item) => `${item.rank}. \`${item.command}\` - ${item.reason}`);
}

function renderAudit(audit: BriefAuditContext | undefined): readonly string[] {
	if (audit === undefined) return ["- None"];
	return [
		`- Ledger: \`${audit.id}\``,
		`- Target: \`${audit.target}\``,
		`- Status: ${audit.status}`,
		`- Evidence paths: ${audit.evidencePaths.length}`,
		...(audit.blockers.length === 0 ? ["- Blockers: none"] : audit.blockers.map((blocker) => `- Blocker: ${blocker}`)),
		...audit.classes
			.filter((classEntry) => classEntry.activeCount > 0 || classEntry.retainedCount > 0 || classEntry.unknownCount > 0)
			.slice(0, 20)
			.map(
				(classEntry) =>
					`- ${classEntry.class}: ${classEntry.status}; active=${classEntry.activeCount}; retained=${classEntry.retainedCount}; unknown=${classEntry.unknownCount}`,
			),
	];
}

function renderNotes(notes: BriefNotes): readonly string[] {
	const accepted = notes.accepted.map((note) => `- Accepted ${note.kind}: ${note.summary}`);
	const stale = notes.stale.map((note) => `- Stale ${note.kind}: ${note.summary}`);
	return accepted.length + stale.length === 0 ? ["- None"] : [...accepted, ...stale];
}

function renderFindingsAndOmissions(packet: BriefPacket): readonly string[] {
	const findings = packet.findings.map((finding) => `- ${finding.severity}: ${finding.message}`);
	const omissions = packet.omissions.map((item) => `- Omitted ${item.omittedCount} from ${item.section}: ${item.reason}`);
	return findings.length + omissions.length === 0 ? ["- None"] : [...findings, ...omissions];
}

function shellToken(value: string): string {
	return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
