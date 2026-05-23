import type {
	CanvasPeerInfo,
	CanvasPresenceCursor,
	CanvasPresenceSelection,
	CanvasPresenceState,
} from "./presence-types.js";

/**
 * Structured validation for {@link CanvasPresenceState} payloads received over
 * an untrusted transport. Ported from `plugin-collab-yjs`'s `presence-schema`.
 *
 * `validate*` returns the strongly-typed value when the input matches the
 * schema, or `null` when it does not — a malformed payload from one peer never
 * poisons the local view.
 *
 * - `displayName` is capped at {@link MAX_DISPLAY_NAME_LENGTH} chars and
 *   stripped of ASCII control characters by {@link sanitizeDisplayName}.
 * - `color` is checked against an allowlist (hex / rgb(a) / hsl(a) / named).
 *   Anything else (`javascript:`, `expression(...)`, `<script>`, arbitrary
 *   strings) rejects the peer record — defense-in-depth for hosts that render
 *   `color` into a CSS attribute.
 */

export const MAX_DISPLAY_NAME_LENGTH = 64;

const COLOR_REGEX =
	/^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)|hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*\)|hsla\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*,\s*(0|1|0?\.\d+)\s*\))$/;

const NAMED_COLOR_SET = new Set([
	"transparent",
	"currentcolor",
	"black",
	"white",
	"red",
	"green",
	"blue",
	"yellow",
	"orange",
	"purple",
	"pink",
	"gray",
	"grey",
	"brown",
	"cyan",
	"magenta",
	"lime",
	"navy",
	"teal",
	"olive",
	"maroon",
	"silver",
	"gold",
	"indigo",
	"violet",
]);

function isValidColor(value: string): boolean {
	if (value.length === 0 || value.length > 32) return false;
	if (COLOR_REGEX.test(value)) return true;
	return NAMED_COLOR_SET.has(value.toLowerCase());
}

/**
 * Strip ASCII control characters (0x00–0x1f) and DEL (0x7f) from a display
 * name, then cap to {@link MAX_DISPLAY_NAME_LENGTH}. Filters by code point to
 * avoid a control-character regex literal. Does NOT escape HTML — hosts
 * rendering the name into `innerHTML` must still escape; this only blunts
 * control-character injection.
 */
export function sanitizeDisplayName(value: string): string {
	let stripped = "";
	for (const ch of value) {
		const code = ch.codePointAt(0) ?? 0;
		if (code <= 0x1f || code === 0x7f) continue;
		stripped += ch;
	}
	if (stripped.length <= MAX_DISPLAY_NAME_LENGTH) return stripped;
	return stripped.slice(0, MAX_DISPLAY_NAME_LENGTH);
}

export function validateCanvasPeerInfo(value: unknown): CanvasPeerInfo | null {
	if (!isObject(value)) return null;
	if (typeof value.id !== "string" || value.id.length === 0) return null;
	if (
		value.displayName !== undefined &&
		typeof value.displayName !== "string"
	) {
		return null;
	}
	if (value.color !== undefined) {
		if (typeof value.color !== "string") return null;
		if (!isValidColor(value.color)) return null;
	}
	const sanitized: Record<string, unknown> = { id: value.id };
	if (typeof value.displayName === "string") {
		sanitized.displayName = sanitizeDisplayName(value.displayName);
	}
	if (typeof value.color === "string") sanitized.color = value.color;
	return sanitized as unknown as CanvasPeerInfo;
}

export function validateCanvasPresenceCursor(
	value: unknown,
): CanvasPresenceCursor | null {
	if (!isObject(value)) return null;
	if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
	return value as unknown as CanvasPresenceCursor;
}

export function validateCanvasPresenceSelection(
	value: unknown,
): CanvasPresenceSelection | null {
	if (!isObject(value)) return null;
	const { nodeIds } = value;
	if (!Array.isArray(nodeIds)) return null;
	if (!nodeIds.every((id) => typeof id === "string")) return null;
	return value as unknown as CanvasPresenceSelection;
}

export function validateCanvasPresenceState(
	value: unknown,
): CanvasPresenceState | null {
	if (!isObject(value)) return null;
	if (validateCanvasPeerInfo(value.peer) === null) return null;
	if (
		value.cursor !== undefined &&
		validateCanvasPresenceCursor(value.cursor) === null
	) {
		return null;
	}
	if (
		value.selection !== undefined &&
		validateCanvasPresenceSelection(value.selection) === null
	) {
		return null;
	}
	return value as unknown as CanvasPresenceState;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
