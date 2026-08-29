import { createCanvasIR } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
	CANVAS_COLLAB_SCHEMA_VERSION,
	CANVAS_COLLAB_SCHEMA_VERSION_KEY,
	getCanvasCrdtRoot,
	readCanvasIRFromCrdt,
} from "../crdt-document.js";
import { encodeCanvasIR } from "../encode.js";
import { CANVAS_IR_KEY, DEFAULT_CANVAS_MAP_NAME } from "../keys.js";
import {
	LEGACY_RECOVERY_ERROR_KEY,
	LEGACY_RECOVERY_SNAPSHOT_KEY,
	LEGACY_ROOM_SCHEMA_VERSION_KEY,
	migrateCanvasCollaborationRoom,
	seedEmptyCanvasCollaborationRoom,
	watchLegacyCanvasRoomWrites,
} from "../room-migration.js";

function fixture(id = "legacy-doc") {
	return createCanvasIR({
		id,
		title: `Document ${id}`,
		now: () => "2026-08-28T00:00:00.000Z",
	});
}

describe("Canvas collaboration room migration", () => {
	it("converts a legacy JSON room once and preserves the exact source snapshot", () => {
		const doc = new Y.Doc();
		const legacy = doc.getMap<unknown>(DEFAULT_CANVAS_MAP_NAME);
		const expected = fixture();
		const raw = encodeCanvasIR(expected);
		legacy.set(CANVAS_IR_KEY, raw);

		const first = migrateCanvasCollaborationRoom({ doc });
		const root = getCanvasCrdtRoot(doc);
		expect(first).toMatchObject({
			status: "migrated",
			writable: true,
			schemaVersion: CANVAS_COLLAB_SCHEMA_VERSION,
		});
		expect(root.get(LEGACY_RECOVERY_SNAPSHOT_KEY)).toBe(raw);
		expect(legacy.get(LEGACY_ROOM_SCHEMA_VERSION_KEY)).toBe(
			CANVAS_COLLAB_SCHEMA_VERSION,
		);
		expect(readCanvasIRFromCrdt(root)).toEqual(expected);

		const stateVector = Y.encodeStateVector(doc);
		const second = migrateCanvasCollaborationRoom({ doc });
		expect(second.status).toBe("native");
		expect(Y.encodeStateVector(doc)).toEqual(stateVector);
	});

	it("preserves corrupt legacy data without making the room writable", () => {
		const doc = new Y.Doc();
		const legacy = doc.getMap<unknown>(DEFAULT_CANVAS_MAP_NAME);
		legacy.set(CANVAS_IR_KEY, "{ broken json");

		const result = migrateCanvasCollaborationRoom({ doc });
		const root = getCanvasCrdtRoot(doc);
		expect(result.status).toBe("corrupt-legacy");
		expect(result.writable).toBe(false);
		expect(root.get(LEGACY_RECOVERY_SNAPSHOT_KEY)).toBe("{ broken json");
		expect(root.get(LEGACY_RECOVERY_ERROR_KEY)).toEqual(expect.any(String));
		expect(root.get(CANVAS_COLLAB_SCHEMA_VERSION_KEY)).toBeUndefined();
	});

	it("rejects a room written by a newer collaboration schema", () => {
		const doc = new Y.Doc();
		getCanvasCrdtRoot(doc).set(CANVAS_COLLAB_SCHEMA_VERSION_KEY, 3);

		expect(migrateCanvasCollaborationRoom({ doc })).toMatchObject({
			status: "incompatible-schema",
			writable: false,
			schemaVersion: 3,
		});
	});

	it("seeds an empty room directly in schema v2 and seals the legacy map", () => {
		const doc = new Y.Doc();
		expect(migrateCanvasCollaborationRoom({ doc }).status).toBe("empty");
		const ir = fixture("new-room");

		seedEmptyCanvasCollaborationRoom({ doc, ir, origin: { id: "alice" } });

		expect(readCanvasIRFromCrdt(getCanvasCrdtRoot(doc))).toEqual(ir);
		expect(
			doc
				.getMap<unknown>(DEFAULT_CANVAS_MAP_NAME)
				.get(LEGACY_ROOM_SCHEMA_VERSION_KEY),
		).toBe(CANVAS_COLLAB_SCHEMA_VERSION);
	});

	it("fails closed when a stale client writes the legacy register after migration", () => {
		const doc = new Y.Doc();
		const legacy = doc.getMap<unknown>(DEFAULT_CANVAS_MAP_NAME);
		legacy.set(CANVAS_IR_KEY, encodeCanvasIR(fixture()));
		migrateCanvasCollaborationRoom({ doc });
		const onMixedSchemaWrite = vi.fn();
		const guard = watchLegacyCanvasRoomWrites({ doc, onMixedSchemaWrite });
		expect(guard.isWritable()).toBe(true);

		doc.transact(
			() => {
				legacy.set(CANVAS_IR_KEY, encodeCanvasIR(fixture("stale-writer")));
			},
			{ id: "legacy-client" },
		);

		expect(guard.mixedSchemaDetected()).toBe(true);
		expect(guard.isWritable()).toBe(false);
		expect(onMixedSchemaWrite).toHaveBeenCalledOnce();
		guard.destroy();
	});
});
