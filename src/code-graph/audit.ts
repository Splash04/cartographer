import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { CodeGraphManifest, CodeGraphNode, CodeGraphSnapshot } from "./types.ts";

export const AUDIT_LEDGER_SCHEMA_VERSION = "cartographer.audit-ledger.v1";

export type AuditLedgerKind = "removal";
export type AuditLedgerStatus =
	| "passed"
	| "needs-review"
	| "failed";

export type AuditClassStatus =
	| "not-found"
	| "found"
	| "removed"
	| "replaced"
	| "intentional-retention"
	| "needs-human-review"
	| "unknown";

export interface RemovalAuditOptions {
	readonly target: string;
	readonly id?: string | undefined;
	readonly expectedAuthReplacement?: string | undefined;
	readonly expectedDbReplacement?: string | undefined;
	readonly now?: Date | undefined;
}

export interface AuditVerifyOptions {
	readonly failOnLeftovers?: boolean | undefined;
	readonly now?: Date | undefined;
}

export interface AuditLedger {
	readonly schemaVersion: typeof AUDIT_LEDGER_SCHEMA_VERSION;
	readonly id: string;
	readonly kind: AuditLedgerKind;
	readonly target: AuditTarget;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly snapshot: AuditSnapshot;
	readonly verdict: AuditVerdict;
	readonly classes: readonly AuditEvidenceClass[];
	readonly replacementRequirements: readonly AuditReplacementRequirement[];
	readonly validation: readonly AuditValidationReceipt[];
	readonly exceptions: readonly AuditRetention[];
}

export interface AuditTarget {
	readonly raw: string;
	readonly matchers: readonly string[];
}

export interface AuditSnapshot {
	readonly root: string;
	readonly graphHash: string;
	readonly commit?: string | undefined;
	readonly dirty: boolean;
	readonly generatedAt: string;
}

export interface AuditVerdict {
	readonly status: AuditLedgerStatus;
	readonly blockers: readonly string[];
}

export interface AuditEvidenceClass {
	readonly class: RemovalEvidenceClass;
	readonly status: AuditClassStatus;
	readonly summary: string;
	readonly active: readonly AuditEvidence[];
	readonly removed: readonly AuditEvidence[];
	readonly retained: readonly AuditRetention[];
	readonly unknown: readonly AuditEvidence[];
	readonly omitted: AuditOmission;
	readonly verification: AuditVerification;
}

export interface AuditEvidence {
	readonly path: string;
	readonly lineStart: number;
	readonly lineEnd: number;
	readonly match: string;
	readonly evidenceKind: RemovalEvidenceClass;
}

export interface AuditRetention {
	readonly path: string;
	readonly lineStart?: number | undefined;
	readonly lineEnd?: number | undefined;
	readonly match?: string | undefined;
	readonly reason: string;
	readonly approvedBy?: string | undefined;
}

export interface AuditOmission {
	readonly count: number;
	readonly reason: string | null;
}

export interface AuditVerification {
	readonly checkedAt: string;
	readonly method: "graph+literal-search";
	readonly query: string;
	readonly resultCount: number;
}

export interface AuditReplacementRequirement {
	readonly surface: "auth" | "database";
	readonly expectedReplacement: string;
	readonly status: "needs-review" | "validated" | "not-applicable";
	readonly evidence: readonly AuditEvidence[];
}

export interface AuditValidationReceipt {
	readonly command: string;
	readonly cwd: string;
	readonly status: "not-run" | "passed" | "failed" | "skipped";
	readonly safety: "safe" | "review";
	readonly reason: string;
}

export type RemovalEvidenceClass =
	| "package-dependency"
	| "lockfile-reference"
	| "import-or-sdk-client"
	| "client-wrapper"
	| "env-var"
	| "ci-secret-name"
	| "deploy-config"
	| "sql-migration"
	| "rls-policy"
	| "db-function"
	| "db-trigger"
	| "storage-bucket"
	| "edge-function"
	| "generated-db-type"
	| "auth-user-model"
	| "test"
	| "mock"
	| "fixture"
	| "docs-active"
	| "docs-historical"
	| "unknown-literal-hit"
	| "replacement-auth"
	| "replacement-db"
	| "validation";

