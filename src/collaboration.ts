/**
 * `@anvilkit/canvas-editor/collaboration` — host-facing sharing and comments.
 *
 * Kept separate from the eager editor entry so service providers and the
 * accessible thread panel load only when a host enables collaboration.
 * Yjs transport remains independently optional at the `/collab` entry.
 */
export * from "./comments/index.js";
export * from "./sharing/index.js";
