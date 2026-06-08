import type {
	CanvasCommand,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import type { JSX } from "react";
import type { Tool } from "../tools/tool-types.js";

/**
 * Editor-side extension surface (pairs with canvas-core's `CanvasExtension`).
 * A host registers renderers/inspectors for custom node kinds so they draw on
 * the canvas and are editable, without forking the editor. The `node` reaches a
 * renderer/inspector typed as `CanvasNode`; the author casts it to their
 * concrete custom-node type.
 */

/** Draws a custom node kind to react-konva. */
export interface CanvasKindRenderer {
	readonly kind: string;
	readonly render: (props: { node: CanvasNode }) => JSX.Element | null;
}

/** Renders the inspector fields for a custom node kind. */
export interface CanvasKindInspector {
	readonly kind: string;
	readonly render: (
		node: CanvasNode,
		commit: (cmd: CanvasCommand) => CanvasIR,
	) => JSX.Element | null;
	/** Layer-panel display label for this kind. */
	readonly label?: string;
}

export interface CanvasEditorExtension {
	readonly id: string;
	readonly renderers?: readonly CanvasKindRenderer[];
	readonly inspectors?: readonly CanvasKindInspector[];
	/** Custom tools, merged into the editor's tool registry by `<CanvasStudio>`. */
	readonly tools?: readonly Tool[];
}
