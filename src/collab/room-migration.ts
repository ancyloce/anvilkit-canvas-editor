import type {
	CanvasDocumentBudgetPolicy,
	CanvasIR,
	CanvasRuntime,
} from "@anvilkit/canvas-core";
import * as Y from "yjs";
import {
	CANVAS_COLLAB_SCHEMA_VERSION,
	CANVAS_COLLAB_SCHEMA_VERSION_KEY,
	getCanvasCrdtRoot,
	writeCanvasIRToCrdt,
} from "./crdt-document.js";
import { decodeCanvasIR } from "./encode.js";
import { CANVAS_IR_KEY, DEFAULT_CANVAS_MAP_NAME } from "./keys.js";

/** Schema marker written into the legacy room map to block dual writers. */
export const LEGACY_ROOM_SCHEMA_VERSION_KEY =
	"canvasCollaborationSchemaVersion";

/** Exact pre-migration JSON retained in the v2 root for recovery/export. */
export const LEGACY_RECOVERY_SNAPSHOT_KEY = "legacyRecoverySnapshot";

/** Human-readable migration failure retained beside a corrupt legacy value. */
export const LEGACY_RECOVERY_ERROR_KEY = "legacyRecoveryError";

const MIGRATION_ORIGIN = Symbol.for(
	"@anvilkit/canvas-editor/collaboration-migration",
);

export type CanvasRoomMigrationStatus =
	| "empty"
	| "native"
	| "migrated"
	| "corrupt-legacy"
	| "incompatible-schema";

export interface CanvasRoomMigrationResult {
	readonly status: CanvasRoomMigrationStatus;
	readonly writable: boolean;
	readonly schemaVersion?: unknown;
	readonly error?: string;
}

export interface MigrateCanvasCollaborationRoomOptions {
	readonly doc: Y.Doc;
	readonly mapName?: string;
	readonly runtime?: CanvasRuntime;
	readonly documentBudgetPolicy?: Partial<CanvasDocumentBudgetPolicy>;
	readonly origin?: unknown;
}

/**
 * Detect and migrate the legacy whole-document room exactly once.
 *
 * Valid legacy JSON is decoded through the same bounded load pipeline as every
 * other collaboration payload, preserved byte-for-byte, and materialized into
 * schema v2 in one transaction. Corrupt JSON is preserved without assigning a
 * writable v2 schema, so a later repair/export flow can recover it.
 */
export function migrateCanvasCollaborationRoom(
	options: MigrateCanvasCollaborationRoomOptions,
): CanvasRoomMigrationResult {
	const mapName = options.mapName ?? DEFAULT_CANVAS_MAP_NAME;
	const root = getCanvasCrdtRoot(options.doc, mapName);
	const legacy = options.doc.getMap<unknown>(mapName);
	const nativeVersion = root.get(CANVAS_COLLAB_SCHEMA_VERSION_KEY);
	const legacyVersion = legacy.get(LEGACY_ROOM_SCHEMA_VERSION_KEY);

	if (
		legacyVersion !== undefined &&
		legacyVersion !== CANVAS_COLLAB_SCHEMA_VERSION
	) {
		return {
			status: "incompatible-schema",
			writable: false,
			schemaVersion: legacyVersion,
			error: `Legacy room marker requires collaboration schema ${String(legacyVersion)}.`,
		};
	}

	if (nativeVersion !== undefined) {
		if (nativeVersion !== CANVAS_COLLAB_SCHEMA_VERSION) {
			return {
				status: "incompatible-schema",
				writable: false,
				schemaVersion: nativeVersion,
				error: `Room requires collaboration schema ${String(nativeVersion)}.`,
			};
		}
		if (legacyVersion !== CANVAS_COLLAB_SCHEMA_VERSION) {
			options.doc.transact(() => {
				legacy.set(
					LEGACY_ROOM_SCHEMA_VERSION_KEY,
					CANVAS_COLLAB_SCHEMA_VERSION,
				);
			}, options.origin ?? MIGRATION_ORIGIN);
		}
		return {
			status: "native",
			writable: true,
			schemaVersion: CANVAS_COLLAB_SCHEMA_VERSION,
		};
	}

	const legacyRaw = legacy.get(CANVAS_IR_KEY);
	if (legacyRaw === undefined) {
		return {
			status:
				legacyVersion === CANVAS_COLLAB_SCHEMA_VERSION
					? "incompatible-schema"
					: "empty",
			writable: legacyVersion === undefined,
			...(legacyVersion === CANVAS_COLLAB_SCHEMA_VERSION
				? {
						schemaVersion: legacyVersion,
						error:
							"Room is marked schema v2 but its v2 document root is missing.",
					}
				: {}),
		};
	}
	if (typeof legacyRaw !== "string") {
		const error = "Legacy canvasIR value is not a JSON string.";
		preserveCorruptLegacy(root, legacyRaw, error, options);
		return { status: "corrupt-legacy", writable: false, error };
	}

	let ir: CanvasIR;
	try {
		ir = decodeCanvasIR(
			legacyRaw,
			options.runtime,
			options.documentBudgetPolicy,
		);
	} catch (error) {
		const message = `Legacy canvasIR failed validation: ${errorMessage(error)}`;
		preserveCorruptLegacy(root, legacyRaw, message, options);
		return {
			status: "corrupt-legacy",
			writable: false,
			error: message,
		};
	}

	options.doc.transact(() => {
		root.set(LEGACY_RECOVERY_SNAPSHOT_KEY, legacyRaw);
		root.delete(LEGACY_RECOVERY_ERROR_KEY);
		writeCanvasIRToCrdt(root, ir);
		legacy.set(LEGACY_ROOM_SCHEMA_VERSION_KEY, CANVAS_COLLAB_SCHEMA_VERSION);
	}, options.origin ?? MIGRATION_ORIGIN);
	return {
		status: "migrated",
		writable: true,
		schemaVersion: CANVAS_COLLAB_SCHEMA_VERSION,
	};
}

