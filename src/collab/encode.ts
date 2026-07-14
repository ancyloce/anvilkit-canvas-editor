import {
	type CanvasIR,
	type CanvasRuntime,
	migrateCanvasIR,
} from "@anvilkit/canvas-core";

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
 * Parse, forward-migrate, then validate a remote payload (P0-8).
 *
 * Previously this ran only `CanvasIRSchema.parse` — no migration — so a peer
 * on an older supported document version (e.g. `version: "1"`) was rejected
 * outright even though core ships a migration for exactly that case, and a
 * peer using a runtime with custom node kinds had every custom node rejected
 * by the closed built-in schema. Routing through `runtime.migrate` (or core's
 * `migrateCanvasIR` when no `runtime` is supplied — the same default,
 * built-in-only path `migrateCanvasIR` always was) fixes both: old versions
 * migrate forward, and a runtime's extension-aware `irSchema` validates
 * custom nodes instead of rejecting them.
 *
 * A hostile or corrupt peer still cannot inject a structurally-invalid IR
 * into the local scene — `runtime.migrate`/`migrateCanvasIR` end in the same
 * Zod validation `CanvasIRSchema.parse` always ran. Throws on invalid input
 * OR an unsupported version; callers in observers must wrap this in
 * try/catch (never throw out of a Yjs observer).
 */
export function decodeCanvasIR(raw: string, runtime?: CanvasRuntime): CanvasIR {
	const parsed = JSON.parse(raw);
	return runtime ? runtime.migrate(parsed) : migrateCanvasIR(parsed);
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
