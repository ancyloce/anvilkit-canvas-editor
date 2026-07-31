import {
	CANVAS_COMPONENTS_LOCAL_CAPABILITY,
	CANVAS_COMPONENTS_OVERRIDES_CAPABILITY,
	CANVAS_LAYOUT_AUTO_CAPABILITY,
	type CanvasComponentIssue,
	type CanvasIR,
	type CanvasRuntime,
	migrateCanvasIR,
	validateComponentGraph,
} from "@anvilkit/canvas-core";
import type { CanvasComponentDiagnostic } from "@anvilkit/canvas-core/component-libraries";
import {
	CanvasBrandComponentPolicySchema,
	validateBrandComponentPolicy,
} from "@anvilkit/canvas-core/brand-governance";

import type {
	LoadVerificationOptions,
	LoadVerificationResult,
} from "../component-libraries/load-verification.js";
import { verifyDocumentSnapshots } from "../component-libraries/load-verification.js";

/**
 * @file The editor's single document-load pipeline (plan 0022, T-M0-04).
 *
 * Every path that brings a document in from outside the editor — a host
 * persistence adapter's `load`, a recovery snapshot, a collaborating peer —
 * must run the same steps: parse, forward-migrate, validate. Before this
 * module they did not. `save`/`saveOnUnload` were wired but
 * `CanvasPersistenceAdapter.load` was never called at all, and the recovery
 * controller restored a snapshot with **no** parse and **no** migration,
 * mounting whatever had been written to IndexedDB — including a document
 * written by an older version of the app.
 *
 * Consolidating here is what makes the IR v3 migration (M1) trustworthy: a
 * migrate seam is only as good as the number of entry paths that route
 * through it, and a second implementation elsewhere in the editor would
 * silently opt that path out of every future migration.
 */

export interface LoadCanvasDocumentOptions {
	/**
	 * Runtime whose extension-aware schema validates the result. Omit to use
	 * core's built-in-only path — the same default the collab decoder has
	 * always used. Supplying it is what lets a document containing custom
	 * node kinds validate instead of being rejected by the closed built-in
	 * schema.
	 */
	readonly runtime?: CanvasRuntime;
}

/**
 * Parse (when given a string), forward-migrate, then validate an untrusted
 * document payload.
 *
 * Accepts `unknown` rather than `string` because the sources differ in shape:
 * a persistence adapter's `load` resolves an already-parsed object, while
 * recovery snapshots and collab payloads arrive as JSON text. Normalising
 * here keeps every caller on one code path instead of each deciding when to
 * parse.
 *
 * **Throws** on malformed JSON, an unsupported version, or a
 * structurally-invalid document — migration ends in the same Zod validation
 * the editor has always run, so a corrupt or hostile payload cannot reach the
 * scene. Callers are responsible for catching: a load failure must be
 * reported to the host, never allowed to break the mount, and never allowed
 * to escape a Yjs observer.
 */
export function loadCanvasDocument(
	raw: unknown,
	options: LoadCanvasDocumentOptions = {},
): CanvasIR {
	const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
	return options.runtime
		? options.runtime.migrate(parsed)
		: migrateCanvasIR(parsed);
}

/**
 * Capabilities a payload declares that this build does not implement — read
 * BEFORE any schema parse (plan 0023 M6-06, decision D-7, LC-COMPAT-002,
 * INV-14).
 *
 * The problem this exists to solve: `CanvasNodeSchema` is a
 * `discriminatedUnion`, so a document using a node kind this build lacks fails
 * validation OUTRIGHT and {@link loadCanvasDocument} throws — and on the collab
 * path that means the entire remote document is discarded, not degraded. A peer
 * with a newer build could therefore lose work to an older one. Reading the
 * declared capabilities from the RAW payload first gives the caller the
 * information it needs to route to read-only preview instead of discarding.
 *
 * Deliberately total and allocation-light: it never parses, never validates, and
 * treats any unexpected shape as "nothing declared" — its job is to answer one
 * question about untrusted input without becoming a second validator.
 */
export function unsupportedDeclaredCapabilities(
	payload: unknown,
): readonly string[] {
	const compatibility = (payload as { compatibility?: unknown } | null)
		?.compatibility;
	const declared = (compatibility as { requiredCapabilities?: unknown } | null)
		?.requiredCapabilities;
	if (!Array.isArray(declared)) return [];
	return declared.filter(
		(capability): capability is string =>
			typeof capability === "string" &&
			!IMPLEMENTED_CAPABILITIES.has(capability),
	);
}

/**
 * The capabilities this build implements, mirrored from core's own
 * `KNOWN_CAPABILITIES`.
 *
 * Mirrored rather than imported because core keeps that set module-private on
 * purpose (it is the validator's judgement, not public API), and the pre-parse
 * gate cannot go through the validator — running the validator is precisely
 * what it must happen before. The `layout-capability-unsupported` invariant
 * remains the authority for a PARSED document; this set only has to agree with
 * it, and the test suite pins that agreement.
 */
