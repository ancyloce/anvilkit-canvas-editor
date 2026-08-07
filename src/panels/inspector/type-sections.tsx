"use client";

import type {
	CanvasAudioNode,
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
	CanvasVideoNode,
} from "@anvilkit/canvas-core";
import * as React from "react";
import { EMPTY_BRAND_KIT } from "../../brand/brand-kit.js";
import type {
	CanvasStudioContextValue,
	CanvasT,
} from "../../context/canvas-studio-context.js";
import type { CommitPatchAll } from "../fields.js";
import { ComponentOverrideSection } from "./component-sections.js";
import {
	renderFrameFields,
	renderImageFields,
	renderStaticMediaFields,
} from "./media-sections.js";
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
		// cp0-002: built-in kinds, so they must branch HERE for the same reason
		// `component-instance` does below — falling through to `default` would
		// hand them to the EXTENSION `kindInspectors` lookup. Neither renders
		// what its name promises (video = poster only, audio = nothing), and the
		// static notice is the only place in the product that says so.
		case "video":
		case "audio":
			return renderStaticMediaFields(
				nodes as ReadonlyArray<CanvasVideoNode | CanvasAudioNode>,
				t,
			);
		// Plan 0023 M4-02: a built-in kind, so it must branch HERE rather than
		// fall through to `default`, which would hand it to the EXTENSION
		// `kindInspectors` lookup and silently misclassify a built-in as a
		// custom kind. M5-05: a SINGLE instance gets the override editor —
		// overrides are keyed per definition, so a multi-instance selection could
		// span definitions whose same-named properties mean different things.
		case "component-instance":
			return nodes.length === 1 ? (
				<ComponentOverrideSection node={node} ctx={ctx} t={t} />
			) : null;
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