const removalEvidenceClasses: readonly RemovalEvidenceClass[] = [
	"package-dependency",
	"lockfile-reference",
	"import-or-sdk-client",
	"client-wrapper",
	"env-var",
	"ci-secret-name",
	"deploy-config",
	"sql-migration",
	"rls-policy",
	"db-function",
	"db-trigger",
	"storage-bucket",
	"edge-function",
	"generated-db-type",
	"auth-user-model",
	"test",
	"mock",
	"fixture",
	"docs-active",
	"docs-historical",
	"unknown-literal-hit",
	"replacement-auth",
	"replacement-db",
	"validation",
];

interface TargetMatcher {
	readonly label: string;
	readonly regex: RegExp;
}

interface FileHit {
	readonly path: string;
	readonly line: number;
	readonly lineText: string;
	readonly match: string;
}

export async function buildRemovalAudit(
	graph: CodeGraphSnapshot,
	options: RemovalAuditOptions,
): Promise<AuditLedger> {
	const now = options.now ?? new Date();
	const checkedAt = now.toISOString();
	const target = auditTarget(options.target);
	const hits = await literalHits(graph, target);
	const hitsByClass = classedHits(hits, target.raw);
	const classes = removalEvidenceClasses.map((className) =>
		auditClass(className, hitsByClass.get(className) ?? [], checkedAt, target.raw, []),
	);
	const blockers = blockersFor(classes);
	return {
		schemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
		id: options.id ?? `${slug(target.raw)}-removal`,
		kind: "removal",
		target,
		createdAt: checkedAt,
		updatedAt: checkedAt,
		snapshot: auditSnapshot(graph.manifest),
		verdict: {
			status: blockers.length === 0 ? "passed" : "needs-review",
			blockers,
		},
		classes,
		replacementRequirements: [
			{
				surface: "auth",
				expectedReplacement: options.expectedAuthReplacement ?? "replacement auth provider",
				status: "needs-review",
				evidence: [],
			},
			{
				surface: "database",
				expectedReplacement: options.expectedDbReplacement ?? "replacement database provider",
				status: "needs-review",
				evidence: [],
			},
		],
		validation: validationReceipts(graph),
		exceptions: [],
	};
}

export async function verifyRemovalAudit(
	graph: CodeGraphSnapshot,
	ledger: AuditLedger,
	options: AuditVerifyOptions = {},
): Promise<AuditLedger> {
	const now = options.now ?? new Date();
	const fresh = await buildRemovalAudit(graph, {
		target: ledger.target.raw,
		id: ledger.id,
		expectedAuthReplacement: replacementFor(ledger, "auth"),
		expectedDbReplacement: replacementFor(ledger, "database"),
		now,
	});
	const retentions = retentionsByClass(ledger);
	const classes = fresh.classes.map((classEntry) => {
		const retained = retentions.get(classEntry.class) ?? [];
		const active = classEntry.active.filter((evidence) => !isRetained(evidence, retained));
		const status = statusForVerifiedClass(classEntry.class, active, retained);
		return {
			...classEntry,
			active,
			retained,
			status,
			summary: summaryForClass(classEntry.class, active, retained),
		};
	});
	const blockers = blockersFor(classes);
	const failed = options.failOnLeftovers === true && blockers.length > 0;
	return {
		...fresh,
		createdAt: ledger.createdAt,
		updatedAt: now.toISOString(),
		classes,
		validation: mergeValidation(ledger.validation, fresh.validation),
		exceptions: ledger.exceptions,
		verdict: {
			status: failed ? "failed" : blockers.length === 0 ? "passed" : "needs-review",
			blockers,
		},
	};
}

export async function readAuditLedger(path: string): Promise<AuditLedger> {
	const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
	if (!isAuditLedger(parsed)) throw new Error(`not a Cartographer audit ledger: ${path}`);
	return parsed;
}

