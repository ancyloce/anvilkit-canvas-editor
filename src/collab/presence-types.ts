/**
 * Presence / awareness types for the canvas collab prototype (I3-1).
 *
 * Canvas-local mirrors of `@anvilkit/plugin-version-history`'s presence shapes
 * — defined here so `@anvilkit/canvas-editor` does not depend on the Puck /
 * PageIR collab stack. `selection.nodeIds` references canvas node ids
 * (the same ids the editor's `selectionStore` holds).
 */

export type CanvasBindingUnsubscribe = () => void;

export interface CanvasPeerInfo {
	readonly id: string;
	readonly displayName?: string;
	readonly color?: string;
}

export interface CanvasPresenceCursor {
	readonly x: number;
	readonly y: number;
}

export interface CanvasPresenceSelection {
	readonly nodeIds: readonly string[];
}

export interface CanvasPresenceState {
	readonly peer: CanvasPeerInfo;
	readonly cursor?: CanvasPresenceCursor;
	readonly selection?: CanvasPresenceSelection;
}