const IMPLEMENTED_CAPABILITIES: ReadonlySet<string> = new Set([
	CANVAS_LAYOUT_AUTO_CAPABILITY,
	CANVAS_COMPONENTS_LOCAL_CAPABILITY,
	CANVAS_COMPONENTS_OVERRIDES_CAPABILITY,
]);

/* ── §21.1 full pipeline (plan 0021 T-045) ───────────────────────────────── */

export interface CanvasLoadDiagnostics {
	/** Snapshot keys quarantined by re-verification. */
	readonly quarantinedKeys: readonly string[];
	/** Integrity findings, one per quarantined snapshot. */
	readonly integrity: readonly CanvasComponentDiagnostic[];
	/** Graph, variant and override findings from `validateComponentGraph`. */
	readonly graph: readonly CanvasComponentIssue[];
	/** Instance ids carrying a policy that failed portable-contract validation. */
	readonly policy: readonly string[];
	/** How many snapshots were hashed. 0 when re-verification did not run. */
	readonly verifiedCount: number;
	/** Whether anything found here must block export (T-045 step 3). */
	readonly blocksExport: boolean;
}

export interface CanvasLoadResult {
	readonly ir: CanvasIR;
	readonly diagnostics: CanvasLoadDiagnostics;
}

export type LoadCanvasDocumentWithDiagnosticsOptions =
	LoadCanvasDocumentOptions & LoadVerificationOptions;

/**
 * The full TD §21.1 load pipeline: parse → migrate → validate snapshot keys and
 * canonical form → validate graph and variants → validate policy → (caller)
 * resolve without a Provider → mount with diagnostics.
 *
 * ## Why this returns diagnostics instead of throwing
 *
 * {@link loadCanvasDocument} throws, and must: a payload that is not a valid
 * document has nothing to mount. But every step added here describes a document
 * that IS valid and merely has something wrong *inside* it — a quarantined
 * snapshot, an orphaned override, a policy that no longer parses. T-045 step 3
 * is explicit that the document still mounts in those cases; the affected
 * instance degrades to a placeholder and export is blocked until it is fixed.
 * Throwing would turn a recoverable, explainable state into a lost document.
 *
 * The resolve step is the caller's, not this function's: resolution needs the
 * quarantine set returned here, and it belongs to the render path rather than
 * to load. Passing `diagnostics.quarantinedKeys` into
 * `buildExternalSnapshotIndex` is what makes a tampered snapshot resolve to a
 * placeholder instead of rendering content that failed verification.
 */
export async function loadCanvasDocumentWithDiagnostics(
	raw: unknown,
	options: LoadCanvasDocumentWithDiagnosticsOptions = {},
): Promise<CanvasLoadResult> {
	// 1-2. Parse and forward-migrate. Still throws — see the doc comment.
	const ir = loadCanvasDocument(raw, options);

	// 3. Snapshot keys, canonical form, integrity.
	const verification: LoadVerificationResult = await verifyDocumentSnapshots(
		ir,
		options,
	);

	// 4. Local/external dependency graph, variants and overrides.
	const graph = validateComponentGraph(ir);

	// 5. Portable policy contracts. A policy that no longer validates is
	//    reported, never silently dropped: dropping it would quietly REMOVE a
	//    restriction, which is the failure direction that matters.
	const policy: string[] = [];
	for (const [componentId, definition] of Object.entries(ir.components ?? {})) {
		const declared = (definition as { policy?: unknown }).policy;
		if (declared === undefined) continue;
		const parsed = CanvasBrandComponentPolicySchema.safeParse(declared);
		if (!parsed.success) {
			policy.push(componentId);
			continue;
		}
		// Validated against the definition's OWN property ids, so a policy that
		// still parses but now allows editing a property the component no longer
		// has is caught too — the shape most likely to survive an update.
		const knownPropertyIds = (definition.properties ?? []).map((p) => p.id);
		if (validateBrandComponentPolicy(parsed.data, knownPropertyIds).length > 0) {
			policy.push(componentId);
		}
	}

	return {
		ir,
		diagnostics: {
			quarantinedKeys: verification.quarantinedKeys,
			integrity: verification.diagnostics,
			graph,
			policy,
			verifiedCount: verification.verifiedCount,
			// An integrity failure always blocks; a graph ERROR blocks; a warning
			// (an orphaned override, a deprecated version) does not — those are
			// normal states of a living document and blocking on them would make
			// the editor unusable.
			blocksExport:
				verification.quarantinedKeys.length > 0 ||
				graph.some((issue) => issue.severity === "error") ||
				policy.length > 0,
		},
	};
}