export async function writeAuditLedger(path: string, ledger: AuditLedger): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

export function renderAuditLedgerMarkdown(ledger: AuditLedger): string {
	return [
		`# Cartographer ${ledger.kind} audit: ${ledger.target.raw}`,
		"",
		`- Ledger: \`${ledger.id}\``,
		`- Status: ${ledger.verdict.status}`,
		`- Root: \`${ledger.snapshot.root}\``,
		`- Commit: ${ledger.snapshot.commit ?? "unknown"}`,
		`- Worktree: ${ledger.snapshot.dirty ? "dirty" : "clean"}`,
		"",
		"## Blockers",
		...(ledger.verdict.blockers.length === 0 ? ["- None"] : ledger.verdict.blockers.map((blocker) => `- ${blocker}`)),
		"",
		"## Evidence Classes",
		...ledger.classes.map(
			(classEntry) =>
				`- ${classEntry.class}: ${classEntry.status}; active=${classEntry.active.length}; retained=${classEntry.retained.length}; ${classEntry.summary}`,
		),
		"",
		"## Active Evidence",
		...renderActiveEvidence(ledger),
		"",
		"## Validation",
		...ledger.validation.map((item) => `- ${item.status}: \`${item.command}\` - ${item.reason}`),
		"",
	].join("\n");
}

function auditTarget(raw: string): AuditTarget {
	const normalized = raw.trim();
	if (normalized.length === 0) throw new Error("--target must not be empty");
	const upper = normalized.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	const matchers = uniqueStrings([
		normalized,
		`@${normalized}/*`,
		`${upper}_*`,
		...(normalized.toLowerCase() === "supabase" ? ["auth.uid", "storage.objects", "supabase/functions"] : []),
	]);
	return { raw: normalized, matchers };
}

function targetMatchers(target: AuditTarget): readonly TargetMatcher[] {
	const escaped = escapeRegex(target.raw);
	const upper = target.raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return [
		{ label: target.raw, regex: new RegExp(escaped, "gi") },
		{ label: `@${target.raw}/*`, regex: new RegExp(`@${escaped}/[A-Za-z0-9_.-]+`, "gi") },
		{ label: `${upper}_*`, regex: new RegExp(`\\b${escapeRegex(upper)}_[A-Z0-9_]+\\b`, "g") },
		...(target.raw.toLowerCase() === "supabase"
			? [
					{ label: "auth.uid", regex: /\bauth\.uid\b/gi },
					{ label: "storage.objects", regex: /\bstorage\.objects\b/gi },
					{ label: "supabase/functions", regex: /\bsupabase\/functions\b/gi },
				]
			: []),
	];
}

async function literalHits(graph: CodeGraphSnapshot, target: AuditTarget): Promise<readonly FileHit[]> {
	const matchers = targetMatchers(target);
	const paths = graphSearchPaths(graph);
	const hits: FileHit[] = [];
	const seen = new Set<string>();
	for (const path of paths) {
		const text = await safeReadGraphPath(graph.manifest.root, path);
		if (text === undefined) continue;
		for (const hit of hitsForFile(path, text, matchers)) {
			const key = `${hit.path}:${hit.line}:${hit.match}`;
			if (seen.has(key)) continue;
			seen.add(key);
			hits.push(hit);
		}
	}
	return hits.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
}

function graphSearchPaths(graph: CodeGraphSnapshot): readonly string[] {
	const paths = new Set<string>();
	for (const node of graph.nodes) {
		if (node.path === undefined) continue;
		if (node.kind === "Directory" || node.kind === "RepoSnapshot") continue;
		paths.add(node.path);
	}
	return [...paths].sort();
}

async function safeReadGraphPath(root: string, path: string): Promise<string | undefined> {
	try {
		const file = Bun.file(join(root, path));
		if (!(await file.exists())) return undefined;
		return file.text();
	} catch {
		return undefined;
	}
}

