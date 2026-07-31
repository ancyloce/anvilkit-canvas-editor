import type { AnyCanvasCommand } from "../stores/history-store.js";

/**
 * @file Snapshot keys the undo/redo stacks still need (plan 0021 T-034).
 *
 * ## The plan's baseline for this task is stale, and it matters
 *
 * T-034 (and plan CON-7) describe `stores/history-store.ts` as holding "up to
 * `DEFAULT_HISTORY_LIMIT = 100` full `CanvasIR` copies". It does not: `past`
 * and `future` hold **inverse commands** (`AnyCanvasCommand[]`). A retained-set
 * derivation written against the documented baseline would have walked IR
 * copies that do not exist and quietly returned an empty set — and an empty
 * retained set is exactly the input that makes the GC delete snapshots undo
 * still needs.
 *
 * So this walks the COMMANDS instead, collecting every snapshot key any of them
 * mentions.
 *
 * ## Deliberately over-inclusive
 *
 * When a command's shape is not recognized, its keys are simply not found — so
 * the scan is written to look in every place a plan-0021 command can carry a
 * key, and to recurse into `batch` and into the `redo` payloads inverses carry.
 * Being wrong in the retaining direction costs bytes; being wrong the other way
 * costs the user their undo history.
 */

/** A snapshot ref as it appears inside a command payload. */
interface RefLike {
	readonly kind?: unknown;
	readonly libraryId?: unknown;
	readonly componentId?: unknown;
	readonly version?: unknown;
	readonly integrity?: unknown;
}

function keyOf(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const ref = value as RefLike;
	if (
		ref.kind !== "library" ||
		typeof ref.libraryId !== "string" ||
		typeof ref.componentId !== "string" ||
		typeof ref.version !== "string" ||
		typeof ref.integrity !== "string"
	) {
		return undefined;
	}
	// Mirrors `snapshotKey` — encodeURIComponent per field, joined with "/".
	return [ref.libraryId, ref.componentId, ref.version, ref.integrity]
		.map(encodeURIComponent)
		.join("/");
}

/**
 * Walk an arbitrary command payload, collecting snapshot keys.
 *
 * Structural rather than type-driven: history is typed `AnyCanvasCommand`
 * (`{ type: string }` for extension commands), so the concrete payload types are
 * not available here without importing Core's command modules into the editor's
 * store layer. A bounded structural walk finds `addedSnapshotKeys`, any
 * `*.ref`/`source`/`expectedRef` library ref, and the `removed` map a
 * restore-collected inverse carries.
 */
function collectFrom(value: unknown, into: Set<string>, depth = 0): void {
	// Depth bound: command payloads are shallow, and an unbounded walk over a
	// hostile or cyclic object would hang the GC preview.
	if (depth > 8 || !value || typeof value !== "object") return;

	if (Array.isArray(value)) {
		for (const entry of value) collectFrom(entry, into, depth + 1);
		return;
	}

	const record = value as Record<string, unknown>;

	// A ref in its own right.
	const self = keyOf(record);
	if (self !== undefined) into.add(self);

	for (const [key, child] of Object.entries(record)) {
		if (key === "addedSnapshotKeys" && Array.isArray(child)) {
			for (const entry of child) {
				if (typeof entry === "string") into.add(entry);
			}
			continue;
		}
		// `removed` on a restore-collected inverse is keyed BY snapshot key.
		if (key === "removed" && child && typeof child === "object") {
			for (const entry of Object.keys(child as object)) into.add(entry);
		}
		collectFrom(child, into, depth + 1);
	}
}

/**
 * Every snapshot key referenced by the undo and redo stacks.
 *
 * Pass the result to `component-snapshot.collect-unused` as
 * `retainedSnapshotKeys`. An empty result is meaningful only when the history
 * is genuinely empty — which is why the command requires the argument rather
 * than defaulting it.
 */
export function collectRetainedSnapshotKeys(history: {
	readonly past: readonly AnyCanvasCommand[];
	readonly future: readonly AnyCanvasCommand[];
}): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const command of history.past) collectFrom(command, keys);
	for (const command of history.future) collectFrom(command, keys);
	return keys;
}
