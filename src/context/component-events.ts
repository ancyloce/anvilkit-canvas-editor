/**
 * @file The Local Components host analytics seam (plan 0023 M6-08, PRD §12).
 *
 * `@anvilkit/canvas-editor` ships NO analytics transport, and this file does not
 * change that: it defines the eight event shapes PRD §12 specifies and one
 * callback prop, following the same convention `onChange`/`onChanges`/`onError`
 * already use. The editor emits; the host owns delivery.
 *
 * ### The privacy contract is in the TYPES, not in a guideline
 *
 * Every payload below carries counts, enum-ish discriminators, and HASHED ids —
 * there is deliberately no field that could hold document content. A reviewer
 * cannot accidentally add copy, an image URI or a raw override value to an event
 * without adding a field here first, which is exactly the point: "no text, image
 * URI, document body, or raw override value is emitted by default" is enforced
 * by the shape rather than by remembering.
 *
 * Ids are hashed with {@link hashComponentId} before they leave the editor. The
 * hash is stable within a session so a host can correlate events, and carries no
 * way back to the id — a component NAME is often the product name, and a raw
 * document id identifies the customer's artwork.
 */

/** How a Source came into existence (`canvas.component.created`). */
export type CanvasComponentSourceKind =
	| "reuse-container"
	| "wrap-in-frame"
	| "duplicate"
	| "template-import";

/** How an instance reached the page (`canvas.component.instance_inserted`). */
export type CanvasComponentInsertionMethod =
	| "panel-click"
	| "panel-drag"
	| "paste"
	| "duplicate"
	| "template";

/** What a Source edit did (`canvas.component.source_edited`). */
export type CanvasComponentSourceOperation =
	| "node-edit"
	| "property-added"
	| "property-updated"
	| "property-removed"
	| "renamed";

/** The value state an override replaced (`canvas.component.override_set`). */
export type CanvasComponentOverridePriorState =
	| "default"
	| "overridden"
	| "orphan";

/** How much a reset cleared (`canvas.component.override_reset`). */
export type CanvasComponentResetScope = "one" | "all";

/** What happened to a delete attempt (`canvas.component.delete_attempted`). */
export type CanvasComponentDeleteOutcome =
	| "deleted"
	| "blocked"
	| "detached-and-deleted"
	| "cancelled";

/** The four override kinds, mirrored so an event never carries a value. */
export type CanvasComponentPropertyType =
	| "text"
	| "image"
	| "color"
	| "visibility";

/**
 * The eight PRD §12 events, as a discriminated union on `type`.
 *
 * A union rather than eight callbacks: a host wires ONE handler and switches,
 * and adding a ninth event cannot silently go unhandled in a host that switches
 * exhaustively.
 */
export type CanvasComponentEvent =
	| {
			readonly type: "canvas.component.created";
			readonly sourceKind: CanvasComponentSourceKind;
			readonly nodeCount: number;
			readonly hasAutoLayout: boolean;
	  }
	| {
			readonly type: "canvas.component.instance_inserted";
			readonly componentIdHash: string;
			readonly pageIdHash: string;
			readonly insertionMethod: CanvasComponentInsertionMethod;
	  }
	| {
			readonly type: "canvas.component.source_edited";
			readonly operation: CanvasComponentSourceOperation;
			readonly affectedInstanceCount: number;
	  }
	| {
			readonly type: "canvas.component.override_set";
			readonly propertyType: CanvasComponentPropertyType;
			readonly priorState: CanvasComponentOverridePriorState;
	  }
	| {
			readonly type: "canvas.component.override_reset";
			readonly propertyType: CanvasComponentPropertyType | "mixed";
			readonly resetScope: CanvasComponentResetScope;
	  }
	| {
			readonly type: "canvas.component.detached";
			readonly nodeCount: number;
			readonly nestedDepth: number;
			readonly warningCount: number;
	  }
	| {
			readonly type: "canvas.component.delete_attempted";
			readonly dependentCount: number;
			readonly outcome: CanvasComponentDeleteOutcome;
	  }
	| {
			readonly type: "canvas.component.diagnostic";
			/** A `CanvasComponentIssueCode` — a stable enum, never a message. */
			readonly code: string;
			readonly severity: "warning" | "error";
			/** The operation that surfaced it, for triage grouping. */
			readonly operation: string;
	  };

export type CanvasComponentEventHandler = (event: CanvasComponentEvent) => void;

/**
 * The eight event identifiers, as data.
 *
 * Exists because these strings live in the `canvas.component.*` namespace that
 * ALSO holds real user-visible message keys (`canvas.component.missing`,
 * `canvas.component.page`, …), and the A-11 i18n completeness scan reads every
 * `"canvas.*"` string literal in `src` as a catalog key. The layout events avoid
 * that by owning a whole namespace the scan can exempt with one regex; PRD §12
 * fixes these identifiers, so renaming them out of the collision is not
 * available. Exporting the list lets the scan exempt exactly these eight and
 * nothing more — and keeps the exemption from drifting when a ninth event lands.
 *
 * Typed against the union, so listing an identifier that is not an event (or
 * mistyping one) fails to compile.
 */
export const CANVAS_COMPONENT_EVENT_TYPES: readonly CanvasComponentEvent["type"][] =
	[
		"canvas.component.created",
		"canvas.component.instance_inserted",
		"canvas.component.source_edited",
		"canvas.component.override_set",
		"canvas.component.override_reset",
		"canvas.component.detached",
		"canvas.component.delete_attempted",
		"canvas.component.diagnostic",
	];

/**
 * Stable, non-reversible hash of a document id for analytics.
 *
 * FNV-1a over UTF-16 code units — small, dependency-free and deterministic. It
 * is NOT a security primitive and does not need to be: the requirement is that
 * a host can correlate two events about the same component without the editor
 * shipping the id (or the name behind it) off the machine.
 */
export function hashComponentId(id: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < id.length; i += 1) {
		hash ^= id.charCodeAt(i);
		// FNV prime, via shifts so the whole thing stays in 32-bit integer math.
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36).padStart(7, "0");
}
