/**
 * `@anvilkit/canvas-editor/collab` — the Yjs collaboration prototype (I3-1).
 *
 * Isolated from the main editor entry on purpose: nothing in `src/index.ts`
 * imports this subtree, so yjs / y-protocols never enter the measured
 * `dist/index.js` bundle (size-limit, 400 KB gz). yjs + y-protocols are
 * OPTIONAL peer dependencies — install them only when wiring collab.
 *
 * Architectural only (M6 / I3-1): binds the canvas `sceneStore` to a `Y.Doc`
 * and scaffolds presence/awareness. No collaborative UI ships from here.
 *
 * CONSISTENCY MODEL (P0-10): `createCanvasYjsBinding` is whole-document
 * last-writer-wins, not a CRDT over the document tree — two peers editing
 * different nodes concurrently do not merge; one write wins outright. See
 * `createCanvasYjsBinding`'s own doc comment for the full explanation before
 * integrating this in a multi-writer setting. `CanvasCollabAdapter` is the
 * transport-/consistency-model-agnostic shape a future fine-grained adapter
 * (per-node CRDT, or a replicated command log) can implement as a drop-in
 * replacement without changing call sites.
 */
export const CANVAS_COLLAB_VERSION = "0.1.0";

export {
	type DocumentSnapshotSource,
	type DocumentStores,
	type ReplaceDocumentSnapshotOptions,
	replaceDocumentSnapshot,
} from "../stores/replace-document.js";
export {
	type CanvasCollabAdapter,
	type CanvasYjsBinding,
	type CreateCanvasYjsBindingOptions,
	createCanvasYjsBinding,
} from "./binding.js";
export { decodeCanvasIR, encodeCanvasIR } from "./encode.js";
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
	CanvasPresenceContext,
	type CanvasPresenceSource,
	useCanvasPresence,
} from "./useCanvasPresence.js";
