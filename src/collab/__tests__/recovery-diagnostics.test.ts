import { type CanvasIR, createCanvasIR } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createSceneStore } from "../../stores/scene-store.js";
import { createMemoryCanvasActivitySink } from "../../sharing/activity-events.js";
import { createCanvasYjsBinding } from "../binding.js";
import {
	CANVAS_COLLAB_SCHEMA_VERSION,
	CANVAS_COLLAB_SCHEMA_VERSION_KEY,
	getCanvasCrdtRoot,
} from "../crdt-document.js";
import { CANVAS_IR_KEY, DEFAULT_CANVAS_MAP_NAME } from "../keys.js";

function fixture(): CanvasIR {
	return createCanvasIR({
		id: "recovery-doc",
		title: "Last valid document",
		now: () => "2026-08-28T00:00:00.000Z",
	});
}

describe("Canvas collaboration recovery and diagnostics", () => {
	it("retains invalid remote state, pauses writes, exports it, and repairs explicitly", () => {
		const doc = new Y.Doc();
		const initial = fixture();
		const store = createSceneStore({ initialIR: initial });
		const activity = createMemoryCanvasActivitySink();
		const binding = createCanvasYjsBinding({
			activitySink: activity,
			doc,
			sceneStore: store,
			peer: { id: "local" },
		});
		const onDiagnostic = vi.fn();
		binding.onDiagnostic(onDiagnostic);
		const root = getCanvasCrdtRoot(doc);

		doc.transact(() => {
			root.set("field:id", JSON.stringify(""));
		}, "remote");

		expect(store.getState().ir).toEqual(initial);
		expect(binding.getRecoveryState()).toMatchObject({
			writable: false,
			requiresRepair: true,
			latestDiagnostic: {
				code: "invalid-projection",
				action: "repair-from-last-valid",
			},
		});
		expect(onDiagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ code: "invalid-projection" }),
		);

		const attemptedLocal = { ...initial, title: "Must remain local only" };
		store.getState().setIR(attemptedLocal);
		expect(root.get("field:title")).toBe(JSON.stringify(initial.title));
		expect(root.get("field:id")).toBe(JSON.stringify(""));

		const recovery = binding.exportRecoveryPackage();
		expect(recovery).toMatchObject({
			format: "anvilkit-canvas-collaboration-recovery",
			version: 1,
			collaborationSchemaVersion: CANVAS_COLLAB_SCHEMA_VERSION,
			lastValidIR: initial,
		});
		expect(recovery.yjsStateUpdate.byteLength).toBeGreaterThan(0);
		const recoveredDoc = new Y.Doc();
		Y.applyUpdateV2(recoveredDoc, recovery.yjsStateUpdate, "recovery-import");
		expect(getCanvasCrdtRoot(recoveredDoc).get("field:id")).toBe(
			JSON.stringify(""),
		);

		const repaired = binding.repairFromLastValid();
		expect(repaired).toMatchObject({ ok: true, ir: initial });
		expect(store.getState().ir).toEqual(initial);
		expect(binding.current()).toEqual(initial);
		expect(binding.getRecoveryState()).toMatchObject({
			writable: true,
			requiresRepair: false,
			latestDiagnostic: { code: "repair-succeeded", action: "none" },
		});
		expect(activity.list().map((event) => event.kind)).toEqual([
			"collaboration-recovery",
			"collaboration-recovery",
		]);
		expect(activity.list().map((event) => event.diagnosticCode)).toEqual([
			"invalid-projection",
			"repair-succeeded",
		]);
		expect(JSON.stringify(activity.list())).not.toContain("Last valid document");
		binding.destroy();
	});

	it("surfaces incompatible, corrupt legacy, and mixed-schema states with stable actions", () => {
		const incompatibleDoc = new Y.Doc();
		getCanvasCrdtRoot(incompatibleDoc).set(
			CANVAS_COLLAB_SCHEMA_VERSION_KEY,
			99,
		);
		const incompatible = createCanvasYjsBinding({
			doc: incompatibleDoc,
			sceneStore: createSceneStore({ initialIR: fixture() }),
			peer: { id: "local" },
		});
		expect(incompatible.getRecoveryState()).toMatchObject({
			writable: false,
			requiresRepair: true,
			latestDiagnostic: {
				code: "incompatible-schema",
				action: "upgrade-client",
			},
		});
		incompatible.destroy();

		const corruptDoc = new Y.Doc();
		corruptDoc
			.getMap(DEFAULT_CANVAS_MAP_NAME)
			.set(CANVAS_IR_KEY, "{ corrupt legacy");
		const corrupt = createCanvasYjsBinding({
			doc: corruptDoc,
			sceneStore: createSceneStore({ initialIR: fixture() }),
			peer: { id: "local" },
		});
		expect(corrupt.getDiagnostics().at(-1)).toMatchObject({
			code: "corrupt-legacy",
			action: "export-recovery",
		});
		expect(corrupt.exportRecoveryPackage().legacySnapshot).toBe(
			"{ corrupt legacy",
		);
		corrupt.destroy();

		const mixedDoc = new Y.Doc();
		const mixedStore = createSceneStore({ initialIR: fixture() });
		const mixed = createCanvasYjsBinding({
			doc: mixedDoc,
			sceneStore: mixedStore,
			peer: { id: "local" },
		});
		mixedDoc
			.getMap(DEFAULT_CANVAS_MAP_NAME)
			.set(CANVAS_IR_KEY, JSON.stringify({ legacy: true }));
		expect(mixed.getRecoveryState()).toMatchObject({
			writable: false,
			requiresRepair: true,
			latestDiagnostic: {
				code: "mixed-schema",
				action: "upgrade-client",
			},
		});
		expect(mixed.repairFromLastValid()).toMatchObject({ ok: true });
		expect(mixed.getRecoveryState().writable).toBe(true);
		mixed.destroy();
	});

	it("records a stable repair-failed outcome after teardown", () => {
		const binding = createCanvasYjsBinding({
			doc: new Y.Doc(),
			sceneStore: createSceneStore({ initialIR: fixture() }),
			peer: { id: "local" },
		});
		binding.destroy();

		expect(binding.repairFromLastValid()).toMatchObject({ ok: false });
		expect(binding.getDiagnostics().at(-1)).toMatchObject({
			code: "repair-failed",
			action: "export-recovery",
		});
	});
});
