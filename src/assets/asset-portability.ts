import { isLocalObjectUri } from "@anvilkit/canvas-core";
import type {
	CanvasAssetResolutionStatus,
	CanvasEffectiveAssetEntry,
} from "./effective-asset-resolver.js";

/** The three supported ways a Canvas document can carry asset references. */
export type CanvasDocumentPortabilityMode =
	| "local-only"
	| "hosted-reference"
	| "packaged";

export interface CanvasDocumentPortabilityBehavior {
	/** Whether the representation can be opened on another device as written. */
	readonly crossDevice: boolean;
	/** Asset form accepted by this mode's persisted/shareable representation. */
	readonly assetForm:
		| "local-or-portable"
		| "absolute-http-reference"
		| "embedded-data";
	/** Product action when a user asks to share this representation. */
	readonly sharing:
		| "migrate-local-assets-or-block"
		| "preserve-hosted-references"
		| "emit-self-contained-artifact";
	/** Which ingress path may introduce new assets without violating the mode. */
	readonly ingress: "browser-local" | "host-required" | "package-on-output";
}

/**
 * Stable product behavior for each mode. Keeping this executable prevents UI,
 * sharing workflows, and documentation from inventing different semantics.
 */
export const CANVAS_DOCUMENT_PORTABILITY_BEHAVIORS: Readonly<
	Record<CanvasDocumentPortabilityMode, CanvasDocumentPortabilityBehavior>
> = {
	"local-only": {
		crossDevice: false,
		assetForm: "local-or-portable",
		sharing: "migrate-local-assets-or-block",
		ingress: "browser-local",
	},
	"hosted-reference": {
		crossDevice: true,
		assetForm: "absolute-http-reference",
		sharing: "preserve-hosted-references",
		ingress: "host-required",
	},
	packaged: {
		crossDevice: true,
		assetForm: "embedded-data",
		sharing: "emit-self-contained-artifact",
		ingress: "package-on-output",
	},
};

type NonReadyAssetStatus = Exclude<CanvasAssetResolutionStatus, "ready">;

export type CanvasAssetPortabilityIssueReason =
	| NonReadyAssetStatus
	| "browser-local-reference"
	| "non-hosted-reference"
	| "non-embedded-reference";

export type CanvasAssetPortabilityAction =
	| "wait"
	| "retry"
	| "replace"
	| "reauthorize"
	| "upload"
	| "embed";

/** One precise asset that prevents the document from satisfying a mode. */
export interface CanvasAssetPortabilityIssue {
	readonly assetId: string;
	readonly uri: string;
	readonly status: CanvasAssetResolutionStatus;
	readonly reason: CanvasAssetPortabilityIssueReason;
	readonly action: CanvasAssetPortabilityAction;
	readonly message: string;
}

export interface CanvasDocumentPortabilityAssessment {
	readonly mode: CanvasDocumentPortabilityMode;
	readonly behavior: CanvasDocumentPortabilityBehavior;
	/** True only when every asset is healthy and has the mode's required form. */
	readonly ready: boolean;
	/** Deterministic document order; safe to surface directly in a block dialog. */
	readonly unresolvedAssets: readonly CanvasAssetPortabilityIssue[];
}

function isHostedReference(uri: string): boolean {
	try {
		const protocol = new URL(uri).protocol;
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

function isEmbeddedReference(uri: string): boolean {
	return uri.trimStart().toLowerCase().startsWith("data:");
}

function healthAction(
	status: NonReadyAssetStatus,
): CanvasAssetPortabilityAction {
	switch (status) {
		case "loading":
		case "uploading":
		case "retrying":
			return "wait";
		case "unauthorized":
			return "reauthorize";
		case "missing":
			return "replace";
		case "unavailable":
		case "stale":
			return "retry";
	}
}

function healthIssue(
	entry: CanvasEffectiveAssetEntry,
	status: NonReadyAssetStatus,
): CanvasAssetPortabilityIssue {
	return {
		assetId: entry.id,
		uri: entry.documentAsset.uri,
		status,
		reason: status,
		action: healthAction(status),
		message:
			entry.message ??
			`Asset "${entry.id}" is ${status} and cannot be made portable yet.`,
	};
}

function referenceIssue(
	entry: CanvasEffectiveAssetEntry,
	mode: Exclude<CanvasDocumentPortabilityMode, "local-only">,
): CanvasAssetPortabilityIssue | undefined {
	const uri = entry.documentAsset.uri;
	if (mode === "hosted-reference") {
		if (isHostedReference(uri)) return undefined;
		const local = isLocalObjectUri(uri);
		return {
			assetId: entry.id,
			uri,
			status: entry.status,
			reason: local ? "browser-local-reference" : "non-hosted-reference",
			action: "upload",
			message: local
				? `Asset "${entry.id}" exists only in this browser and must be uploaded before sharing.`
				: `Asset "${entry.id}" does not have an absolute hosted URL and must be uploaded before sharing.`,
		};
	}
	if (isEmbeddedReference(uri)) return undefined;
	return {
		assetId: entry.id,
		uri,
		status: entry.status,
		reason: "non-embedded-reference",
		action: "embed",
		message: `Asset "${entry.id}" must be embedded before a self-contained package can be shared.`,
	};
}

/**
 * Assess an effective asset table against one explicit document mode. Health
 * always wins over URI shape, so a stale/unauthorized asset cannot be reported
 * misleadingly as an upload or embedding problem.
 */
export function assessCanvasDocumentPortability(
	entries: Readonly<Record<string, CanvasEffectiveAssetEntry>>,
	mode: CanvasDocumentPortabilityMode,
): CanvasDocumentPortabilityAssessment {
	const unresolvedAssets: CanvasAssetPortabilityIssue[] = [];
	for (const entry of Object.values(entries)) {
		if (entry.status !== "ready") {
			unresolvedAssets.push(healthIssue(entry, entry.status));
			continue;
		}
		if (mode === "local-only") continue;
		const issue = referenceIssue(entry, mode);
		if (issue) unresolvedAssets.push(issue);
	}
	return {
		mode,
		behavior: CANVAS_DOCUMENT_PORTABILITY_BEHAVIORS[mode],
		ready: unresolvedAssets.length === 0,
		unresolvedAssets,
	};
}
