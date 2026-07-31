import { describe, expect, it } from "vitest";

import type { AnyCanvasCommand } from "../../stores/history-store.js";
import { collectRetainedSnapshotKeys } from "../retained-keys.js";

/**
 * T-034 editor half — derive the snapshot keys undo/redo still need.
 *
 * These fixtures are shaped like the real plan-0021 inverses, because the whole
 * risk here is a scan that silently finds nothing: an empty retained set is
 * precisely the input that makes the GC delete snapshots undo needs.
 */

const KEY_A = "acme/button/1.0.0/sha256-aaa";
const KEY_B = "acme/card/2.0.0/sha256-bbb";

const refA = {
	kind: "library" as const,
	libraryId: "acme",
	componentId: "button",
	version: "1.0.0",
	integrity: "sha256-aaa",
};

function history(
	past: AnyCanvasCommand[],
	future: AnyCanvasCommand[] = [],
): { past: AnyCanvasCommand[]; future: AnyCanvasCommand[] } {
	return { past, future };
}

describe("collectRetainedSnapshotKeys (T-034)", () => {
	it("is empty for an empty history", () => {
		expect(collectRetainedSnapshotKeys(history([])).size).toBe(0);
	});

	it("finds keys in `addedSnapshotKeys` (insert / update / recover inverses)", () => {
		const keys = collectRetainedSnapshotKeys(
			history([
				{
					type: "component-instance.revert-external-insert",
					instanceId: "i1",
					addedSnapshotKeys: [KEY_A, KEY_B],
				} as unknown as AnyCanvasCommand,
			]),
		);
		expect([...keys].sort()).toEqual([KEY_A, KEY_B].sort());
	});

	it("derives a key from an embedded library REF", () => {
		// A revert-source-change carries the previous `source` per instance;
		// that ref is what undo would restore, so its snapshot must survive.
		const keys = collectRetainedSnapshotKeys(
			history([
				{
					type: "component-instance.revert-source-change",
					restores: [{ instanceId: "i1", source: refA }],
					addedSnapshotKeys: [],
				} as unknown as AnyCanvasCommand,
			]),
		);
		expect(keys.has(KEY_A)).toBe(true);
	});

	it("finds keys in a restore-collected inverse's `removed` MAP", () => {
		const keys = collectRetainedSnapshotKeys(
			history([
				{
					type: "component-snapshot.restore-collected",
					removed: { [KEY_A]: { ref: refA } },
				} as unknown as AnyCanvasCommand,
			]),
		);
		expect(keys.has(KEY_A)).toBe(true);
	});

	it("scans the FUTURE stack too, not just past", () => {
		// Redo needs its snapshots as much as undo does.
		const keys = collectRetainedSnapshotKeys(
			history(
				[],
				[
					{
						type: "component-instance.revert-external-insert",
						addedSnapshotKeys: [KEY_B],
					} as unknown as AnyCanvasCommand,
				],
			),
		);
		expect(keys.has(KEY_B)).toBe(true);
	});

	it("recurses into a nested `redo` payload", () => {
		const keys = collectRetainedSnapshotKeys(
			history([
				{
					type: "component-instance.revert-external-insert",
					addedSnapshotKeys: [],
					redo: {
						type: "component-instance.insert-external",
						source: refA,
						candidate: { ref: refA },
					},
				} as unknown as AnyCanvasCommand,
			]),
		);
		expect(keys.has(KEY_A)).toBe(true);
	});

	it("recurses into a batch", () => {
		const keys = collectRetainedSnapshotKeys(
			history([
				{
					type: "batch",
					commands: [
						{
							type: "component-instance.revert-external-insert",
							addedSnapshotKeys: [KEY_B],
						},
					],
				} as unknown as AnyCanvasCommand,
			]),
		);
		expect(keys.has(KEY_B)).toBe(true);
	});

	it("ignores ordinary commands without inventing keys", () => {
		const keys = collectRetainedSnapshotKeys(
			history([
				{ type: "node.delete", nodeId: "n1" } as unknown as AnyCanvasCommand,
				{
					type: "node.update",
					id: "n1",
					patch: { name: "x" },
				} as unknown as AnyCanvasCommand,
			]),
		);
		expect(keys.size).toBe(0);
	});

	it("terminates on a cyclic payload rather than hanging", () => {
		// A bounded walk matters: the GC preview runs on user action.
		const cyclic: Record<string, unknown> = {
			type: "weird",
			addedSnapshotKeys: [KEY_A],
		};
		cyclic.self = cyclic;
		expect(() =>
			collectRetainedSnapshotKeys(
				history([cyclic as unknown as AnyCanvasCommand]),
			),
		).not.toThrow();
		expect(
			collectRetainedSnapshotKeys(
				history([cyclic as unknown as AnyCanvasCommand]),
			).has(KEY_A),
		).toBe(true);
	});

	it("derives the SAME key format core's snapshotKey produces", () => {
		// The two must agree or every retained key silently misses.
		const keys = collectRetainedSnapshotKeys(
			history([{ type: "x", source: refA } as unknown as AnyCanvasCommand]),
		);
		expect([...keys][0]).toBe(
			[refA.libraryId, refA.componentId, refA.version, refA.integrity]
				.map(encodeURIComponent)
				.join("/"),
		);
	});
});