function hitsForFile(path: string, text: string, matchers: readonly TargetMatcher[]): readonly FileHit[] {
	const hits: FileHit[] = [];
	const lines = text.split(/\r?\n/);
	for (const [index, lineText] of lines.entries()) {
		for (const matcher of matchers) {
			for (const match of lineText.matchAll(freshRegex(matcher.regex))) {
				const matched = match[0];
				if (matched.length === 0) continue;
				hits.push({
					path,
					line: index + 1,
					lineText,
					match: redactMatcherValue(matched),
				});
			}
		}
	}
	return hits;
}

function freshRegex(regex: RegExp): RegExp {
	return new RegExp(regex.source, regex.flags);
}

function redactMatcherValue(value: string): string {
	return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function classedHits(
	hits: readonly FileHit[],
	target: string,
): ReadonlyMap<RemovalEvidenceClass, readonly AuditEvidence[]> {
	const byClass = new Map<RemovalEvidenceClass, AuditEvidence[]>();
	for (const hit of hits) {
		const className = classifyHit(hit, target);
		const evidence: AuditEvidence = {
			path: hit.path,
			lineStart: hit.line,
			lineEnd: hit.line,
			match: hit.match,
			evidenceKind: className,
		};
		let list = byClass.get(className);
		if (list === undefined) {
			list = [];
			byClass.set(className, list);
		}
		list.push(evidence);
	}
	return byClass;
}

function classifyHit(hit: FileHit, target: string): RemovalEvidenceClass {
	const path = hit.path.toLowerCase();
	const line = hit.lineText.toLowerCase();
	const upperTarget = target.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	if (path.endsWith("package.json")) return "package-dependency";
	if (isLockfile(path)) return "lockfile-reference";
	if (isGeneratedDbType(path)) return "generated-db-type";
	if (isTestPath(path)) return "test";
	if (isMockPath(path)) return "mock";
	if (isFixturePath(path)) return "fixture";
	if (isDocsPath(path)) return isHistoricalDocPath(path) ? "docs-historical" : "docs-active";
	if (isEdgeFunctionPath(path, target)) return "edge-function";
	if (isStorageHit(path, line)) return "storage-bucket";
	if (path.endsWith(".sql") && /\bpolicy\b/.test(line)) return "rls-policy";
	if (path.endsWith(".sql") && /\bfunction\b/.test(line)) return "db-function";
	if (path.endsWith(".sql") && /\btrigger\b/.test(line)) return "db-trigger";
	if (path.endsWith(".sql")) return "sql-migration";
	if (hit.match.startsWith(`${upperTarget}_`) || /\.(env|env\.example)$/.test(path)) return "env-var";
	if (isCiSecretHit(path, line)) return "ci-secret-name";
	if (isDeployConfigPath(path)) return "deploy-config";
	if (isImportHit(path, line)) return "import-or-sdk-client";
	if (isClientWrapperHit(path, line, target)) return "client-wrapper";
	if (isAuthUserModelHit(path, line)) return "auth-user-model";
	return "unknown-literal-hit";
}

function auditClass(
	className: RemovalEvidenceClass,
	active: readonly AuditEvidence[],
	checkedAt: string,
	target: string,
	retained: readonly AuditRetention[],
): AuditEvidenceClass {
	return {
		class: className,
		status: statusForVerifiedClass(className, active, retained),
		summary: summaryForClass(className, active, retained),
		active,
		removed: [],
		retained,
		unknown: className === "unknown-literal-hit" ? active : [],
		omitted: { count: 0, reason: null },
		verification: {
			checkedAt,
			method: "graph+literal-search",
			query: `${className} evidence matching ${target}`,
			resultCount: active.length,
		},
	};
}

function statusForVerifiedClass(
	className: RemovalEvidenceClass,
	active: readonly AuditEvidence[],
	retained: readonly AuditRetention[],
): AuditClassStatus {
	if (className === "replacement-auth" || className === "replacement-db" || className === "validation") return "needs-human-review";
	if (active.length > 0) return className === "unknown-literal-hit" ? "unknown" : "found";
	if (retained.length > 0) return "intentional-retention";
	return "not-found";
}

function summaryForClass(
	className: RemovalEvidenceClass,
	active: readonly AuditEvidence[],
	retained: readonly AuditRetention[],
): string {
	if (active.length > 0) return `Found ${active.length} active ${className} hit(s).`;
	if (retained.length > 0) return `No active hits after ${retained.length} intentional retention(s).`;
	if (className === "replacement-auth" || className === "replacement-db") return "Replacement surface requires human review.";
	if (className === "validation") return "Validation receipts require execution evidence.";
	return `No ${className} hits found.`;
}

function blockersFor(classes: readonly AuditEvidenceClass[]): readonly string[] {
	return classes.flatMap((classEntry) => {
		if (classEntry.active.length === 0) return [];
		return [`${classEntry.active.length} active ${classEntry.class} hit(s) remain`];
	});
}

function auditSnapshot(manifest: CodeGraphManifest): AuditSnapshot {
	return {
		root: manifest.root,
		graphHash: graphHash(manifest),
		...(manifest.git.commit === undefined ? {} : { commit: manifest.git.commit }),
		dirty: manifest.git.dirty,
		generatedAt: manifest.generatedAt,
	};
}

function graphHash(manifest: CodeGraphManifest): string {
	return createHash("sha256").update(JSON.stringify({ root: manifest.root, generatedAt: manifest.generatedAt, totals: manifest.totals, git: manifest.git })).digest("hex");
}

function validationReceipts(graph: CodeGraphSnapshot): readonly AuditValidationReceipt[] {
	return graph.nodes
		.filter((node) => node.kind === "PackageScript" && isValidationScript(node.label))
		.slice(0, 20)
		.map((node) => {
			const command = scriptRunCommand(node);
			return {
				command,
				cwd: ".",
				status: "not-run",
				safety: safeCommand(command) ? "safe" : "review",
				reason: "package validation script discovered from graph",
			};
		});
}

function scriptRunCommand(node: CodeGraphNode): string {
	const packageDir = scriptPackageDir(node.id);
	const scriptName = node.label;
	const command = `bun run ${shellToken(scriptName)}`;
	return packageDir === "." ? command : `cd ${shellToken(packageDir)} && ${command}`;
}

function scriptPackageDir(id: string): string {
	const suffix = id.startsWith("script:") ? id.slice("script:".length) : ".";
	const scriptSuffixIndex = suffix.lastIndexOf(":");
	return scriptSuffixIndex <= 0 ? "." : suffix.slice(0, scriptSuffixIndex);
}

function isValidationScript(name: string): boolean {
	return /^(build|check|ci|e2e|fuzz|integration|lint|test|typecheck|unit|validate|verify)(:|$)/i.test(name);
}

function safeCommand(command: string): boolean {
	return !/(deploy|apply|reset|seed|start|dev|preview|postinstall)/i.test(command);
}

function replacementFor(ledger: AuditLedger, surface: AuditReplacementRequirement["surface"]): string {
	return ledger.replacementRequirements.find((item) => item.surface === surface)?.expectedReplacement ?? `replacement ${surface}`;
}

function retentionsByClass(ledger: AuditLedger): ReadonlyMap<RemovalEvidenceClass, readonly AuditRetention[]> {
	const result = new Map<RemovalEvidenceClass, AuditRetention[]>();
	for (const classEntry of ledger.classes) result.set(classEntry.class, [...classEntry.retained]);
	for (const retention of ledger.exceptions) {
		const className = evidenceClassForRetention(ledger, retention);
		const list = result.get(className) ?? [];
		list.push(retention);
		result.set(className, list);
	}
	return result;
}

function evidenceClassForRetention(ledger: AuditLedger, retention: AuditRetention): RemovalEvidenceClass {
	return (
		ledger.classes.find((classEntry) =>
			classEntry.active.some((evidence) => evidence.path === retention.path && optionalMatch(retention.match, evidence.match)),
		)?.class ?? "unknown-literal-hit"
	);
}

function isRetained(evidence: AuditEvidence, retained: readonly AuditRetention[]): boolean {
	return retained.some(
		(retention) =>
			retention.path === evidence.path &&
			(retention.lineStart === undefined || retention.lineStart === evidence.lineStart) &&
			optionalMatch(retention.match, evidence.match),
	);
}

function optionalMatch(expected: string | undefined, actual: string): boolean {
	return expected === undefined || expected === actual;
}

function mergeValidation(
	previous: readonly AuditValidationReceipt[],
	current: readonly AuditValidationReceipt[],
): readonly AuditValidationReceipt[] {
	const byCommand = new Map(current.map((item) => [item.command, item]));
	for (const previousItem of previous) {
		byCommand.set(previousItem.command, { ...byCommand.get(previousItem.command), ...previousItem });
	}
	return [...byCommand.values()];
}

function renderActiveEvidence(ledger: AuditLedger): readonly string[] {
	const lines = ledger.classes.flatMap((classEntry) =>
		classEntry.active.slice(0, 20).map((item) => `- ${classEntry.class}: \`${item.path}:${item.lineStart}\` matched \`${item.match}\``),
	);
	return lines.length === 0 ? ["- None"] : lines;
}

function isAuditLedger(value: unknown): value is AuditLedger {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Record<string, unknown>)["schemaVersion"] === AUDIT_LEDGER_SCHEMA_VERSION &&
		(value as Record<string, unknown>)["kind"] === "removal"
	);
}

