/**
 * `@anvilkit/canvas-editor/collab` — granular Yjs collaboration for CanvasIR.
 *
 * Isolated from the main editor entry on purpose: nothing in `src/index.ts`
 * imports this subtree, so yjs / y-protocols never enter the measured
 * `dist/index.js` bundle (size-limit, 400 KB gz). yjs + y-protocols are
 * OPTIONAL peer dependencies — install them only when wiring collab.
 *
 * Schema v2 stores pages, nodes, fields, ordering, assets, components, and rich
 * text in independently addressable shared types. Presence remains ephemeral.
 */
export const CANVAS_COLLAB_VERSION = "0.2.0";

export {
	type CollaboratorPresenceListProps,
	CollaboratorPresenceList,
} from "./CollaboratorPresenceList.js";
export { RemoteCursors } from "../stage/RemoteCursors.js";
export { RemoteSelections } from "../stage/RemoteSelections.js";

export {
	type DocumentSnapshotSource,
	type DocumentStores,
	type ReplaceDocumentSnapshotOptions,
	replaceDocumentSnapshot,
} from "../stores/replace-document.js";
export {
	type CanvasCollabAdapter,
	type CanvasCollabConnectionSource,
	type CanvasCollabConnectionStatus,
	type CanvasCollabDiagnostic,
	type CanvasCollabDiagnosticAction,
	type CanvasCollabDiagnosticCode,
	type CanvasCollabRecoveryController,
	type CanvasCollabRecoveryPackage,
	type CanvasCollabRecoveryState,
	type CanvasCollabRepairResult,
	type CanvasCollabSyncController,
	type CanvasCollabSyncState,
	type CanvasCollabUndoController,
	type CanvasCollabUndoOptions,
	type CanvasYjsBinding,
	type CreateCanvasYjsBindingOptions,
	createCanvasYjsBinding,
} from "./binding.js";
export {
	CANVAS_COLLAB_SCHEMA_VERSION,
	CANVAS_COLLAB_SCHEMA_VERSION_KEY,
	CanvasCrdtProjectionError,
	type CanvasCrdtProjectionErrorCode,
	type CanvasCrdtSharedMap,
	getCanvasCrdtRoot,
	type ReadCanvasIRFromCrdtOptions,
	readCanvasIRFromCrdt,
	writeCanvasIRToCrdt,
} from "./crdt-document.js";
export {
	decodeCanvasIR,
	encodeCanvasIR,
	unsupportedCapabilitiesOf,
} from "./encode.js";
export {
	CANVAS_IR_KEY,
	DEFAULT_CANVAS_MAP_NAME,
	LAST_PEER_KEY,
} from "./keys.js";
export {
	type CanvasPresence,
	type CreateCanvasPresenceOptions,
	createCanvasPresence,
} from "./presence-bridge.js";
export {
	MAX_DISPLAY_NAME_LENGTH,
	sanitizeDisplayName,
	validateCanvasPeerInfo,
	validateCanvasPresenceCursor,
	validateCanvasPresenceSelection,
	validateCanvasPresenceState,
} from "./presence-schema.js";
export type {
	CanvasBindingUnsubscribe,
	CanvasPeerInfo,
	CanvasPresenceCursor,
	CanvasPresenceSelection,
	CanvasPresenceState,
} from "./presence-types.js";
export {
	type CanvasLegacyWriteGuard,
	type CanvasRoomMigrationResult,
	type CanvasRoomMigrationStatus,
	LEGACY_RECOVERY_ERROR_KEY,
	LEGACY_RECOVERY_SNAPSHOT_KEY,
	LEGACY_ROOM_SCHEMA_VERSION_KEY,
	type MigrateCanvasCollaborationRoomOptions,
	migrateCanvasCollaborationRoom,
	type SeedEmptyCanvasCollaborationRoomOptions,
	seedEmptyCanvasCollaborationRoom,
	type WatchLegacyCanvasRoomWritesOptions,
	watchLegacyCanvasRoomWrites,
} from "./room-migration.js";
export {
	CanvasPresenceContext,
	type CanvasPresenceSource,
	useCanvasPresence,
} from "./useCanvasPresence.js";
