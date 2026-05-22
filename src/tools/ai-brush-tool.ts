import type { AiLayerContext } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { getNodeWorldRect } from "../snap/get-node-rect.js";
import type { Tool, ToolContext } from "./tool-types.js";

/**
 * Walk up the Konva tree from the hit target until an ancestor's `name()`
 * matches a top-level IR node id on the active page. Mirrors `select-tool`'s
 * private resolver (kept self-contained so this tool does not depend on
 * test-only internals). Single-page descent is sufficient for I1-7.
 */
function findHitNodeId(
	target: Konva.Node | undefined | null,
	ctx: ToolContext,
): string | null {
	const page = ctx.getIR().pages.find((p) => p.id === ctx.activePageId);
	if (!page) return null;
	const ids = new Set(page.root.children.map((c) => c.id));
	let cur: Konva.Node | null = target ?? null;
	let safety = 16;
	while (cur && safety-- > 0) {
		const name =
			typeof (cur as { name?: () => string }).name === "function"
				? (cur as { name: () => string }).name()
				: undefined;
		if (name && ids.has(name)) return name;
		const parent = (cur as { getParent?: () => Konva.Node | null }).getParent;
		cur = typeof parent === "function" ? parent.call(cur) : null;
	}
	return null;
}

/**
 * I1-7 `ai-brush` tool (PRD FR-009: "Hover-select → contextual AI action
 * menu"). Click-selects the image node under the pointer and hands it to the
 * host as an `ai-brush-select` intent so the host can surface contextual AI
 * actions (variation / inpaint / bg-remove) for it. Only image nodes are valid
 * AI-action targets; clicks on other nodes or empty stage are no-ops. Commits
 * nothing to the IR/history — intent is not a command.
 */
export const aiBrushTool: Tool = {
	id: "ai-brush",
	cursor: "cell",

	onPointerDown(e, ctx) {
		const hitId = findHitNodeId(e.target, ctx);
		if (!hitId) return;
		const page = ctx.getIR().pages.find((p) => p.id === ctx.activePageId);
		const node = page?.root.children.find((c) => c.id === hitId);
		if (!node || node.type !== "image") return;

		ctx.selectionStore.getState().setSelection([node.id]);
		const context: AiLayerContext = {
			artboardId: ctx.activePageId,
			selectedNodeId: node.id,
			bounds: getNodeWorldRect(node),
		};
		ctx.requestAiIntent?.({
			kind: "ai-brush-select",
			nodeId: node.id,
			context,
		});
	},
};
