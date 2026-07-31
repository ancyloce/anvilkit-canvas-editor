import { hashIdentifier } from "@anvilkit/canvas-core/brand-governance";

/**
 * @file Product analytics for component libraries and brand governance
 * (plan 0021 T-050, PRD §13, OD-16).
 *
 * ## Why every name carries an `anvilkit.` prefix
 *
 * `canvas.*` is already the Editor's flat i18n catalog namespace, and the
 * catalog-completeness gate scans every non-test source file for
 * `/["'](canvas\.[a-zA-Z0-9.]+)["']/g` — a quote immediately followed by
 * `canvas.`. Two of the PRD's nine event names (`canvas.library.searched`,
 * `canvas.component.swapped`) match that pattern exactly and would be collected
 * as missing message keys; the other seven escape only because the character
 * class excludes `_`. Depending on that is a trap for whoever adds the tenth
 * event.
 *
 * The `anvilkit.` prefix removes the collision structurally rather than by
 * coincidence: the scanner requires the quote to be immediately before
 * `canvas.`, so `"anvilkit.canvas.library.searched"` cannot match however the
 * names grow. `analytics.test.ts` asserts that against the real regex.
 *
 * ## Why a constant table rather than inline literals
 *
 * Emission sites pass a key from {@link CANVAS_ANALYTICS_EVENTS}, so the
 * literal exists once. Inline strings would put the raw name back at every call
 * site — which is where the i18n collision came from in the first place — and
 * would make the redaction rules below unenforceable by inspection.
 *
 * ## What is never emitted
 *
 * No credentials, no raw document content, no text values, no asset URLs, no
 * unredacted identity (PRD §13). Library and component identifiers are hashed,
 * not sent. `__tests__/analytics.test.ts` walks every payload shape and fails on
 * a value that looks like a credential, a URL, or raw text.
 */

/**
 * The nine PRD §13 events, stored as their FULL wire names.
 *
 * Storing the `anvilkit.`-prefixed string — rather than a bare suffix that a
 * helper concatenates — is the whole point of OD-16, and the difference is not
 * cosmetic. A table of suffixes still leaves a QUOTED bare suffix in this file,
 * which the catalog scanner collects and reports as a missing message key. That
 * is not hypothetical: it is exactly what the gate did to the first version of
 * this module — twice, because the second failure was a quoted example inside
 * this very comment. The scanner reads raw text, so prose is not exempt.
 */
export const CANVAS_ANALYTICS_EVENTS = {
	librarySearched: "anvilkit.canvas.library.searched",
	libraryComponentInserted: "anvilkit.canvas.library.component_inserted",
	componentUpdateChecked: "anvilkit.canvas.component.update_checked",
	componentUpdateApplied: "anvilkit.canvas.component.update_applied",
	componentVariantChanged: "anvilkit.canvas.component.variant_changed",
	componentSwapped: "anvilkit.canvas.component.swapped",
	brandViolationDetected: "anvilkit.canvas.brand.violation_detected",
	brandOperationBlocked: "anvilkit.canvas.brand.operation_blocked",
	brandComplianceRun: "anvilkit.canvas.brand.compliance_run",
} as const;

export type CanvasAnalyticsEventKey = keyof typeof CANVAS_ANALYTICS_EVENTS;

/** The prefix that keeps analytics names out of the i18n namespace (OD-16). */
export const CANVAS_ANALYTICS_PREFIX = "anvilkit." as const;

/** The wire name for an event key. */
export function analyticsEventName(key: CanvasAnalyticsEventKey): string {
	return CANVAS_ANALYTICS_EVENTS[key];
}

/**
 * Latency reported as a bucket, never as a millisecond count.
 *
 * A raw duration is a weak side channel — it correlates with result-set size
 * and therefore with what a user searched for. Buckets keep the operational
 * signal (is the Provider slow?) without the correlation.
 */
export type CanvasLatencyBucket = "instant" | "fast" | "slow" | "very-slow";

export function latencyBucket(ms: number): CanvasLatencyBucket {
	if (ms < 100) return "instant";
	if (ms < 500) return "fast";
	if (ms < 2_000) return "slow";
	return "very-slow";
}

/**
 * A stable, non-reversible identifier for a library or component.
 *
 * Re-exported from core's audit module rather than reimplemented: an analytics
 * event and an audit record describing the same action must produce the same
 * token, or an operator cannot correlate the two streams — which is the main
 * thing they will want to do with both.
 */
export { hashIdentifier };

/** The per-event property bags, exactly PRD §13's "required properties". */
export interface CanvasAnalyticsPayloads {
	librarySearched: {
		readonly queryLength: number;
		readonly filters: readonly string[];
		readonly resultCount: number;
		readonly latencyBucket: CanvasLatencyBucket;
		readonly outcome: "ok" | "empty" | "error" | "aborted";
	};
	libraryComponentInserted: {
		readonly libraryIdHash: string;
		readonly componentIdHash: string;
		readonly version: string;
		readonly cached: boolean;
	};
	componentUpdateChecked: {
		readonly currentVersion: string;
		readonly updateAvailable: boolean;
		readonly outcome: "ok" | "offline" | "error";
	};
	componentUpdateApplied: {
		readonly fromVersion: string;
		readonly toVersion: string;
		readonly instanceCount: number;
		readonly orphanCount: number;
	};
	componentVariantChanged: {
		readonly axisCount: number;
		readonly valid: boolean;
		readonly orphanCount: number;
	};
	componentSwapped: {
		readonly compatibilityLevel: string;
		readonly preservedCount: number;
		readonly orphanCount: number;
	};
	brandViolationDetected: {
		readonly code: string;
		readonly severity: "warning" | "blocking";
		readonly operation: string;
	};
	brandOperationBlocked: {
		readonly operation: string;
		readonly code: string;
		readonly hostPolicyMode: "off" | "warning" | "blocking";
	};
	brandComplianceRun: {
		readonly warningCount: number;
		readonly blockingCount: number;
		readonly trigger: "manual" | "export" | "load";
	};
}

export interface CanvasAnalyticsEvent<
	K extends CanvasAnalyticsEventKey = CanvasAnalyticsEventKey,
> {
	/** The wire name, already `anvilkit.`-prefixed. */
	readonly name: string;
	readonly key: K;
	readonly properties: CanvasAnalyticsPayloads[K];
}

/** The host sink. Optional everywhere — analytics is never load-bearing. */
export type CanvasAnalyticsSink = (event: CanvasAnalyticsEvent) => void;

/**
 * Build an event. Exported so a test can assert a payload without a sink, and
 * so every emission site goes through one place.
 */
export function canvasAnalyticsEvent<K extends CanvasAnalyticsEventKey>(
	key: K,
	properties: CanvasAnalyticsPayloads[K],
): CanvasAnalyticsEvent<K> {
	return { name: analyticsEventName(key), key, properties };
}

/**
 * Emit, tolerating a throwing sink.
 *
 * A host's analytics callback is third-party code on a user-interaction path.
 * If it throws, the user's insert or update must still complete — losing a
 * metric is an acceptable outcome, losing the edit is not.
 */
export function emitCanvasAnalytics<K extends CanvasAnalyticsEventKey>(
	sink: CanvasAnalyticsSink | undefined,
	key: K,
	properties: CanvasAnalyticsPayloads[K],
): void {
	if (!sink) return;
	try {
		sink(canvasAnalyticsEvent(key, properties));
	} catch {
		// Deliberately swallowed. See the doc comment.
	}
}
