/**
 * Y.Doc slot constants for the canvas collab binding (I3-1).
 *
 * Prototype encoding is whole-document JSON-blob last-writer-wins: the entire
 * `CanvasIR` lives under a single {@link CANVAS_IR_KEY} as key-sorted
 * JSON, and the latest writer's identity under {@link LAST_PEER_KEY}. The
 * native per-node Y.Map tree (per-prop CRDT merge) is the GA follow-up.
 */
export const DEFAULT_CANVAS_MAP_NAME = "anvilkit-canvas";
export const CANVAS_IR_KEY = "canvasIR";
export const LAST_PEER_KEY = "lastPeer";
