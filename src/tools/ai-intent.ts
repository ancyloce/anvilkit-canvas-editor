import type { AiLayerContext } from "@anvilkit/canvas-core";

/**
 * Editor → host seam for the AI tools (I1-7). The `ai-image` and `ai-brush`
 * tools capture a canvas gesture and emit an intent; they never run a job,
 * paint a mask, or import `@anvilkit/plugin-ai-image` (canvas AI lives in that
 * plugin per the dependency graph). The host (`plugin-canvas-studio`/demo)
 * wires `<CanvasStudio onAiIntent>` to the AI panel / job client.
 *
 * Intents reference only `AiLayerContext` from `@anvilkit/canvas-core`, which
 * `@anvilkit/canvas-editor` already depends on.
 */

/** `ai-image`: a drag-marquee region the host should fill with a generation. */
export interface AiImageMarqueeIntent {
	kind: "ai-image-marquee";
	context: AiLayerContext;
}

/** `ai-brush`: an image node the host should offer contextual AI actions for. */
export interface AiBrushSelectIntent {
	kind: "ai-brush-select";
	nodeId: string;
	context: AiLayerContext;
}

export type AiToolIntent = AiImageMarqueeIntent | AiBrushSelectIntent;
