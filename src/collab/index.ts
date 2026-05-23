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
 */
export const CANVAS_COLLAB_VERSION = "0.1.0";

export {
	type CanvasYjsBinding,
	createCanvasYjsBinding,
	type CreateCanvasYjsBindingOptions,
} from "./binding.js";
export { decodeCanvasIR, encodeCanvasIR } from "./encode.js";
export {
	CANVAS_IR_KEY,
	DEFAULT_CANVAS_MAP_NAME,
	LAST_PEER_KEY,
} from "./keys.js";
export {
	type CanvasPresence,
	createCanvasPresence,
	type CreateCanvasPresenceOptions,
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
