/**
 * The snap engine now lives in `@anvilkit/canvas-core` (`src/snap.ts`), shared
 * by the editor, headless consumers, and tests. Re-exported here so existing
 * editor imports keep their `./snap-engine.js` path. New code should import
 * `computeSnap` / `DEFAULT_SNAP_THRESHOLD` from `@anvilkit/canvas-core` directly.
 */
export { computeSnap, DEFAULT_SNAP_THRESHOLD } from "@anvilkit/canvas-core";