export interface SeedEmptyCanvasCollaborationRoomOptions {
	readonly doc: Y.Doc;
	readonly ir: CanvasIR;
	readonly mapName?: string;
	readonly origin: unknown;
}

/** Seed a genuinely empty room and seal it against legacy writers. */
export function seedEmptyCanvasCollaborationRoom(
	options: SeedEmptyCanvasCollaborationRoomOptions,
): void {
	const mapName = options.mapName ?? DEFAULT_CANVAS_MAP_NAME;
	const root = getCanvasCrdtRoot(options.doc, mapName);
	const legacy = options.doc.getMap<unknown>(mapName);
	if (
		root.get(CANVAS_COLLAB_SCHEMA_VERSION_KEY) !== undefined ||
		legacy.get(CANVAS_IR_KEY) !== undefined
	) {
		throw new Error(
			"Cannot seed a Canvas collaboration room that is not empty.",
		);
	}
	options.doc.transact(() => {
		writeCanvasIRToCrdt(root, options.ir);
		legacy.set(LEGACY_ROOM_SCHEMA_VERSION_KEY, CANVAS_COLLAB_SCHEMA_VERSION);
	}, options.origin);
}

export interface CanvasLegacyWriteGuard {
	readonly isWritable: () => boolean;
	readonly mixedSchemaDetected: () => boolean;
	/** Clear a mixed-schema latch after an explicit, validated v2 repair. */
	readonly resetAfterRepair: () => void;
	destroy(): void;
}

export interface WatchLegacyCanvasRoomWritesOptions {
	readonly doc: Y.Doc;
	readonly mapName?: string;
	readonly onMixedSchemaWrite?: (event: {
		readonly raw: unknown;
		readonly origin: unknown;
	}) => void;
}

/**
 * Fail closed when a stale client writes the legacy whole-document register
 * after migration. The schema-v2 binding consults `isWritable()` before every
 * local transaction.
 */
export function watchLegacyCanvasRoomWrites(
	options: WatchLegacyCanvasRoomWritesOptions,
): CanvasLegacyWriteGuard {
	const mapName = options.mapName ?? DEFAULT_CANVAS_MAP_NAME;
	const root = getCanvasCrdtRoot(options.doc, mapName);
	const legacy = options.doc.getMap<unknown>(mapName);
	let mixed = false;
	const observer = (
		event: Y.YMapEvent<unknown>,
		transaction: Y.Transaction,
	) => {
		if (!event.keysChanged.has(CANVAS_IR_KEY)) return;
		if (
			root.get(CANVAS_COLLAB_SCHEMA_VERSION_KEY) !==
			CANVAS_COLLAB_SCHEMA_VERSION
		) {
			return;
		}
		mixed = true;
		options.onMixedSchemaWrite?.({
			raw: legacy.get(CANVAS_IR_KEY),
			origin: transaction.origin,
		});
	};
	legacy.observe(observer);

	return {
		isWritable: () =>
			!mixed &&
			root.get(CANVAS_COLLAB_SCHEMA_VERSION_KEY) ===
				CANVAS_COLLAB_SCHEMA_VERSION &&
			legacy.get(LEGACY_ROOM_SCHEMA_VERSION_KEY) ===
				CANVAS_COLLAB_SCHEMA_VERSION,
		mixedSchemaDetected: () => mixed,
		resetAfterRepair() {
			if (
				root.get(CANVAS_COLLAB_SCHEMA_VERSION_KEY) ===
					CANVAS_COLLAB_SCHEMA_VERSION &&
				legacy.get(LEGACY_ROOM_SCHEMA_VERSION_KEY) ===
					CANVAS_COLLAB_SCHEMA_VERSION
			) {
				mixed = false;
			}
		},
		destroy() {
			legacy.unobserve(observer);
		},
	};
}

function preserveCorruptLegacy(
	root: Y.Map<unknown>,
	raw: unknown,
	error: string,
	options: MigrateCanvasCollaborationRoomOptions,
): void {
	options.doc.transact(() => {
		root.set(
			LEGACY_RECOVERY_SNAPSHOT_KEY,
			typeof raw === "string" ? raw : JSON.stringify(raw),
		);
		root.set(LEGACY_RECOVERY_ERROR_KEY, error);
	}, options.origin ?? MIGRATION_ORIGIN);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
