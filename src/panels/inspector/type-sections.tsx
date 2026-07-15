"use client";

import type { CanvasNode } from "@anvilkit/canvas-core";
import { EMPTY_BRAND_KIT } from "../../brand/brand-kit.js";
import type {
	CanvasStudioContextValue,
	CanvasT,
} from "../../context/canvas-studio-context.js";
import type { CommitPatch } from "../fields.js";
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
 */
export function renderTypeSpecificFields(
	node: CanvasNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
	t: CanvasT,
): React.JSX.Element | null {
	switch (node.type) {
		case "rect":
			return renderRectFields(node, commitPatch, t);
		case "ellipse":
			return renderEllipseFields(node, commitPatch, t);
		case "polygon":
			return renderPolygonFields(node, commitPatch, t);
		case "star":
			return renderStarFields(node, commitPatch, t);
		case "line":
			return renderLineFields(node, commitPatch, t);
		case "text":
			return renderTextFields(
				node,
				commitPatch,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "rich-text":
			return renderRichTextFields(
				node,
				commitPatch,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "image":
			return renderImageFields(node, commitPatch, ctx, t);
		case "svg":
			return null;
		case "path":
			return renderPathFields(node, commitPatch, ctx, t);
		case "group":
			return renderGroupFields(node, t);
		case "frame":
			return renderFrameFields(
				node,
				commitPatch,
				ctx,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "ai-placeholder":
			return null;
		default: {
			// Custom (extension) kind: render its registered inspector fields, if any.
			const custom = node as unknown as CanvasNode & { type: string };
			const inspector = ctx.kindInspectors?.[custom.type];
			return inspector ? inspector.render(custom, ctx.commit) : null;
		}
	}
}
