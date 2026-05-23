import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { DraftStoreApi } from "../stores/draft-store.js";
import type { EditingStoreApi } from "../stores/editing-store.js";
import type { GuidesStoreApi } from "../stores/guides-store.js";
import type { PenStoreApi } from "../stores/pen-store.js";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import type { ToolId, ToolStoreApi } from "../stores/tool-store.js";
import type { ViewportStoreApi } from "../stores/viewport-store.js";
import type { AiToolIntent } from "./ai-intent.js";

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
	guidesStore: GuidesStoreApi;
	draftStore: DraftStoreApi;
	editingStore: EditingStoreApi;
	/** Multi-click pen-path state (I3-2). Always supplied by `<CanvasStudio>`. */
	penStore: PenStoreApi;
	pickAsset: () => Promise<string>;
	activePageId: string;
	/**
	 * Hand an AI gesture (marquee region / image selection) to the host. Optional
	 * because the AI host is opt-in — `<CanvasStudio>` always supplies a function
	 * (a no-op when no `onAiIntent` prop is wired), but tool tests may omit it.
	 */
	requestAiIntent?: (intent: AiToolIntent) => void;
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
