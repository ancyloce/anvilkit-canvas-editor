"use client";

import { type CanvasNode, isContainerNode } from "@anvilkit/canvas-core";
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { type FocusNavKey, nextFocusId } from "./keyboard-actions.js";

const srOnly = {
	position: "absolute",
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: "hidden",
	clip: "rect(0 0 0 0)",
	whiteSpace: "nowrap",
	border: 0,
} as const;

const NAV_KEYS = new Set<string>([
	"ArrowDown",
	"ArrowUp",
	"ArrowLeft",
	"ArrowRight",
	"Enter",
	"Escape",
]);

const itemDomId = (nodeId: string) => `ak-scene-item-${nodeId}`;

interface FlatItem {
	node: CanvasNode;
	level: number;
}

function flatten(nodes: readonly CanvasNode[], level = 1): FlatItem[] {
	const out: FlatItem[] = [];
	for (const node of nodes) {
		out.push({ node, level });
		if (isContainerNode(node)) {
			out.push(...flatten(node.children, level + 1));
		}
	}
	return out;
}

/**
 * Off-canvas screen-reader proxy for the scene (a11y): a visually-hidden
 * `role="tree"` mirror of the active page's nodes. Konva renders to `<canvas>`
 * (invisible to assistive tech), so this exposes a real, focusable DOM tree —
 * arrow keys move roving focus (via {@link nextFocusId}), Enter selects. Mounted
 * inside `<CanvasStudio>`.
 */
export function SceneAccessibilityTree(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const focusedId = useSyncExternalStore(
		ctx.focusStore.subscribe,
		() => ctx.focusStore.getState().focusedId,
		() => ctx.focusStore.getState().focusedId,
	);
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);

	const page = ctx.ir.pages.find((p) => p.id === ctx.activePageId);
	const items = page ? flatten(page.root.children) : [];
	// O(1) membership per row instead of scanning `selectedIds` for every item.
	const selectedSet = new Set(selectedIds);

	const labelFor = (node: CanvasNode): string => {
		const base =
			node.name && node.name.length > 0
				? node.name
				: (ctx.kindInspectors?.[node.type]?.label ?? node.type);
		if (node.type === "image" || node.type === "svg") {
			// FR-095 accessible description: a broken asset reference must be
			// perceivable without sight of the canvas placeholder chrome.
			if (ctx.ir.assets[node.assetId] === undefined) {
				return `${base} — ${t("canvas.a11y.missingAsset", "missing asset")}`;
			}
			// §12 alt-text: announce the image's alternative text when set.
			if (node.alt && node.alt.trim().length > 0) {
				return `${base} — ${node.alt.trim()}`;
			}
		}
		return base;
	};

	const onItemKeyDown = (
		e: React.KeyboardEvent<HTMLButtonElement>,
		nodeId: string,
	): void => {
		if (!NAV_KEYS.has(e.key)) return;
		e.preventDefault();
		if (e.key === "Enter") {
			ctx.selectionStore.getState().setSelection([nodeId]);
			return;
		}
		if (!page) return;
		const next = nextFocusId({ root: page.root }, nodeId, e.key as FocusNavKey);
		ctx.focusStore.getState().setFocus(next);
		if (next) {
			document.getElementById(itemDomId(next))?.focus();
		}
	};

	return (
		// A roving-tabindex tree of buttons is the canonical canvas-a11y proxy:
		// Konva renders to <canvas>, so there are no real DOM nodes to expose.
		<div
			role="tree"
			aria-label={t("canvas.a11y.sceneTree", "Canvas objects")}
			style={srOnly}
		>
			{items.map(({ node, level }, index) => {
				const isFocused = focusedId ? node.id === focusedId : index === 0;
				return (
					<button
						key={node.id}
						id={itemDomId(node.id)}
						type="button"
						role="treeitem"
						aria-level={level}
						aria-selected={selectedSet.has(node.id)}
						tabIndex={isFocused ? 0 : -1}
						onFocus={() => ctx.focusStore.getState().setFocus(node.id)}
						onClick={() =>
							ctx.selectionStore.getState().setSelection([node.id])
						}
						onKeyDown={(e) => onItemKeyDown(e, node.id)}
					>
						{labelFor(node)}
					</button>
				);
			})}
		</div>
	);
}
