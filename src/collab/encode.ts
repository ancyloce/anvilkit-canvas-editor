import { type CanvasIR, CanvasIRSchema } from "@anvilkit/canvas-core";

/**
 * Serialize a {@link CanvasIR} to a stable JSON string with sorted object
 * keys. Two replicas observing the same logical IR must produce
 * byte-identical Y.Map values; otherwise last-writer-wins would flap on
 * key-order differences alone. Mirrors `plugin-collab-yjs`'s `encodeIR`.
 */
export function encodeCanvasIR(ir: CanvasIR): string {
	return JSON.stringify(ir, (_key, value) => sortKeysIfObject(value));
}

/**
 * Parse + validate a remote payload. Unlike the plugin's `decodeIR` (which
 * only checks `version === "1"`), this runs canvas-core's full
 * {@link CanvasIRSchema} — a hostile or corrupt peer cannot inject a
 * structurally-invalid IR into the local scene. Throws on invalid input;
 * callers in observers must wrap this in try/catch (never throw out of a
 * Yjs observer).
 */
export function decodeCanvasIR(raw: string): CanvasIR {
	const parsed = JSON.parse(raw);
	return CanvasIRSchema.parse(parsed);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortKeysIfObject(value: unknown): unknown {
	if (!isPlainObject(value)) return value;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		sorted[key] = value[key];
	}
	return sorted;
}
