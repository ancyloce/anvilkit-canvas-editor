import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import type { ToolId, ToolStoreApi } from "../stores/tool-store.js";
import type { ViewportStoreApi } from "../stores/viewport-store.js";

/**
 * Per-event context handed to every tool handler. Stable across an interaction —
 * the same ctx that arrives in `onPointerDown` is reused for `onPointerMove` and
 * `onPointerUp` so tools can stash interaction state on it via a closure ref.
 */
export interface ToolContext {
	stage: Konva.Stage;
	getIR: () => CanvasIR;
	commit: (cmd: CanvasCommand) => CanvasIR;
	selectionStore: SelectionStoreApi;
	viewportStore: ViewportStoreApi;
	toolStore: ToolStoreApi;
	pickAsset: () => Promise<string>;
}

export interface ToolPointerEvent {
	/** The underlying DOM PointerEvent / MouseEvent / TouchEvent. */
	evt: PointerEvent | MouseEvent | TouchEvent;
	/** Pointer position in world (canvas IR) coordinates. */
	point: { x: number; y: number };
	/** Pointer position in stage screen coordinates (pre-transform). */
	screenPoint: { x: number; y: number };
	stage: Konva.Stage;
	/** Konva.Node directly under the pointer (i.e. e.target). */
	target: Konva.Node;
	shiftKey: boolean;
}

export interface Tool {
	id: ToolId;
	/** CSS cursor value applied to the stage container while active. */
	cursor: string;
	onActivate?(ctx: ToolContext): void;
	onDeactivate?(ctx: ToolContext): void;
	onPointerDown?(e: ToolPointerEvent, ctx: ToolContext): void;
	onPointerMove?(e: ToolPointerEvent, ctx: ToolContext): void;
	onPointerUp?(e: ToolPointerEvent, ctx: ToolContext): void;
}

export type ToolRegistry = Partial<Record<ToolId, Tool>>;
