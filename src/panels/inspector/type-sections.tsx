"use client";

import type {
	CanvasEllipseNode,
	CanvasFrameNode,
	CanvasGroupNode,
	CanvasImageNode,
	CanvasLineNode,
	CanvasNode,
	CanvasPathNode,
	CanvasPolygonNode,
	CanvasRectNode,
	CanvasRichTextNode,
	CanvasStarNode,
	CanvasTextNode,
} from "@anvilkit/canvas-core";
import { EMPTY_BRAND_KIT } from "../../brand/brand-kit.js";
import type {
	CanvasStudioContextValue,
	CanvasT,
} from "../../context/canvas-studio-context.js";
import type { CommitPatchAll } from "../fields.js";
import { renderFrameFields, renderImageFields } from "./media-sections.js";
import {
	renderEllipseFields,
	renderLineFields,
	renderPolygonFields,
	renderRectFields,
	renderStarFields,
} from "./shape-sections.js";
import { renderGroupFields, renderPathFields } from "./structure-sections.js";
import { renderRichTextFields, renderTextFields } from "./text-sections.js";

/**
 * Kind → inspector-section dispatch (M0-07 split from `PropertyInspector.tsx`,
 * verbatim). Extension kinds fall through to their registered
 * `kindInspectors` renderer.
 *
 * FR-070 (B-12 multi-kind sections): `nodes` is the WHOLE selection sharing
 * one kind (a single-node array for single-selection) — `PropertyInspector`
 * only calls this when `sharedKind` is non-null. A registered custom-kind
 * inspector's `render(node, commit)` is a single-node extension API; it
 * renders only for a single-node selection (multi custom-kind selections
 * render nothing rather than silently patching one node from an N-node edit).
 */
export function renderTypeSpecificFields(
	nodes: readonly CanvasNode[],
	commitPatchAll: CommitPatchAll,
	ctx: CanvasStudioContextValue,
	t: CanvasT,
): React.JSX.Element | null {
	const node = nodes[0];
	if (!node) return null;
	switch (node.type) {
		case "rect":
			return renderRectFields(
				nodes as readonly CanvasRectNode[],
				commitPatchAll,
				t,
			);
		case "ellipse":
			return renderEllipseFields(
				nodes as readonly CanvasEllipseNode[],
				commitPatchAll,
				t,
			);
		case "polygon":
			return renderPolygonFields(
				nodes as readonly CanvasPolygonNode[],
				commitPatchAll,
				t,
			);
		case "star":
			return renderStarFields(
				nodes as readonly CanvasStarNode[],
				commitPatchAll,
				t,
			);
		case "line":
			return renderLineFields(
				nodes as readonly CanvasLineNode[],
				commitPatchAll,
				t,
			);
		case "text":
			return renderTextFields(
				nodes as readonly CanvasTextNode[],
				commitPatchAll,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "rich-text":
			return renderRichTextFields(
				nodes as readonly CanvasRichTextNode[],
				commitPatchAll,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "image":
			return renderImageFields(
				nodes as readonly CanvasImageNode[],
				ctx,
				commitPatchAll,
				t,
			);
		case "svg":
			return null;
		case "path":
			return renderPathFields(
				nodes as readonly CanvasPathNode[],
				commitPatchAll,
				ctx,
				t,
			);
		case "group":
			return renderGroupFields(nodes as readonly CanvasGroupNode[], t);
		case "frame":
			return renderFrameFields(
				nodes as readonly CanvasFrameNode[],
				ctx,
				commitPatchAll,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "ai-placeholder":
			return null;
		default: {
			// Custom (extension) kind: render its registered inspector fields, if
			// any — a single-node extension API, so only for single-selection.
			if (nodes.length > 1) return null;
			const custom = node as unknown as CanvasNode & { type: string };
			const inspector = ctx.kindInspectors?.[custom.type];
			return inspector ? inspector.render(custom, ctx.commit) : null;
		}
	}
}
