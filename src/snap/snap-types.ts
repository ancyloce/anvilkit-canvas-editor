/**
 * Snap geometry types now live in `@anvilkit/canvas-core` (`src/snap.ts`),
 * shared by the editor, headless consumers, and tests. Re-exported here so
 * existing editor imports keep their `./snap-types.js` path. New code should
 * import these from `@anvilkit/canvas-core` directly.
 */
export type {
	SmartGuide,
	SnapAxis,
	SnapInput,
	SnapRect,
	SnapResult,
} from "@anvilkit/canvas-core";