function isLockfile(path: string): boolean {
	return /(^|\/)(bun\.lock|bun\.lockb|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path);
}

function isGeneratedDbType(path: string): boolean {
	return /generated|database\.types|db\.types|supabase\/types/.test(path) && /\.(ts|tsx)$/.test(path);
}

function isTestPath(path: string): boolean {
	return path.includes("__tests__/") || /\.(test|spec)\.[cm]?[tj]sx?$/.test(path);
}

function isMockPath(path: string): boolean {
	return /(^|\/)(__mocks__|mocks?|mock-data)(\/|$)/.test(path) || /\.mock\.[cm]?[tj]sx?$/.test(path);
}

function isFixturePath(path: string): boolean {
	return /(^|\/)(fixtures?|testdata)(\/|$)/.test(path);
}

function isDocsPath(path: string): boolean {
	return /\.(md|mdx|rst|txt)$/.test(path) || path.startsWith("docs/");
}

function isHistoricalDocPath(path: string): boolean {
	return /(^|\/)(archive|history|historical|deprecated)(\/|$)/.test(path);
}

function isEdgeFunctionPath(path: string, target: string): boolean {
	return path.includes(`${target.toLowerCase()}/functions`) || path.includes("edge-functions") || path.includes("functions/");
}

function isStorageHit(path: string, line: string): boolean {
	return path.includes("storage") || line.includes("storage.objects") || line.includes(".storage");
}

function isCiSecretHit(path: string, line: string): boolean {
	return path.startsWith(".github/workflows/") || line.includes("secrets.") || line.includes("vars.");
}

function isDeployConfigPath(path: string): boolean {
	return /(^|\/)(vercel|netlify|fly|render|railway|docker|compose|deploy|deployment)/.test(path) || /\.(ya?ml|toml)$/.test(path);
}

function isImportHit(path: string, line: string): boolean {
	return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(path) && /\b(import|from|require)\b/.test(line);
}

function isClientWrapperHit(path: string, line: string, target: string): boolean {
	const loweredTarget = target.toLowerCase();
	return path.includes("client") || line.includes(`${loweredTarget}client`) || line.includes(`create${loweredTarget}`);
}

function isAuthUserModelHit(path: string, line: string): boolean {
	return path.includes("auth") || path.includes("user") || /\b(auth|user|session)\b/.test(line);
}

function slug(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "target";
}

function uniqueStrings(values: readonly string[]): readonly string[] {
	return [...new Set(values)];
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellToken(value: string): string {
	return /^[A-Za-z0-9_./:-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}
